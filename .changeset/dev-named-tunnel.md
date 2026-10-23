---
"@composurejs/vite": minor
"create-composurejs": patch
---

The Dev Loop runs your named Cloudflare Tunnel: set `COMPOSURE_DEV_TUNNEL_NAME` (or `dev.tunnelName`) next to `COMPOSURE_DEV_TUNNEL_URL`, and `vite dev` starts it with `cloudflared` (after `cloudflared tunnel login`, or with `COMPOSURE_DEV_TUNNEL_TOKEN`), warning when the tunnel's route for that hostname doesn't reach Vite's port.
