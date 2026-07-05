# Deploying 5 Boroughs on the Take

This is a stateful **Node + Express + WebSocket** multiplayer server, so it needs a
host that runs a long-lived process (not Netlify/Vercel static hosting).
Target host: **Railway**. Data persists on a Railway **volume** mounted at `/data`.

## The pipeline

```
You (phone, claude.ai) ─prompt→ Claude ─commit→ GitHub ─auto-build→ Railway ─live→ players
```

Every push to the GitHub repo's default branch triggers a fresh Railway build & deploy.

## One-time setup

### 1. GitHub (linchpin — enables auto-deploy AND phone prompting)
```bash
gh auth login              # once, in your terminal
gh repo create five-boroughs-on-the-take --private --source=. --push
```
Or manually: create an empty repo at github.com, then
`git remote add origin <url> && git push -u origin master`.

### 2. Railway
1. Go to https://railway.app and sign in **with GitHub**.
2. **New Project → Deploy from GitHub repo →** pick `five-boroughs-on-the-take`.
3. Railway auto-detects Node and runs `npm start` (`node server.js`).
4. **Add a Volume** (right-click service → *Add Volume*), mount path: `/data`.
5. **Variables** tab → add `DATA_DIR=/data` so game/user/session state persists
   across deploys.
6. Railway assigns a public URL under **Settings → Networking → Generate Domain**.

That's it — future `git push` deploys automatically.

## Prompting from your phone
Once the repo is on GitHub, connect it in **claude.ai** (web or mobile app).
You can then message Claude to make changes; Claude commits to GitHub, and Railway
redeploys within a minute or two.

## Environment variables
| Var        | Purpose                          | Local default |
|------------|----------------------------------|---------------|
| `PORT`     | HTTP/WS port (set by Railway)    | `3000`        |
| `DATA_DIR` | Where JSON state is written      | `./data`      |

## Notes / future upgrade
- State is currently flat-JSON files (`db.js`). The Railway volume makes this durable
  and is fine for a single server instance.
- If you later need multi-instance scaling or richer leaderboard queries, migrate
  `db.js` to Postgres (Railway offers a managed Postgres add-on). The whole storage
  layer is isolated to `db.js`, so it's a contained change.
