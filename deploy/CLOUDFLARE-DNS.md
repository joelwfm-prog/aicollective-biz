# Cloudflare DNS — aicollective.biz (copy-paste sheet)

Add these in **Cloudflare → aicollective.biz → DNS → Records**.
Two groups: **(1) point the website at the droplet** and **(2) email sending**.

Droplet: `cms-prototype-01` · **134.122.44.1** · Toronto (tor1)

---

## GROUP 1 — Website (required, do this now)

| Type  | Name  | Content        | Proxy status        | TTL  |
|-------|-------|----------------|---------------------|------|
| A     | `@`   | `134.122.44.1` | **Proxied** (orange) | Auto |
| CNAME | `www` | `aicollective.biz` | **Proxied** (orange) | Auto |

Notes:
- `@` means the root/apex (aicollective.biz). Cloudflare shows it as the bare domain.
- Keep both **Proxied (orange cloud)** so Cloudflare handles HTTPS/CDN in front of the droplet.
- SSL/TLS mode: set **Full (strict)** once the origin cert is installed (see DEPLOY.md). If you hit a redirect loop before the cert is on, temporarily use **Full**.

---

## GROUP 2 — Email sending

### Option B — Launch now, send via intheresults.com (NO new records needed)
intheresults.com is already verified in Resend. The site's backend sends as
`The AI Collective <hello@intheresults.com>`. Inbox shows the "The AI Collective"
name. **Nothing to add in Cloudflare for this option.** Skip to DEPLOY.md.

### Option A — Send from aicollective.biz (after upgrading Resend to a paid plan)
Resend free = 1 domain (currently intheresults.com). To send from
`info@aicollective.biz` you must upgrade Resend, then **Add Domain →
aicollective.biz** in the Resend dashboard. Resend will show you the EXACT
values to paste here (they are unique per account — do not copy from anywhere else).
They will look like this (illustrative — use YOUR dashboard values):

| Type | Name (host)          | Content / Value                                  | Priority | Proxy | TTL  |
|------|----------------------|--------------------------------------------------|----------|-------|------|
| MX   | `send`               | `feedback-smtp.us-east-1.amazonses.com`          | 10       | DNS only (grey) | Auto |
| TXT  | `send`               | `v=spf1 include:amazonses.com ~all`              | —        | DNS only | Auto |
| TXT  | `resend._domainkey`  | `p=MIGfMA0...` (your unique DKIM public key)     | —        | DNS only | Auto |

**Recommended DMARC (add for either option, improves deliverability):**

| Type | Name      | Content                                                        | Proxy | TTL  |
|------|-----------|----------------------------------------------------------------|-------|------|
| TXT  | `_dmarc`  | `v=DMARC1; p=none; rua=mailto:info@aicollective.biz; fo=1`     | DNS only | Auto |

- Start DMARC at `p=none` (monitor only). After a couple weeks of clean sends,
  tighten to `p=quarantine` then `p=reject`.
- **Email records must be "DNS only" (grey cloud), never proxied.** Cloudflare
  cannot proxy MX/TXT for mail — proxying breaks delivery.

---

## After adding records
- Cloudflare DNS usually propagates in seconds to a few minutes.
- Website: visit https://aicollective.biz — should load the site.
- Email (Option A): in Resend, click **Verify** on the aicollective.biz domain;
  it flips to "verified" once DNS is seen.
