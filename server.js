// server.js — AI Collective intake backend (port 8000)
// Receives "Tell us what you want AI to do" submissions and emails them via Resend.
const express = require('express');
const app = express();
app.use(express.json({ limit: '256kb' }));

// CORS (site + local testing)
app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// --- Config (override via env at deploy time) ---
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const TO_EMAIL = process.env.INTAKE_TO_EMAIL || 'joelwfm@gmail.com';
const FROM_EMAIL = process.env.INTAKE_FROM_EMAIL || 'The AI Collective <hello@intheresults.com>';

function esc(s = '') {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

app.post('/api/intake', async (req, res) => {
  const { name = '', email = '', business = '', describe = '', consent = false } = req.body || {};

  // Basic validation
  if (!describe.trim() || describe.trim().length < 10) {
    return res.status(400).json({ ok: false, error: 'Please describe what you want AI to do (at least a sentence).' });
  }
  if (!email.trim() || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
    return res.status(400).json({ ok: false, error: 'Please enter a valid email so we can reply.' });
  }

  const submittedAt = new Date().toLocaleString('en-CA', { timeZone: 'America/Regina' });
  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto">
      <h2 style="color:#ff2d95;margin:0 0 4px">New AI Collective request</h2>
      <p style="color:#666;margin:0 0 20px;font-size:13px">Submitted ${esc(submittedAt)} (Regina time)</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <tr><td style="padding:8px 0;color:#888;width:120px">Name</td><td style="padding:8px 0"><strong>${esc(name) || '—'}</strong></td></tr>
        <tr><td style="padding:8px 0;color:#888">Email</td><td style="padding:8px 0"><a href="mailto:${esc(email)}">${esc(email)}</a></td></tr>
        <tr><td style="padding:8px 0;color:#888">Business</td><td style="padding:8px 0">${esc(business) || '—'}</td></tr>
        <tr><td style="padding:8px 0;color:#888;vertical-align:top">Newsletter</td><td style="padding:8px 0">${consent ? 'Yes — opted in' : 'No'}</td></tr>
      </table>
      <h3 style="margin:22px 0 6px;color:#111">What they want AI to do</h3>
      <div style="white-space:pre-wrap;background:#f6f4fb;border-left:3px solid #00b3cc;padding:14px 16px;border-radius:8px;font-size:14px;line-height:1.6;color:#222">${esc(describe)}</div>
      <p style="color:#aaa;font-size:12px;margin-top:24px">Sent from the aicollective.biz intake form · Reply directly to reach ${esc(email)}.</p>
    </div>`;

  const text = `New AI Collective request (${submittedAt} Regina)\n\nName: ${name || '—'}\nEmail: ${email}\nBusiness: ${business || '—'}\nNewsletter opt-in: ${consent ? 'Yes' : 'No'}\n\nWhat they want AI to do:\n${describe}`;

  if (!RESEND_API_KEY) {
    // No key configured — accept + log so the UI still works in mockup mode.
    console.log('[intake] (no RESEND_API_KEY set) would email:', text);
    return res.json({ ok: true, mock: true });
  }

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [TO_EMAIL],
        reply_to: email,
        subject: `AI request from ${name || business || email}`,
        html, text,
      }),
    });
    if (!r.ok) {
      const detail = await r.text();
      console.error('[intake] Resend error', r.status, detail);
      return res.status(400).json({ ok: false, error: 'We could not send your request just now. Please email hello@aicollective.biz directly.' });
    }
    return res.json({ ok: true });
  } catch (e) {
    console.error('[intake] send failed', e);
    return res.status(400).json({ ok: false, error: 'Something went wrong sending your request. Please try again.' });
  }
});

app.get('/api/health', (req, res) => res.json({ ok: true, hasKey: !!RESEND_API_KEY }));

app.listen(8000, '0.0.0.0', () => console.log('Intake server listening on 8000'));
