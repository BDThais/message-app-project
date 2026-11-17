# Deployment plan

How to put the app on the internet, why this way, and what to do after it is there. The code and configuration for it are in the repository: `Dockerfile`, `render.yaml`, `server/.env.production.example`, `server/scripts/smoke-test.mjs`, and the hardening described in "What changed in the code" below.

This was written on 2026-11-13 without access to a real host. Section 11 lists what has been tried and what has not. Prices and plan names are from the vendors' pages and from write-ups of them in November 2026; they change often, so check the price on the page before you pay.

## 1. The picture

On your computer the app is three programs: the Vite dev server (port 5173, the frontend), the Node server (port 3000, the API and the sockets) and Postgres. The Vite server forwards `/api` and `/socket.io` to the Node server, so the browser only ever talks to one address.

In production the same idea is kept, with fewer pieces:

```text
 Browser ──https──> [ the host's front door ] ──http──> [ one Node process ] ──> [ Postgres ]
                     (HTTPS certificate,                  API + sockets +            (only the Node
                      http → https redirect)              the built frontend          process can reach it)
                                                          files
                                                               │
                                                               └──> Resend (sends the emails)
```

The words, in plain terms:

- **The front door is a reverse proxy.** The host puts a server of its own in front of yours. It holds the HTTPS certificate (the padlock), turns `http://` into `https://`, and passes each request on to your process over its private network. Your process never sees the internet directly. One consequence matters a lot to this app and has its own section (section 5, "Finding the right `TRUST_PROXY`"): your process sees the proxy's address as the sender of every request, and has to be told how to find the real visitor's address in the headers the proxy adds. The login rate limit (10 tries per 15 minutes per address) depends on it.
- **One origin.** The page, the API and the sockets are all at the same address (`https://chat.example.com`). This is why the session cookie can stay a first-party `SameSite=Lax` cookie and the server needs no CORS settings. In production the Node server itself serves the built frontend files (`FRONTEND_DIST`), so there is nothing else to host and nothing to keep in step.
- **A Docker image** is a frozen copy of the app and everything it needs to run (the right Node version, the installed packages, the built files). The host builds it from the `Dockerfile` at every deploy and runs it. It runs the same on every host, which is why this plan does not depend on one company.
- **Migrations run before the new version takes traffic.** `prisma migrate deploy` applies the new migration files to the database. The host runs it as a "pre-deploy command" on the new version, and cancels the deploy if it fails, so a bad migration never goes live half-way.
- **One instance.** The rate limits are counted in memory and the socket rooms live in memory, so two copies of the server would each have half the picture. The app is built to run as exactly one instance. That is plenty for a long time (section 8 says what the limit looks like and what to do then).

## 2. Decisions

### What the app needs from a host

| Need | Why | Rules out |
| --- | --- | --- |
| A long-running Node process that accepts WebSockets | Socket.io keeps a connection open for as long as the page is open | Serverless platforms: Vercel and Netlify functions, Cloudflare Workers/Pages Functions (a function ends after each request) |
| Always on | A host that stops an idle service closes every socket and makes the next visitor wait for a cold start | "Free" web services that sleep (Render's free web service sleeps after about 15 minutes of no traffic) |
| Exactly one instance | See above | Hosts whose default is two or more copies (Fly.io does this unless told otherwise) |
| PostgreSQL 18, with backups | The test suite runs on 18; the data is the one thing you cannot rebuild | Free databases that expire or have no restore (Render's free database expires after 30 days) |
| A region near Vietnam | Every message makes a round trip | Hosts with only US/EU regions. Singapore is the closest region the usual hosts offer |
| The ability to run a command before a deploy goes live | Migrations | Hosts without one (you would run migrations by hand) |

### The candidates

| Stack | About, per month | How it feels | Main catch |
| --- | --- | --- | --- |
| **Render**: web service (Starter) + Render Postgres (basic-256mb), both in Singapore | about 13 USD (7 + 6) | Connect the GitHub repository, fill in a form, done. Managed database with point-in-time recovery, private network between the two, free HTTPS and custom domain, `render.yaml` describes it all | The cheapest always-on plan is 512 MB, which is enough here; the region cannot be changed later |
| **Railway**: one service + a Postgres service, Singapore | about 8 to 12 USD, varies | Very similar to Render, pleasant dashboard, deploys from the same `Dockerfile` | Usage-based billing (you pay for the memory and CPU actually used), so the bill moves; the 5 USD Hobby plan includes 5 USD of usage |
| **Fly.io** (Singapore) + **Neon** free Postgres (Singapore) | about 0 to 6 USD | The cheapest. Fly bills per second of machine time, and a small invoice (under 5 USD) is waived | Two vendors; Fly is driven from a command-line tool and its default is two machines (you must set one); Neon's free database sleeps after 5 minutes without queries, so the first request after a quiet period pays a wake-up delay; Fly's own managed Postgres starts at 38 USD, which is why it is not in the stack |
| **A VPS** (DigitalOcean, Vultr, Hetzner...) with Docker Compose, Caddy and Postgres in a container | about 6 to 15 USD | The most you learn, the most you control | You are the operator: OS updates, firewall, certificates, backups, restoring. Hetzner has been the cheap default, but it raised prices in 2026 and its Singapore plans are not the bargain they were, so compare before choosing |

### The choice

**Render, in Singapore, with Resend for mail.** Reasons, in order of weight:

1. Everything the app needs is one form away: a service that is always on and takes WebSockets, a database with backups in the same data centre, a pre-deploy command, a health check, HTTPS, a custom domain. You will meet the fewest unfamiliar tools on the way to a first deployment, which matters more than 5 USD when you cannot test the deployment beforehand.
2. The app is portable: the `Dockerfile` is the only thing the host needs. If Render's price or service changes, moving to Railway or Fly is an afternoon (section 9).
3. Managed Postgres with point-in-time recovery means the thing you cannot recreate (the data) is somebody else's job to keep safe.

If the cost matters more than the convenience, take **Fly.io + Neon**; section 9 lists what changes. If you want to learn how servers run, take the **VPS**; do that once the app is live somewhere safe, not for the first deployment.

### The other pieces

| Piece | Choice | Notes |
| --- | --- | --- |
| Email | **Resend** (already in the code) | The free plan has been 3,000 emails a month and 100 a day. A flood of sign-ups would use the day's 100 and then no more verification mails go out: watch the Resend dashboard. You need a **domain** to send from |
| Domain | Any registrar (Cloudflare Registrar sells at cost; Namecheap and Porkbun are fine) | About 10 to 15 USD a year. Use a subdomain such as `chat.yourdomain.com` if you want the apex for something else |
| DNS | The registrar's, or Cloudflare in "DNS only" mode (grey cloud) | Do not turn on Cloudflare's proxy (orange cloud) for the first deployment: it adds a second proxy in front of Render, which changes the answer to the `TRUST_PROXY` question (section 5) |
| Uptime alerts | UptimeRobot or Better Stack (free) | Watch `https://your-domain/api/health/ready`; it fails when the database is unreachable |
| Backups | Render's own, plus a monthly `pg_dump` you keep somewhere else | Section 7 |
| Error reports | None to begin with | The logs are enough for a first deployment. Sentry's free plan is the usual next step |

## 3. What changed in the code

The sandbox could not deploy, but the things a deployment depends on were missing, and are now in the repository. Each one has tests, and each was checked by breaking it on purpose to see that a test noticed.

| Change | Why it was needed |
| --- | --- |
| `TRUST_PROXY` setting, required in production, applied as Express's `trust proxy` | Behind a proxy, every request seems to come from the proxy's address, so all visitors would share one login budget: ten wrong passwords from anyone would lock everybody out. And a wrong setting in the other direction lets a visitor invent their own address and walk around every limit. See section 5 |
| `LOG_CLIENT_IP` (temporary diagnostic) | Logs, for the first 10 requests, what the server made of the visitor's address and what it was made from. It is how you find the right `TRUST_PROXY` on a host that was never tried |
| `APP_ORIGIN` setting, required in production; a socket from a page on another origin is refused | A WebSocket handshake is not covered by CORS, and `SameSite=Lax` only keeps other *sites* out, not other origins of the same site. Checking the `Origin` header is the standard fix. The REST API did not need it: a cross-origin request with a JSON body needs a CORS preflight, which the server never answers |
| A socket is closed when its session expires | The session was checked once, when the socket connected. A tab left open for a week kept receiving messages after the login had expired |
| Security headers (helmet): Content-Security-Policy, HSTS (180 days), `X-Content-Type-Options`, frame protection, no `X-Powered-By` | A browser decides what a page may load and do by these headers. The policy allows the page's own scripts only, any `https` image (avatars are addresses of images anywhere), and the page's own origin for the API and the socket |
| `GET /api/health` (up) and `GET /api/health/ready` (up and the database answers) | The host needs a URL to ask whether the server is alive; a monitor needs one that also proves the database works. The first does not touch the database on purpose: a database outage should not get a healthy server restarted |
| Graceful shutdown on SIGTERM/SIGINT | Every deploy stops the old version with SIGTERM. Without a handler Node exits at once, dropping requests in flight. Now it stops taking connections, closes the sockets (their pages reconnect to the new version and catch up), finishes requests, closes the database connections, and leaves; after 10 seconds it leaves anyway |
| The server serves the built frontend (`FRONTEND_DIST`) | One origin, one thing to host. Hashed files under `assets/` are cached for a year; `index.html` and the favicon are always revalidated; a path with no extension is a screen of the app (`/chat/3`) and gets `index.html`; a missing file with an extension is a 404, and `/api/...` keeps answering JSON |
| Startup checks for `DATABASE_URL`, `APP_ORIGIN`, `TRUST_PROXY` and `FRONTEND_DIST` | A deployment with a missing or malformed setting stops at startup and says why, instead of running wrong. `DATABASE_URL` used to default to the text `backup_database_url_here`, which hid a missing setting behind a confusing connection error |
| `prisma` moved from `devDependencies` to `dependencies` | The migration command runs from the production image, so the Prisma command-line tool has to be installed there |
| The four route files use `Router` from Express instead of calling `express()` | `import Router from 'express'` gives the *app* factory, so each router was a small separate app with its own settings (it re-added the `X-Powered-By` header that was meant to be gone, and took `trust proxy` by inheritance, which works but is fragile). `import { Router } from 'express'` is what was meant |
| `.dockerignore` fixed | It listed `.env` and `.env.*` without `**/`, which only matches at the repository root: `server/.env` would have been copied into the image. Environment files are now excluded everywhere, as is generated code, so a stale copy cannot win over the image's own build |

### The settings

Every setting the server reads is in `server/.env.production.example`. The ones that matter for a deployment:

| Setting | In production | Meaning |
| --- | --- | --- |
| `NODE_ENV` | `production` | Turns on the production rules below, and the `Secure` flag on the session cookie |
| `DATABASE_URL` | required | The Postgres connection string. On Render, the database's *internal* connection string, filled in by `render.yaml` |
| `APP_ORIGIN` | required, `https://...` | The one origin the app is opened at: scheme and host, no path, no trailing slash (`https://chat.example.com`). Used for the socket origin check and the security headers |
| `TRUST_PROXY` | required | How many proxies are in front: `1` on Render, Railway and Fly (to be confirmed, section 5), `0` when none. Never `true` |
| `EMAIL_VERIFICATION_URL`, `PASSWORD_RESET_URL` | required | Where the mailed links point: `https://chat.example.com/verify-email` and `/reset-password` |
| `MAIL_TRANSPORT`, `RESEND_API_KEY`, `MAIL_FROM` | `resend`, a key, a sender on a verified domain | The console transport only logs mail, so production refuses to start with it |
| `SESSION_COOKIE` | `__Host-session` | A name with the `__Host-` prefix: the browser then accepts the cookie only over https and only for exactly this host, and refuses it from any other source. The cookie already meets the prefix's rules (`Secure`, path `/`, no domain) |
| `FRONTEND_DIST` | set by the Docker image | Where the built frontend is. When set, the server serves it |
| `LOG_CLIENT_IP` | off | Temporary, section 5 |

## 4. First deployment, step by step

Allow an afternoon. The domain is the first cost; Render starts billing in step 2, when the service and the database are created.

### Before you begin

1. Apply the patches, so the repository on GitHub has the Socket.io work, the hardening and the deployment files. Run `npm run check` at the repository root and the tests in `server/` and `frontend/`.
2. Decide the address, for example `chat.yourdomain.com`, and buy the domain if you have none.

### Step 1: email (Resend)

1. Create a Resend account and **add your domain** (Domains > Add). Resend shows DNS records (SPF, DKIM, and a suggested DMARC). Add them where your DNS is managed, wait until Resend shows the domain as *Verified* (minutes to hours).
2. Create an API key with **sending access only** (API Keys). Keep it for step 3.
3. The sender will be `Message App <no-reply@yourdomain.com>`: the address has to be on the verified domain.

### Step 2: the database and the service (Render)

1. Create a Render account, connect GitHub, and pick the repository: **New > Blueprint**. Render reads `render.yaml` and shows a database (`message-app-db`, Singapore, basic-256mb) and a web service (`message-app`, Singapore, Starter).
2. It asks for the values marked `sync: false`. Enter:
   - `TRUST_PROXY`: `1`
   - `APP_ORIGIN`: `https://chat.yourdomain.com`
   - `EMAIL_VERIFICATION_URL`: `https://chat.yourdomain.com/verify-email`
   - `PASSWORD_RESET_URL`: `https://chat.yourdomain.com/reset-password`
   - `RESEND_API_KEY`: the key from step 1
   - `MAIL_FROM`: `Message App <no-reply@yourdomain.com>`
3. Apply. Render builds the image (several minutes the first time), runs `npx prisma migrate deploy` against the new database, starts the server, and waits for `/api/health` to answer.
4. Open the service's **Logs**. You should see the migration list applied, then `Server is running on port 10000`. If the service stops at startup, the log names the setting that is wrong (section 11 lists the messages).

If the Blueprint form rejects the file, run `render blueprints validate` with Render's command-line tool, or create the two resources by hand in the dashboard with the same values: the Blueprint is a convenience, not a requirement.

### Step 3: your domain on the service

1. In the service's **Settings > Custom Domains**, add `chat.yourdomain.com`. Render shows the DNS record to create (a CNAME for a subdomain).
2. Create it at your DNS provider (DNS only, no proxy). Render issues the HTTPS certificate by itself when the record is seen.
3. Open `https://chat.yourdomain.com`: you should get the sign-in page with a padlock.

### Step 4: find the right `TRUST_PROXY` (do not skip this)

Section 5 explains why. The test takes five minutes:

1. In the service's environment, add `LOG_CLIENT_IP` = `true`. The service restarts.
2. On your computer run `curl https://ifconfig.me` and note your public address (or use any "what is my IP" page; use the same network for the next step).
3. Open `https://chat.yourdomain.com/api/health` in the browser, then read the Render logs for lines that start with `client ip check`. Each shows `req.ip`, `req.ips`, `x-forwarded-for` and `socket`.
4. Read the result:
   - `req.ip` is **your address**: `TRUST_PROXY=1` is right.
   - `req.ip` is **a different address that is the same on every request, whoever makes it** (a Render or Cloudflare address), and your address is in `x-forwarded-for` *before* it: set `TRUST_PROXY=2` and repeat.
   - `x-forwarded-for` is `null` and `socket` is a private address (`10.x`, `172.16-31.x`): the host does not add the header at all; set `TRUST_PROXY=0` and the limits will see the proxy's address, which means one budget for everybody. Tell me, and the code needs another way to find the visitor.
5. Confirm with behaviour: from your computer try to sign in with a wrong password 11 times; the 11th answer is "Too many attempts". Then, from your phone on mobile data (a different address), sign in with a wrong password once: it must **not** be refused. Both results together prove the limit counts addresses one by one.
6. Remove `LOG_CLIENT_IP` (it logs visitors' addresses, which are personal data).

### Step 5: the smoke test

From your computer, in the repository (`npm ci` in `server/` once):

```text
node server/scripts/smoke-test.mjs https://chat.yourdomain.com
```

It checks the health endpoints, that the app and a deep link are served, that an unknown API path is a JSON 404 and a protected endpoint is a 401, the security headers, the http to https redirect, and that a socket without a session or from another origin is refused. Every line should say `ok`.

### Step 6: use it like a person

On the deployed address, with two accounts (a second browser or a phone):

1. Sign up with a real email. The verification mail must arrive and its link must work.
2. Sign in, send a friend request from the second account, accept it from the first. Both lists should update on their own.
3. Open a chat, send a message: it must appear on the other screen without a refresh, and the typing line must show while the other person types.
4. Edit and delete a message; create a group; remove a member. The other screen follows each.
5. Request a password reset; the mail must arrive and the link must work. After resetting, the old session must be signed out.
6. In the Render dashboard, trigger a manual deploy while a chat is open. The page should reconnect on its own and no message should be lost.

When all of that works, the app is deployed.

## 5. Finding the right `TRUST_PROXY`

The login limit says "10 tries per 15 minutes per address". For the server to know a visitor's address, it reads the `X-Forwarded-For` header the proxy adds, a list of addresses with the oldest (the visitor's) first and each proxy appending the address it saw. The server must be told how many of the *last* entries were added by proxies it trusts, and take the one before them.

- **Too low** (for example `0` behind one proxy): the server takes the proxy's own address as the visitor's. Everyone shares one budget, so one person's ten wrong passwords lock out all of them. It looks fine until the first time it happens.
- **Too high**, or `true`: the server trusts entries the visitor wrote. A visitor sends `X-Forwarded-For: 1.2.3.4` and is a new person for the limiter on every request, so the limit protects nothing.
- **Right**: the number of proxies you really have. On Render it should be `1`, but Render's own documentation and what people report disagree about whether another layer sits in front, which is why step 4 measures it instead of trusting a number. If you later put Cloudflare's proxy in front, add one.

The server refuses to start in production without an explicit `TRUST_PROXY`, and refuses `true`, so it cannot be left at a default by accident.

## 6. What to watch after launch

- **Logs** (Render > Logs): errors are written with `console.error` and have a prefix saying where. Look at them after the first real day.
- **Uptime**: an UptimeRobot (or Better Stack) check on `/api/health/ready`, alert by email. Render also emails when a deploy fails.
- **Resend**: the dashboard shows bounces and the daily count. Keep it under 100 a day on the free plan.
- **Disk**: the database plan has a storage limit (it is on the database's page in the dashboard). Messages are text, so it will take a long time to fill, but check the size once a month. The `sessions` and token tables grow with sign-ins and are only cleaned when the same person signs in again (known limit, section 8).
- **Dependencies**: run `npm audit` in both folders now and then, and update Node's major version when its LTS changes (the `Dockerfile` pins `node:22`).

## 7. Running it

### Deploying changes

- `autoDeployTrigger: commit` deploys every push to the connected branch. Push to a branch, merge when `npm run check` and the tests are green, and the merge deploys.
- Each deploy builds a new image, runs `npx prisma migrate deploy` on it, starts it next to the old one, waits for `/api/health`, then moves traffic and stops the old one (with SIGTERM). A deploy briefly restarts the sockets; pages reconnect and catch up by themselves. The in-memory rate limits start from zero.
- **Rolling back** the code: Render > Deploys > redeploy a previous one. This does **not** undo migrations, so:

### Migrations, safely

While the old and the new version overlap, and after a rollback, the old code runs against the new schema. So a migration must keep working with the code before it:

1. **Add, do not change, in one deploy**: new columns nullable or with a default, new tables, new indexes. The old code ignores them.
2. **Remove in a later deploy**: only after no running code reads the column or table, drop it in its own migration.
3. **Renaming** is "add the new, copy, switch the code, drop the old" over several deploys.
4. Never edit a migration that has been applied anywhere. Make a new one.
5. Try every migration on a copy of real data's shape before it ships (`prisma migrate dev` against a local database, with some rows in the tables).

### Backups, and restoring

- Render's paid Postgres keeps point-in-time recovery for a few days (3 days on the Hobby workspace plan when this was written) and logical exports for a week. That covers "I deleted something by mistake yesterday".
- That is not a backup you hold. **Once a month** keep a copy somewhere else: allow your own address in the database's *Access Control* (Render dashboard), then

  ```text
  pg_dump --format=custom --no-owner "EXTERNAL_DATABASE_URL" > message-app-$(date +%F).dump
  ```

  and remove your address again afterwards. Keep the file in storage that is not Render (a cloud drive, a USB disk).
- **Test a restore once**, before you need it: create an empty database locally, `pg_restore --no-owner -d postgres://... message-app-xxxx.dump`, start the server against it, sign in. A backup that has never been restored is a hope.

### Secrets

The only secret is the Resend key (the database URL is passed between Render's resources, and sessions are random identifiers stored in the database, so there is no signing key to protect). Rotate it in Resend and in the service's environment if it leaks. Never put it in the repository; `.env*` files are in `.gitignore` and `.dockerignore`.

## 8. Limits to know, and what to do about them

- **One instance.** The rate limits and the socket rooms are in memory. When one instance is not enough (hundreds of people online at once, not tens), the steps are: Socket.io's Redis adapter (rooms and emits across instances, and `socketsJoin`/`socketsLeave` become asynchronous), the rate limiters' Redis store, and sticky sessions if the host has them. Until then, a bigger instance is the answer.
- **Sessions and tokens pile up.** An expired session is deleted when its owner signs in again or when it is looked up; one that is never used again stays. The same holds for used or expired mail tokens. A scheduled cleanup (like the empty-room one) would fix it; the rows are small.
- **A deleted account does not tell the rooms.** Its memberships go with it and the other members' member lists are right only the next time they are fetched.
- **No error reports, no request log.** Add them when there is something to look for.
- **Socket join/leave race**: a socket that reads its rooms just before a removal commits can stay in the removed room's socket room until it reconnects. A window of milliseconds.

## 9. Other hosts: what changes

The `Dockerfile` is the same everywhere. What differs:

- **Railway.** New project > Deploy from GitHub repository; it finds the `Dockerfile`. Add a Postgres service, reference its connection URL as `DATABASE_URL` (a variable reference), set the same variables, region Singapore. Put `npx prisma migrate deploy` in the pre-deploy command of the service settings. Health check path `/api/health`. `TRUST_PROXY`: measure with step 4.
- **Fly.io + Neon.** `fly launch --no-deploy` (accept the Dockerfile, pick region `sin`; leave `PORT` unset, the server's default 3000 is what `internal_port` says). In `fly.toml`: `[deploy] release_command = "npx prisma migrate deploy"`, `[http_service] internal_port = 3000, force_https = true, auto_stop_machines = "off", min_machines_running = 1`, and a health check on `/api/health`. Run **one** machine: `fly scale count 1` (Fly's default is two, and the app is built for one). Secrets with `fly secrets set KEY=value`. Database: a Neon project in `aws-ap-southeast-1` (Singapore); use the *pooled* connection string for the app, the *direct* one for migrations if the pooled one refuses them; add `?sslmode=verify-full` to the URL. `TRUST_PROXY`: measure.
- **A VPS.** Install Docker, build the image on the server (`docker build -t message-app .`) or push it to a registry; run Postgres 18 in a container with a volume (and take your own backups: a nightly `pg_dump` to somewhere else); run the app with `--env-file`, `-p 127.0.0.1:3000:3000`, `--restart unless-stopped`; run migrations with `docker run --rm --env-file ... message-app npx prisma migrate deploy` before starting a new version. Put **Caddy** in front: a `Caddyfile` of `chat.yourdomain.com { reverse_proxy 127.0.0.1:3000 }` gets a certificate by itself and passes WebSockets without more settings. `TRUST_PROXY=1`. Open only ports 22, 80 and 443 in the firewall and keep the OS updated.

## 10. Before you invite strangers

- **Personal data.** The app stores names, email addresses and phone numbers, and the messages themselves. If real people in Vietnam use it, Vietnam's personal data rules apply to you as the one who processes it. Since 1 January 2026 that is the Law on Personal Data Protection (Law 91/2025/QH15) with its implementing Decree 356/2025/ND-CP, which replaced the Decree 13/2023 many older guides still cite. In short, as law firms describe it: consent is the main legal basis for processing, and it has to be clear, informed, and kept in a way that lets you show when and to what the person agreed; people have the right to see, correct and delete their data (the account deletion already in the app covers the last); small businesses and startups get a five-year grace period for some of the organisational duties (such as appointing a data protection officer) if they stay small and do not process sensitive data in large amounts. In practice for this app: write a short privacy notice (what is collected, why, who else sees it: the host and Resend, how to delete the account) and make signing up mean agreeing to it, with a checkbox or a visible line that you can show later. I am not a lawyer, and this area is new and changing: read the current rules, or ask someone who knows them, before you invite strangers.
- **Messages are not end-to-end encrypted.** Anyone with access to the database can read them. Say so in the notice, and do not call the app "private" beyond what it is.
- **Abuse.** There is no way to report or block a person, and no admin tooling. Fine for friends, a gap for strangers.
- **Moderate the first week of real traffic by reading the logs**, then decide what is missing.

## 11. What is verified, and what is not

Verified in the sandbox:

- The whole test suite after every change (server 952 tests, frontend 406), and each new piece of hardening was checked by deliberately breaking it and seeing that a test failed (31 breaks, all caught).
- The Docker build was followed **command by command** outside Docker, in a clean copy shaped like the build context: the dependency installs (`npm ci`, and `npm ci --omit=dev` for the runtime image, which keeps `prisma` and `helmet` and drops the test tools), `prisma generate`, both builds, and starting the result in production mode with a database: the server serves the frontend, answers the smoke test (9 of 9 checks that apply to http), stops with a clear message when `TRUST_PROXY` is missing or `APP_ORIGIN` is not https, and leaves cleanly on SIGTERM.
- The built `index.html` has no inline scripts or styles and the bundle uses no `eval`, so the Content-Security-Policy has nothing to block in them.
- A real socket client against the running server, through the Vite dev proxy too, including the upgrade to a WebSocket.

**Not** verified, so these are what to watch on the first deployment:

- **`docker build` itself**, because there is no Docker in the sandbox. Likely trouble spots: the Prisma engine download at `npm ci` (needs network at build time, which Render has), the `argon2` native module (the `bookworm-slim` image has what its prebuilt binary needs).
- **`prisma migrate deploy`** in the image: the sandbox could not download Prisma's schema engine, so the migrations were applied with `psql` for the simulation. If the pre-deploy step fails, the log says what is missing.
- **`render.yaml`**: Render's schema is not reachable from the sandbox. The fields come from Render's documentation (`runtime: docker`, `preDeployCommand`, `healthCheckPath`, `fromDatabase`, `sync: false`, plan names `starter` and `basic-256mb`). If it is rejected, the dashboard shows which line.
- **The `TRUST_PROXY` value on Render** (step 4), **DNS and HTTPS**, **Resend**.
- **The page in a real browser under the new security headers.** The CSP was reasoned from the built files, not seen working. If something is blocked, the browser's console names the directive; the policy is in `server/src/middlewares/securityHeaders.ts`.
- **The `__Host-` cookie in a browser.** It meets the prefix's rules on paper; the sign-in test in step 6 proves it.

### Startup messages

| Log line | Meaning |
| --- | --- |
| `DATABASE_URL is required when NODE_ENV=production` | Set it (Render fills it from the database) |
| `TRUST_PROXY is required when NODE_ENV=production` | Enter the number (step 4) |
| `TRUST_PROXY=true trusts every X-Forwarded-For entry...` | Use a number |
| `APP_ORIGIN is required...` / `must be an https address` / `must be an origin only` | Fix the value: `https://chat.yourdomain.com`, nothing after the host |
| `FRONTEND_DIST is set to "...", but there is no index.html in it` | The image was built without the frontend; rebuild from the repository root |
| `MAIL_TRANSPORT must be "resend" when NODE_ENV=production` | Production does not send mail through the console |
| `Could not listen on port ...` | Something else holds the port (on a host, `PORT` is set by the host; leave it alone) |

### When something is wrong

| What you see | Look at |
| --- | --- |
| The page loads, but it says you are offline or the chat never updates | The browser console: a refused socket (`APP_ORIGIN` does not match the address in the bar, including `www.` and `https`), or a CSP message |
| "Too many attempts" for people who did not try | `TRUST_PROXY` too low (section 5) |
| Sign-in works on the `onrender.com` address and not on your domain, or the reverse | `APP_ORIGIN` and the `__Host-` cookie: the cookie is host-only, so each address has its own |
| Deploy fails at "pre-deploy" | The log of `prisma migrate deploy`: the migration's SQL error, or the database not reachable |
| `/api/health/ready` answers 503 | The database is down or its URL is wrong; Render > the database > status |
| Verification mails do not arrive | Resend dashboard: the domain's verification, the daily count, bounces; the sender address must be on the verified domain |
