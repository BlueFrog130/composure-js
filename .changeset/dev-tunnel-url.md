---
"@composurejs/vite": patch
"create-composurejs": patch
---

The Dev Loop waits until the tunnel reaches the server before pointing the dev application at it, so Discord no longer caches the quick tunnel's not-yet-existing hostname and fails every retry; it retries for about a minute and, on failure, says whether `DISCORD_PUBLIC_KEY` belongs to another application. `COMPOSURE_DEV_TUNNEL_URL` uses a tunnel you already run instead of a quick tunnel, and allows its host.
