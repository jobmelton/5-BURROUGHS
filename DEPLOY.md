# Deploying 5 Boroughs on the Take

Stack:
- **Railway** — runs the always-on Node + Express + **WebSocket** game server.
- **Supabase** — Postgres database for users, sessions, games, leaderboard.
- **GitHub** — source of truth; every push auto-deploys to Railway.

```
You (phone, claude.ai) ─prompt→ Claude ─commit→ GitHub ─auto-build→ Railway ─live→ players
                                                                        │
                                                                    Supabase (data)
```

The server keeps hot game state in memory and **writes through to Supabase** on
every change, so reads are instant and data survives restarts/redeploys. With no
Supabase env vars set it falls back to local JSON files (`./data`) for offline dev.

## One-time setup

### 1. GitHub (the linchpin — enables auto-deploy AND phone prompting)
```bash
gh auth login              # once, in your terminal → "Login with a web browser"
gh repo create five-boroughs-on-the-take --private --source=. --push
```
Or manually: create an empty repo at github.com, then
`git remote add origin <url> && git push -u origin master`.

### 2. Supabase (database)
1. Create a project at https://supabase.com (or reuse an org).
2. **SQL Editor → New query →** paste all of [`supabase/schema.sql`](supabase/schema.sql) → **Run**.
3. **Settings → API** — copy two values:
   - **Project URL**  → `SUPABASE_URL`
   - **service_role** key (under "Project API keys") → `SUPABASE_SERVICE_KEY`
   ⚠️ The service_role key is a secret. It lives only in Railway's env vars and
   your local `.env` — never in the repo, never in the browser.

### 3. Railway (server host)
1. Sign in at https://railway.app **with GitHub**.
2. **New Project → Deploy from GitHub repo →** pick `five-boroughs-on-the-take`.
3. Railway auto-detects Node and runs `npm start` (`node server.js`).
4. **Variables** tab → add:
   - `SUPABASE_URL` = your project URL
   - `SUPABASE_SERVICE_KEY` = your service_role key
5. **Settings → Networking → Generate Domain** for a public URL.

No volume needed — Supabase is the durable store. Future `git push` = auto-deploy.

## Prompting from your phone
Once the repo is on GitHub, open **claude.ai** (web or the mobile app) and connect
the GitHub repo. You can then message Claude to make changes; Claude commits, and
Railway redeploys within a minute or two.

## Environment variables
| Var                     | Purpose                              | Local default        |
|-------------------------|--------------------------------------|----------------------|
| `SUPABASE_URL`          | Supabase project URL                 | *(unset → JSON files)* |
| `SUPABASE_SERVICE_KEY`  | Supabase service_role key (secret)   | *(unset → JSON files)* |
| `PORT`                  | HTTP/WS port (set by Railway)        | `3000`               |
| `DATA_DIR`              | JSON-fallback folder (dev only)      | `./data`             |

See [`.env.example`](.env.example) for a copy-paste template.

## Mobile app (later, optional)
The frontend already reads `window.API_BASE` / `window.WS_URL`, so it can be wrapped
with **Capacitor** into iOS/Android apps that point at the Railway server — no
backend changes. Not needed to ship on the web.
