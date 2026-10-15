# aicollective.biz: operator steps for the Oct 2026 SEO/AEO fix PR

Nothing below has been done. Each step needs Joel's direct go-ahead. Server steps are run as root on `cms-prototype-01` (DigitalOcean, 134.122.44.1 per repo docs). Never paste secret values into chat, tickets, or the repo.

## What deploys how (important)
| Piece | How it reaches production |
|---|---|
| Static site (HTML, assets, llms.txt, 404.html, privacy.html, sitemap.xml) | **Vyb6 publish → `deployLive`**: `git fetch` + `reset --hard origin/master` in the live clone, then rsync into `/var/www/aicollective`. |
| `server.js` (intake/newsletter API) | **Not deployed by Vyb6.** Vyb6's rsync excludes `server.js`/`package*.json`. The API runs from its own directory and must be updated by hand (step B). |
| Caddy vhost | Manual edit of `/etc/caddy/Caddyfile` (step C). |
| Edge rules / HSTS / DNS TXT | Cloudflare dashboard (step E, `deploy/cloudflare-rules.md`). |

## A. Find where the API runs and where its env lives (read-only)
```bash
systemctl list-units --type=service | grep -i aicollective     # systemd? (repo setup script used "aicollective-api")
systemctl cat aicollective-api 2>/dev/null                      # shows WorkingDirectory + Environment= lines
pm2 ls 2>/dev/null                                              # or PM2? (Vyb6 itself runs under PM2 as root)
ss -ltnp | grep ':8000'                                         # which process owns :8000
cat /proc/$(ss -ltnp | awk '/:8000/{print $NF}' | grep -o 'pid=[0-9]*' | cut -d= -f2)/environ | tr '\0' '\n' | grep -E '^(DATA_DIR|PORT|INTAKE_|RESEND|NOTIFY|CUSTOM_CRED)' | sed 's/=.*/=<set>/'
```
The last command lists **names only** (values masked). Record:
- the API directory (repo default `/opt/aicollective-api`)
- the `DATA_DIR` (Vyb6 expects `/var/lib/aicollective`)
- whether env comes from the systemd unit, a drop-in, an `EnvironmentFile=`, or a PM2 ecosystem file

## B. Rotate NOTIFY_TOKEN and ship the fail-closed server.js
The old fallback token `aic-notify-7Kq2wLmZ` is in public git history. Treat it as leaked whether or not prod set its own value.
1. Back up leads first: `cp -a "$DATA_DIR" "/root/aicollective-data-backup-$(date +%F)"`.
2. Generate a token on the server: `openssl rand -hex 32` (64 chars; the new code requires at least 24).
3. Set it as a secret env var, not in the repo:
   - **systemd:** `systemctl edit aicollective-api` →
     ```
     [Service]
     Environment=NOTIFY_TOKEN=<paste>
     ```
     (or put it in a root-only `EnvironmentFile=/etc/aicollective-api.env`, mode 600)
   - **PM2:** add `NOTIFY_TOKEN` to the app's ecosystem `env`, then `pm2 restart <app> --update-env && pm2 save`.
4. Copy the new `server.js` from this PR's merged `master` into the API directory. Keep `package.json` unless it changed (it didn't). Restart: `systemctl restart aicollective-api` (or `pm2 restart <app> --update-env`).
5. Verify:
   - `curl -s https://aicollective.biz/api/health` → `{"ok":true,...}`
   - `curl -s -o /dev/null -w '%{http_code}\n' 'https://aicollective.biz/api/subscribers?token=aic-notify-7Kq2wLmZ'` → `403`
   - `curl -s -H "Authorization: Bearer $NEW" https://aicollective.biz/api/subscribers | head -c 80` → `{"ok":true,...`
   - If NOTIFY_TOKEN were missing, the endpoint now returns `503 disabled` instead of using a default.
6. Give the new token to whatever "notification checker" polls `/api/subscribers`. None was found in the agent box. If nothing uses it, leave it unset and the endpoint stays disabled.

## C. Turn on lead email notifications (`canSend`)
`/api/health` currently says `"canSend": false`, so leads only go to CSV.
1. In Resend (resend.com → API Keys), create a **sending-only** key for this site.
2. Sender: `aicollective.biz` is **not** a verified Resend domain (no DNS records). Per the repo's DNS notes, `intheresults.com` is verified, so set the From to that domain unless Joel verifies aicollective.biz.
3. Add to the same env location as step B:
   ```
   RESEND_API_KEY=<re_...>
   INTAKE_FROM_EMAIL=The AI Collective <hello@intheresults.com>
   INTAKE_TO_EMAIL=<where Joel wants leads; code default joelwfm@gmail.com>
   ```
4. Restart the API. `curl -s https://aicollective.biz/api/health` → `"canSend":true`.
5. Test (Joel only): submit the AI Solutions form once with his own address and confirm the email arrives (see "Live test POST" below).

## D. Caddy: real 404s + 301s (apply right after the static publish, same sitting)
Order matters:
- If the publish lands first, old `playbook-*.html` URLs fall back to the homepage until Caddy is changed.
- If Caddy changes first, the 301s point at pages that aren't live yet.

So publish (step F) first, then immediately:
1. `cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak-$(date +%F)`
2. Merge `deploy/caddy/aicollective.biz.Caddyfile` into the existing `aicollective.biz` block. Keep the existing site address, `tls` line, and API upstream.
3. `caddy validate --config /etc/caddy/Caddyfile && systemctl reload caddy`
4. Optional: also change `try_files` in the **draft** vhost (`aicollective-draft.vyb6.com`) to `try_files {path} {path}.html` so preview matches live.
5. Verify:
   - `curl -sI https://aicollective.biz/nope` → 404
   - `curl -sI https://aicollective.biz/index.html` → 301 to `/`
   - `curl -sI https://aicollective.biz/playbook-a.html` → 301 to `/get-cited-by-chatgpt-ai-search.html`
   - `curl -s https://aicollective.biz/llms.txt | head -1` → `# The AI Collective (aicollective.biz)`
6. Rollback: restore the `.bak` file and `systemctl reload caddy`.

## E. Cloudflare
See `deploy/cloudflare-rules.md` (www → apex 301, Always Use HTTPS / Full (strict), then HSTS). Add-only.

## F. Publishing the static site through Vyb6
- **Mechanism:** Vyb6 managed-sites portal → the site's page → **Publish**. That is the `POST /api/managed/<siteId>/publish` route, which is **owner-only**. Platform admin/founder accounts are deliberately blocked, so **Joel must click it** while signed in as the site owner. There is no CLI, and no CI job publishes.
- What it does:
  1. Compares `master` with the draft branch.
  2. If the draft is behind `master` (it will be, once this PR merges), it **merges `master` into the draft and returns "your site was updated by your web team — check the preview and publish again"**.
  3. Joel checks the preview (`aicollective-draft.vyb6.com`) and clicks **Publish a second time**.
  4. It requires the draft's GitHub "Content CI" check to be green, fast-forwards `master`, then runs `deployLive` (git reset + rsync to `/var/www/aicollective`) and emails Joel "Your changes … are live".
- Caveat: if the draft has **no** commits ahead of `master`, publish returns "No unpublished changes" and does **not** redeploy. Today the `draft` branch has 2 commits ahead (an AI edit and its revert, net zero), so the two-click flow above should work. Otherwise an operator runs the same thing `deployLive` does, on the droplet:
  ```bash
  cd <liveCloneDir>            # from the site's deploy_config in Vyb6, e.g. /srv/managed/aicollective/live
  git fetch origin master && git reset --hard origin/master
  rsync -a --delete --exclude .git --exclude templates --exclude content --exclude build \
    --exclude node_modules --exclude data --exclude server.js --exclude package.json \
    --exclude package-lock.json --exclude deploy --exclude CONTENT-CALENDAR.md \
    --exclude .gitignore --exclude .github ./ /var/www/aicollective/
  chown -R www-data:www-data /var/www/aicollective
  ```
- Live has not been redeployed since Jul 28, 2026. This PR reverts the unshipped podcast commits on `master`, so publishing does **not** ship the podcast.

## Live test POST (describe only; don't send without Joel)
A real end-to-end check of production intake needs one genuine submission. It will be written to `intake.csv` (and emailed once `canSend` is on):
```bash
curl -s -X POST https://aicollective.biz/api/intake -H 'Content-Type: application/json' \
  -d '{"name":"Joel test","email":"<Joel's address>","business":"Test","describe":"TEST - please ignore: checking the intake form end to end.","consent":false}'
# expect {"ok":true,"emailed":true|false}
```
Better: Joel submits the form in a browser at https://aicollective.biz/ai-solutions.html after the publish. DevTools → Network should show `POST https://aicollective.biz/api/intake` → 200. Afterwards, delete the test row from `$DATA_DIR/intake.csv`. Note that `emailed` currently also reports `true` when no send credential is set (the mock path), so check `/api/health` → `canSend` too.

## G. Google Search Console + Bing (plan; Joel signs in as joelwfm@gmail.com)
1. search.google.com/search-console → **Add property → Domain** → `aicollective.biz`.
2. Google shows a TXT value `google-site-verification=…`. Add it in Cloudflare DNS: **Type TXT, Name `@`, Content `<that value>`, TTL Auto** (TXT records are never proxied). It only adds a record and doesn't affect the site. Tell Mira first. GSC may offer one-click Cloudflare verification; either is fine.
3. Click **Verify**, then Sitemaps → submit `https://aicollective.biz/sitemap.xml`. URL Inspection → Request indexing for `/`, the 6 playbooks, `/ai-solutions.html`.
4. **Bing Webmaster Tools** (bing.com/webmasters) → sign in with the same Google account → **Import from Google Search Console** → select aicollective.biz. This brings over the verified site and sitemap with no extra DNS.
5. Optional: Cloudflare Crawler Hints (IndexNow) on, per `cloudflare-rules.md`.
