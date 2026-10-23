---
"@composurejs/vite": patch
---

`vite dev` allows `.trycloudflare.com` in `server.allowedHosts`, so Vite no longer blocks requests through the quick tunnel. A custom `dev.startTunnel` needs its hostname added by hand.
