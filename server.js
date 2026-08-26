// server.js — AI Collective backend (port 8000)
// Captures newsletter signups + "Tell us what you want AI to do" intake.
// Stores every signup to CSV on disk (never lose a lead) and emails a
// notification via Resend. Runs standalone on the droplet with a real
// RESEND_API_KEY, or behind Computer's custom-cred proxy in dev.
const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();
app.use(express.json({ limit: '256kb' }));

// --- Storage: append-only CSVs on disk ---
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) {}
const SUBS_CSV = path.join(DATA_DIR, 'subscribers.csv');
const INTAKE_CSV = path.join(DATA_DIR, 'intake.csv');
if (!fs.existsSync(SUBS_CSV)) fs.writeFileSync(SUBS_CSV, 'timestamp,email,source,ip\n');

// Intake CSV: current header includes the chamber columns. If an older
// intake.csv exists without them, preserve the old data by renaming it to
// intake-v1.csv and starting a fresh file — never truncate existing leads.
const INTAKE_HEADER = 'timestamp,name,email,business,chamberStatus,chamberName,describe,newsletter,ip\n';
if (!fs.existsSync(INTAKE_CSV)) {
  fs.writeFileSync(INTAKE_CSV, INTAKE_HEADER);
} else {
  const firstLine = (fs.readFileSync(INTAKE_CSV, 'utf8').split('\n', 1)[0] || '');
  if (!firstLine.includes('chamberStatus')) {
    const archived = path.join(DATA_DIR, 'intake-v1.csv');
    try {
      fs.renameSync(INTAKE_CSV, archived);
      console.log('[store] migrated legacy intake.csv -> intake-v1.csv');
    } catch (e) {
      console.error('[store] intake migration rename failed', e);
    }
    fs.writeFileSync(INTAKE_CSV, INTAKE_HEADER);
  }
}

function csvCell(s = '') {
  const v = String(s).replace(/\r?\n/g, ' ').replace(/"/g, '""');
  return `"${v}"`;
}
function appendCsv(file, cells) {
  try { fs.appendFileSync(file, cells.map(csvCell).join(',') + '\n'); return true; }
  catch (e) { console.error('[store] write failed', e); return false; }
}

// --- Resend config ---
const CRED_URL = process.env.CUSTOM_CRED_API_RESEND_COM_URL || '';
const CRED_TOKEN = process.env.CUSTOM_CRED_API_RESEND_COM_TOKEN || '';
const USE_CRED_PROXY = !!(CRED_URL && CRED_TOKEN);
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const CAN_SEND = USE_CRED_PROXY || !!RESEND_API_KEY;
const TO_EMAIL = process.env.INTAKE_TO_EMAIL || 'joelwfm@gmail.com';
const FROM_EMAIL = process.env.INTAKE_FROM_EMAIL || 'The AI Collective <info@aicollective.biz>';
if (USE_CRED_PROXY) console.log('[server] using custom-cred pass-through for Resend');
if (RESEND_API_KEY) console.log('[server] using direct Resend API key');
if (!CAN_SEND) console.log('[server] no send credential — capturing to CSV only');

// CORS
app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

function esc(s = '') {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function clientIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '';
}
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

async function sendEmail({ to, subject, html, text, replyTo }) {
  if (!CAN_SEND) { console.log('[email] (no cred) would send:', subject); return { ok: true, mock: true }; }
  const headers = { 'Content-Type': 'application/json' };
  let endpoint;
  if (USE_CRED_PROXY) {
    endpoint = `${CRED_URL.replace(/\/$/, '')}/emails`;
    headers['x-api-key'] = CRED_TOKEN;
  } else {
    endpoint = 'https://api.resend.com/emails';
    headers['Authorization'] = `Bearer ${RESEND_API_KEY}`;
  }
  const body = { from: FROM_EMAIL, to: [to], subject, html, text };
  if (replyTo) body.reply_to = replyTo;
  const r = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!r.ok) { const d = await r.text(); console.error('[email] Resend error', r.status, d); return { ok: false }; }
  return { ok: true };
}

// ===== Newsletter subscribe =====
app.post('/api/subscribe', async (req, res) => {
  const email = String((req.body && req.body.email) || '').trim();
  const source = String((req.body && req.body.source) || 'site').trim().slice(0, 40);
  if (!EMAIL_RE.test(email)) return res.status(400).json({ ok: false, error: 'Please enter a valid email.' });

  const ts = new Date().toISOString();
  appendCsv(SUBS_CSV, [ts, email, source, clientIp(req)]);   // capture FIRST — never lose it
  console.log('[subscribe]', email, source);

  // Notify you (best-effort; capture already saved)
  sendEmail({
    to: TO_EMAIL,
    subject: `New subscriber: ${email}`,
    html: `<div style="font-family:system-ui,sans-serif"><h2 style="color:#ff2d95;margin:0 0 6px">New newsletter subscriber</h2><p style="font-size:15px"><strong>${esc(email)}</strong></p><p style="color:#888;font-size:13px">Source: ${esc(source)} · ${esc(ts)}</p></div>`,
    text: `New subscriber: ${email} (source: ${source}, ${ts})`,
  }).catch(() => {});

  return res.json({ ok: true });
});

// ===== Intake form =====
app.post('/api/intake', async (req, res) => {
  const { name = '', email = '', business = '', chamberStatus = '', chamberName = '', describe = '', consent = false } = req.body || {};
  if (!describe.trim() || describe.trim().length < 10)
    return res.status(400).json({ ok: false, error: 'Please describe what you want AI to do (at least a sentence).' });
  if (!EMAIL_RE.test(email.trim()))
    return res.status(400).json({ ok: false, error: 'Please enter a valid email so we can reply.' });
  // Chamber membership is optional metadata (NOT consent). Accept only the
  // known values or an empty string.
  const chamber = String(chamberStatus || '').trim();
  if (!['yes', 'no', 'unsure', ''].includes(chamber))
    return res.status(400).json({ ok: false, error: 'Invalid chamber selection.' });
  const chamberNm = String(chamberName || '').trim().slice(0, 120);

  const ts = new Date().toISOString();
  appendCsv(INTAKE_CSV, [ts, name, email, business, chamber, chamberNm, describe, consent ? 'yes' : 'no', clientIp(req)]);
  if (consent) appendCsv(SUBS_CSV, [ts, email.trim(), 'intake-optin', clientIp(req)]);

  const submittedAt = new Date().toLocaleString('en-CA', { timeZone: 'America/Regina' });
  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto">
      <h2 style="color:#ff2d95;margin:0 0 4px">New AI Collective request</h2>
      <p style="color:#666;margin:0 0 20px;font-size:13px">Submitted ${esc(submittedAt)} (Regina time)</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <tr><td style="padding:8px 0;color:#888;width:120px">Name</td><td style="padding:8px 0"><strong>${esc(name) || '—'}</strong></td></tr>
        <tr><td style="padding:8px 0;color:#888">Email</td><td style="padding:8px 0"><a href="mailto:${esc(email)}">${esc(email)}</a></td></tr>
        <tr><td style="padding:8px 0;color:#888">Business</td><td style="padding:8px 0">${esc(business) || '—'}</td></tr>
        <tr><td style="padding:8px 0;color:#888">Chamber</td><td style="padding:8px 0">${chamber ? esc(chamber) : '—'}${chamberNm ? ' — ' + esc(chamberNm) : ''}</td></tr>
        <tr><td style="padding:8px 0;color:#888;vertical-align:top">Newsletter</td><td style="padding:8px 0">${consent ? 'Yes — opted in' : 'No'}</td></tr>
      </table>
      <h3 style="margin:22px 0 6px;color:#111">What they want AI to do</h3>
      <div style="white-space:pre-wrap;background:#f6f4fb;border-left:3px solid #00b3cc;padding:14px 16px;border-radius:8px;font-size:14px;line-height:1.6;color:#222">${esc(describe)}</div>
      <p style="color:#555;font-size:13px;margin-top:20px">Chamber: ${chamber ? esc(chamber) : '—'}${chamberNm ? ' — ' + esc(chamberNm) : ''}</p>
      <p style="color:#aaa;font-size:12px;margin-top:12px">Sent from the aicollective.biz intake form · Reply directly to reach ${esc(email)}.</p>
    </div>`;
  const chamberLine = `Chamber: ${chamber || '—'}${chamberNm ? ' — ' + chamberNm : ''}`;
  const text = `New AI Collective request (${submittedAt} Regina)\n\nName: ${name || '—'}\nEmail: ${email}\nBusiness: ${business || '—'}\n${chamberLine}\nNewsletter opt-in: ${consent ? 'Yes' : 'No'}\n\nWhat they want AI to do:\n${describe}`;

  const r = await sendEmail({ to: TO_EMAIL, subject: `AI request from ${name || business || email}`, html, text, replyTo: email }).catch(() => ({ ok: false }));
  // Capture already saved to CSV, so always succeed for the visitor.
  // Chamber members route to the chamber follow-up; everyone else is standard.
  const routing = chamber === 'yes'
    ? { destination: 'chamber', chamberHint: chamberNm || null }
    : { destination: 'standard' };
  return res.json({ ok: true, emailed: !!r.ok, routing });
});

app.get('/api/health', (req, res) => res.json({ ok: true, canSend: CAN_SEND, subs: fs.existsSync(SUBS_CSV) }));

// Read-only subscriber count + list for the notification checker.
// Protected by a token so it's not public. Pass ?token=... matching NOTIFY_TOKEN.
const NOTIFY_TOKEN = process.env.NOTIFY_TOKEN || 'aic-notify-7Kq2wLmZ';
app.get('/api/subscribers', (req, res) => {
  if ((req.query.token || '') !== NOTIFY_TOKEN) return res.status(403).json({ ok: false });
  let rows = [];
  try {
    const raw = fs.readFileSync(SUBS_CSV, 'utf8').trim().split('\n');
    rows = raw.slice(1).filter(Boolean).map(line => {
      const m = line.match(/^"([^"]*)","([^"]*)","([^"]*)","([^"]*)"/);
      return m ? { timestamp: m[1], email: m[2], source: m[3] } : null;
    }).filter(Boolean);
  } catch (e) {}
  res.json({ ok: true, count: rows.length, subscribers: rows });
});

const PORT = process.env.PORT || 8000;
if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => console.log('AI Collective server listening on ' + PORT));
}
module.exports = app;
