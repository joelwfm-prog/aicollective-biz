#!/usr/bin/env bash
# The AI Collective — one-shot droplet setup for aicollective.biz
# Run as root in the DigitalOcean web console on cms-prototype-01 (134.122.44.1).
# Safe to re-run; it only touches its own files/config.
set -euo pipefail

DOMAIN="aicollective.biz"
REPO="https://github.com/joelwfm-prog/aicollective-biz.git"
WEBROOT="/var/www/aicollective"
APP_DIR="/opt/aicollective-api"

echo "==> [1/6] Installing Nginx, git, Node (for optional backend)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y -q
apt-get install -y -q nginx git curl
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null 2>&1
  apt-get install -y -q nodejs
fi

echo "==> [2/6] Pulling the site from GitHub"
rm -rf /tmp/aicollective-src
git clone --depth 1 "$REPO" /tmp/aicollective-src
mkdir -p "$WEBROOT"
# Copy only the static site (exclude backend + internal docs)
rsync -a --delete \
  --exclude 'server.js' --exclude 'package*.json' --exclude 'node_modules' \
  --exclude '.git' --exclude 'deploy' --exclude '*.md' \
  /tmp/aicollective-src/ "$WEBROOT"/
chown -R www-data:www-data "$WEBROOT"

echo "==> [3/6] Optional backend (intake form) — installed but idle unless RESEND key set"
mkdir -p "$APP_DIR"
rsync -a /tmp/aicollective-src/server.js /tmp/aicollective-src/package.json "$APP_DIR"/ 2>/dev/null || true
if [ -f "$APP_DIR/package.json" ]; then
  ( cd "$APP_DIR" && npm install --omit=dev --no-audit --no-fund >/dev/null 2>&1 || true )
  cat >/etc/systemd/system/aicollective-api.service <<UNIT
[Unit]
Description=The AI Collective intake API
After=network.target

[Service]
WorkingDirectory=$APP_DIR
ExecStart=/usr/bin/node $APP_DIR/server.js
Restart=on-failure
Environment=PORT=8000
Environment=INTAKE_TO_EMAIL=joelwfm@gmail.com
Environment=INTAKE_FROM_EMAIL=The AI Collective <hello@intheresults.com>
# To enable email sending later, add your Resend key and reload:
#   systemctl set-environment ... (or edit this file) then: systemctl restart aicollective-api
# Environment=RESEND_API_KEY=re_your_key_here
User=www-data

[Install]
WantedBy=multi-user.target
UNIT
  systemctl daemon-reload
  systemctl enable aicollective-api >/dev/null 2>&1 || true
  systemctl restart aicollective-api || true
fi

echo "==> [4/6] Nginx vhost for $DOMAIN"
cat >/etc/nginx/sites-available/aicollective <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN www.$DOMAIN;

    root $WEBROOT;
    index index.html;

    # Static site
    location / {
        try_files \$uri \$uri.html \$uri/ =404;
    }

    # Intake API -> Node backend (returns graceful error if backend idle)
    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    # Cache static assets
    location ~* \.(css|js|png|jpg|jpeg|svg|ico|woff2?)$ {
        expires 7d;
        add_header Cache-Control "public";
    }
}
NGINX
ln -sf /etc/nginx/sites-available/aicollective /etc/nginx/sites-enabled/aicollective
rm -f /etc/nginx/sites-enabled/default

echo "==> [5/6] Testing + reloading Nginx"
nginx -t
systemctl reload nginx
systemctl enable nginx >/dev/null 2>&1 || true

echo "==> [6/6] Done."
echo "-------------------------------------------------------------"
echo " Site is now served on port 80 for $DOMAIN and www.$DOMAIN."
echo " Cloudflare (orange cloud/Proxied) handles HTTPS at the edge."
echo " In Cloudflare: set SSL/TLS mode to 'Flexible' (or add an"
echo " Origin Certificate + set 'Full') so visitors get HTTPS."
echo " Visit: https://$DOMAIN"
echo "-------------------------------------------------------------"
