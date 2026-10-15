# Cloudflare rules for aicollective.biz (PREPARED, NOT APPLIED)

Zone: `aicollective.biz` (nameservers emma/jonah.ns.cloudflare.com). Everything here only adds rules or flips settings, and each item can be undone. Apply them only after Joel confirms. Mira is told before anything changes.

## 1. www → apex 301 (Rules → Redirect Rules → Create rule)
- **Rule name:** `www to apex (301)`
- **When incoming requests match…** Custom filter expression:
  ```
  (http.host eq "www.aicollective.biz")
  ```
- **Then…** URL redirect, **Dynamic**:
  ```
  concat("https://aicollective.biz", http.request.uri.path)
  ```
- **Status code:** 301 · **Preserve query string:** on
- Requires the `www` DNS record to stay **Proxied** (orange cloud), which it already is. No DNS change.
- Verify: `curl -sI https://www.aicollective.biz/about.html` → `301` + `location: https://aicollective.biz/about.html`.
- Undo: disable or delete the rule.

## 2. Always Use HTTPS (SSL/TLS → Edge Certificates)
- Confirm **Always Use HTTPS = On**. This could not be tested from the audit box, which can't make outbound port-80 connections.
- Confirm **SSL/TLS encryption mode = Full (strict)**. Do not use Flexible, even though the old repo setup script suggested it; Caddy terminates TLS at the origin.

## 3. HSTS (SSL/TLS → Edge Certificates → HTTP Strict Transport Security)
Turn on **only after** rules 1 and 2 are confirmed working, because browsers cache HSTS.
- Enable HSTS: **On**
- Max-Age: **6 months (15768000)** to start. Raise to 12 months after a few clean weeks.
- Apply HSTS policy to subdomains (includeSubDomains): **Off** for now. `*.aicollective.biz` subdomains (e.g. a future `draft.`) must all serve HTTPS before this goes on.
- Preload: **Off**
- No-Sniff header: **On**
- Undo: set Max-Age to 0 and keep it there until the old max-age has elapsed, then disable.

## 4. Optional, later: Crawler Hints / IndexNow (Caching → Configuration)
- **Crawler Hints: On**. Cloudflare pings IndexNow (Bing, Yandex, etc.) when pages change.

## Not needed
- No Bulk Redirects for the old playbook URLs. Those 301s are in the Caddy change (`deploy/caddy/aicollective.biz.Caddyfile`).
