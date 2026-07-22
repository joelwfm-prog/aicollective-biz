# Deploy aicollective.biz to DigitalOcean (cms-prototype-01)

Droplet: **cms-prototype-01** · IP **134.122.44.1** · Ubuntu 24.04 · Toronto

This puts the static site at `/var/www/aicollective`, runs the Node backend
(`server.js`) on port 8000 under systemd, and fronts it with Nginx. Cloudflare
(orange cloud) handles public HTTPS.

> Heads-up: this droplet is your `cms-prototype-01` box. The Nginx server block
> below only answers for `aicollective.biz` / `www.aicollective.biz`, so it won't
> collide with anything already using a different `server_name`. If port 80/443
> is already owned by another app (not Nginx), tell me and I'll adjust.

---

## 0. Get the files onto the droplet
From your machine (or the DO console). Easiest is git or scp. Example with scp
from a local copy of this project:

```bash
# from your local project root
scp -r ./aicollective root@134.122.44.1:/var/www/aicollective
```

Or clone from your GitHub if you push it there.

## 1. Install runtime (first time only)
```bash
ssh root@134.122.44.1
apt update && apt install -y nginx nodejs npm
node -v   # need >= 18; if older, install NodeSource 20.x
```

If Node is < 18:
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
```

## 2. Install backend deps
```bash
cd /var/www/aicollective
npm install --omit=dev
```

## 3. Configure the backend (email)
Edit the systemd unit `deploy/aicollective-api.service` BEFORE copying it:
- `RESEND_API_KEY=` → your real Resend key (server-side only).
- `INTAKE_FROM_EMAIL=` →
  - **Option B (now):** `The AI Collective <hello@intheresults.com>`
  - **Option A (later):** `The AI Collective <info@aicollective.biz>`

Then install it:
```bash
cp /var/www/aicollective/deploy/aicollective-api.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now aicollective-api
systemctl status aicollective-api --no-pager
curl -s localhost:8000/api/health   # {"ok":true,"hasKey":true}
```

## 4. Nginx vhost
```bash
cp /var/www/aicollective/deploy/nginx-aicollective.conf /etc/nginx/sites-available/aicollective.biz
ln -s /etc/nginx/sites-available/aicollective.biz /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

## 5. TLS (choose one)
**A) Cloudflare Origin Certificate (recommended, pairs with orange cloud):**
1. Cloudflare → SSL/TLS → Origin Server → **Create Certificate** (15-year).
2. Save the cert to `/etc/ssl/cloudflare/aicollective.pem` and key to
   `/etc/ssl/cloudflare/aicollective.key`.
3. Add a 443 server block (ask me and I'll generate it) pointing at those files.
4. Cloudflare SSL/TLS mode → **Full (strict)**.

**B) Let's Encrypt (if you ever turn the orange cloud grey):**
```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d aicollective.biz -d www.aicollective.biz
```

## 6. DNS
Add the records in `deploy/CLOUDFLARE-DNS.md` (Group 1 = website).
Then visit https://aicollective.biz.

## 7. Verify end-to-end
- Site loads over HTTPS.
- Submit the "Tell us what you want AI to do" form → you get the email.
- (Option A) Resend shows aicollective.biz "verified".

---

## Updating the site later
Re-copy changed files into `/var/www/aicollective` (static files serve
immediately). If `server.js` changed:
```bash
systemctl restart aicollective-api
```
