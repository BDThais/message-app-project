# Deployment plan

How to put the app on the internet **for free**, why this way, and what to do after it is there. The code and configuration for it are in the repository: `Dockerfile`, `render.yaml`, `server/.env.production.example`, `server/scripts/smoke-test.mjs`, `server/scripts/docker-start.sh`, `server/src/scripts/createVerifiedUser.ts`, and the hardening described in "What changed in the code" below.

The stack is Render's free web service, Neon's free Postgres database and Resend's free mail plan: no money and no credit card. What the free plans take away instead is listed in section 2, with what the repository does about each; read that part before you start.

Written 2026-11-13 and changed for the free plans on 2026-11-18, without access to a real host. Section 11 lists what has been tried and what has not. Prices, limits and plan names are from the vendors' own pages in November 2026 (the Neon and Render pages are quoted with their dates); free plans change more often than paid ones, so read the page again before you rely on a number.

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
- **Migrations run with every new version.** `prisma migrate deploy` applies the new migration files to the database. A host with a "pre-deploy command" runs it on the new version before it takes traffic and cancels the deploy if it fails. Render's free plan has none, so there the container runs it itself when it starts (`MIGRATE_ON_START`), and a failing migration stops the container, which the host shows as a failed deploy.
- **One instance.** The rate limits are counted in memory and the socket rooms live in memory, so two copies of the server would each have half the picture. The app is built to run as exactly one instance. That is plenty for a long time (section 8 says what the limit looks like and what to do then).

## 2. Decisions

### What the app needs from a host

| Need | Why | Rules out |
| --- | --- | --- |
| A long-running Node process that accepts WebSockets | Socket.io keeps a connection open for as long as the page is open | Serverless platforms: Vercel and Netlify functions, Cloudflare Workers/Pages Functions (a function ends after each request) |
| Always on, ideally | A host that stops an idle service closes every socket and makes the next visitor wait for a cold start | Nothing, for a demo: the free stack accepts a one-minute wake-up after a quiet spell (section 2). For a real user base, use an always-on plan |
| Exactly one instance | See above | Hosts whose default is two or more copies (Fly.io does this unless told otherwise) |
| PostgreSQL 18, with a way to keep a copy | The test suite runs on 18; the data is the one thing you cannot rebuild | Free databases that expire (Render's free database is deleted after 30 days) |
| A region near Vietnam | Every message makes a round trip | Hosts with only US/EU regions. Singapore is the closest region the usual hosts offer |
| A way to apply the migrations | The schema changes with the code | Nothing: a pre-deploy command where there is one, `MIGRATE_ON_START` where there is not |

### The free stack

All of it costs no money and none of it asks for a credit card (each vendor's own page, November 2026):

| Piece | Service | What the free plan gives |
| --- | --- | --- |
| The app | **Render**, free web service, Singapore | 512 MB of memory, 750 instance hours a month for the account, and a free `onrender.com` address with HTTPS. It **sleeps** after 15 minutes without traffic and wakes in about a minute |
| The database | **Neon**, free, Singapore (`aws-ap-southeast-1`) | 1 GB of data, 100 compute-hours a month (about 400 hours of its smallest size), **asleep** after 5 idle minutes (this cannot be turned off), 6 hours of restore history and one manual snapshot |
| Mail | **Resend**, free | 3,000 mails a month and 100 a day. **It delivers only to the address you signed up with until you verify a domain** |
| Uptime alerts (optional) | UptimeRobot or Better Stack, free | Personal use |

Why these: the app needs a Node process that stays up to hold sockets, and a Postgres database. Render's own free database is deleted 30 days after it is made, so the database comes from Neon, which wakes by itself on the first query. Fly.io has no free plan for new accounts and asks for a card, and Railway's free credit is small (about 1 USD a month, a few hours of runtime). Vercel's, Netlify's and Cloudflare's free tiers run functions that end after each request, which cannot hold a socket.

### What the free plans cost you instead of money

| Limit | What you will notice | What the repository does about it |
| --- | --- | --- |
| Render sleeps after 15 minutes without traffic | The first visitor after a quiet spell waits about a minute (Render shows a loading page). While anybody has the app open, its socket counts as traffic (Render counts WebSocket messages), so it stays awake; a visitor who has closed the tab does not | Nothing is needed. To keep it awake all day, a monitor that asks `/api/health` every 5 minutes does it, and one free service awake all month uses about 720 of the 750 hours, so do not run a second free service |
| Neon sleeps after 5 idle minutes | The first query after a quiet spell takes a fraction of a second to about a second longer. Compute-hours are used only while it is awake; the hourly empty-room cleanup wakes it once an hour, about 15 of the 100 hours a month | `/api/health`, which Render asks all the time, does not touch the database. **Do not point a monitor at `/api/health/ready`**: it would keep Neon awake all month, which needs about 190 hours at the smallest size against 100, and the database is suspended until the next month when they run out. The pool drops idle connections after 10 seconds and the database driver handles the connection errors a suspend causes, so a sleeping database does not crash the server |
| No pre-deploy command on the free plan | The migrations cannot run before the new version takes traffic | `MIGRATE_ON_START=true`: the container runs `prisma migrate deploy` when it starts (`server/scripts/docker-start.sh`). This is safe only because exactly one instance runs. A failing migration stops the container, and the deploy shows as failed |
| No shell and no one-off jobs on the free service | You cannot run an admin command on the server | Admin tasks run from your computer against the Neon database, as `server/src/scripts/createVerifiedUser.ts` does |
| Backups: 6 hours of history and one snapshot | A mistake found tomorrow cannot be undone from Neon's history | A `pg_dump` that you keep yourself (section 7) |
| Render may restart a free service at any time | The sockets drop and come back | The client reconnects and catches up by itself |
| Free mail reaches only you | See the next table | |
| Free plans change | Any of this can be reduced or withdrawn | Section 8 says how to move |

### Mail without a domain

Resend mails anybody only from a domain you own and have verified (the free plan allows one). Before that it sends only from `onboarding@resend.dev`, and only to the address your Resend account was made with. The app mails a link at sign-up (it answers "created" first and mails afterwards) and for a password reset, so there are two ways to run it:

| | **A. With a domain** (typically a few to some ten USD a year, paid once a year, not a subscription; check a registrar) | **B. Without a domain** |
| --- | --- | --- |
| Who can sign up | Anybody, with a real mailed link | Nobody: sign-up is closed (`SIGNUP_ENABLED=false`), so strangers do not leave their data with an account that can never be verified |
| Who can use the app | Anybody | You, and the accounts you make by hand (`createVerifiedUser.ts`): a few demo logins you give out with the link |
| Resend | The domain verified, `MAIL_FROM` on it | `MAIL_FROM=Message App <onboarding@resend.dev>`: mail reaches your own address only, so your own reset works |
| Password reset | Works for everybody | Works for you; a demo account whose password is forgotten is replaced by a new one |
| Good for | A public project | A link on your CV: the visitor signs in with a demo account and sees the app work |

Take **B** for now. Moving to A later changes three settings (`SIGNUP_ENABLED`, `MAIL_FROM`, the Resend domain) and nothing in the code.

### With a budget (for later)

If the cost stops being the limit, the same app runs on these, with no sleeping and with the migrations before the deploy. The `Dockerfile` is the same; section 7 ("Upgrading") says how to move the data.

| Stack | About, per month | How it feels | Main catch |
| --- | --- | --- | --- |
| **Render**: web service (Starter) + Render Postgres (basic-256mb), both in Singapore | about 13 USD (7 + 6) | Connect the GitHub repository, fill in a form, done. Managed database with point-in-time recovery, private network between the two, free HTTPS and custom domain, `render.yaml` describes it all | The cheapest always-on plan is 512 MB, which is enough here; the region cannot be changed later |
| **Railway**: one service + a Postgres service, Singapore | about 8 to 12 USD, varies | Very similar to Render, pleasant dashboard, deploys from the same `Dockerfile` | Usage-based billing (you pay for the memory and CPU actually used), so the bill moves; the 5 USD Hobby plan includes 5 USD of usage |
| **Fly.io** (Singapore) + **Neon** free Postgres (Singapore) | about 0 to 6 USD | The cheapest. Fly bills per second of machine time, and a small invoice (under 5 USD) is waived | Two vendors; Fly is driven from a command-line tool and its default is two machines (you must set one); Neon's free database sleeps after 5 minutes without queries, so the first request after a quiet period pays a wake-up delay; Fly's own managed Postgres starts at 38 USD, which is why it is not in the stack |
| **A VPS** (DigitalOcean, Vultr, Hetzner...) with Docker Compose, Caddy and Postgres in a container | about 6 to 15 USD | The most you learn, the most you control | You are the operator: OS updates, firewall, certificates, backups, restoring. Hetzner has been the cheap default, but it raised prices in 2026 and its Singapore plans are not the bargain they were, so compare before choosing |

If you pay, take **Render** (Starter service plus a Render database): the most is one form away, and its database has point-in-time recovery. Railway is the near-equal; Fly.io plus Neon the cheapest; a VPS the one that teaches the most and asks the most of you.

### The other pieces

| Piece | Choice | Notes |
| --- | --- | --- |
| Domain | None needed for B; any registrar for A (Cloudflare Registrar sells at cost; Namecheap and Porkbun are fine) | The `onrender.com` address has HTTPS and works as `APP_ORIGIN`. Use a subdomain such as `chat.yourdomain.com` if you want the apex for something else |
| DNS | The registrar's, or Cloudflare in "DNS only" mode (grey cloud) | Do not turn on Cloudflare's proxy (orange cloud) at first: it adds a second proxy in front of Render, which changes the answer to the `TRUST_PROXY` question (section 5) |
| Uptime alerts | UptimeRobot or Better Stack (free) | Watch `https://your-address/api/health`, not `/ready` (section 2) |
| Backups | A `pg_dump` you keep somewhere else | Section 7 |
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
| `scripts/docker-start.sh` is what the image runs | It applies the migrations first when `MIGRATE_ON_START=true`, and starts the server with `exec`, so that the host's stop signal reaches the server's own shutdown handler (a plain `sh -c "a && b"` would take the signal in the shell and kill the server unannounced) |
| `SIGNUP_ENABLED` and `src/scripts/createVerifiedUser.ts` | Without a mail domain, a stranger's sign-up would answer "created" and never be verified, while their data was stored. The setting closes sign-up; the script makes an account that counts as verified through the same validation and the same verification function as a mailed link |
| The four route files use `Router` from Express instead of calling `express()` | `import Router from 'express'` gives the *app* factory, so each router was a small separate app with its own settings (it re-added the `X-Powered-By` header that was meant to be gone, and took `trust proxy` by inheritance, which works but is fragile). `import { Router } from 'express'` is what was meant |
| `.dockerignore` fixed | It listed `.env` and `.env.*` without `**/`, which only matches at the repository root: `server/.env` would have been copied into the image. Environment files are now excluded everywhere, as is generated code, so a stale copy cannot win over the image's own build |

### The settings

Every setting the server reads is in `server/.env.production.example`. The ones that matter for a deployment:

| Setting | In production | Meaning |
| --- | --- | --- |
| `NODE_ENV` | `production` | Turns on the production rules below, and the `Secure` flag on the session cookie |
| `DATABASE_URL` | required | The Postgres connection string. With Neon: its **direct** connection string (the host has no `-pooler`), as Neon shows it. The driver prints a warning about `sslmode` at start; it is harmless |
| `MIGRATE_ON_START` | `true` on the free plan | Apply the pending migrations when the container starts. Leave it unset where the host runs `npx prisma migrate deploy` before a deploy goes live (a paid Render service) |
| `SIGNUP_ENABLED` | `false` for B, unset for A | `false` closes `POST /api/account/signup` with a 403 `Sign-up is closed on this deployment`; accounts are then made with `createVerifiedUser.ts` |
| `APP_ORIGIN` | required, `https://...` | The one origin the app is opened at: scheme and host, no path, no trailing slash (`https://chat.example.com`). Used for the socket origin check and the security headers |
| `TRUST_PROXY` | required | How many proxies are in front: `1` on Render, Railway and Fly (to be confirmed, section 5), `0` when none. Never `true` |
| `EMAIL_VERIFICATION_URL`, `PASSWORD_RESET_URL` | required | Where the mailed links point: `https://chat.example.com/verify-email` and `/reset-password` |
| `MAIL_TRANSPORT`, `RESEND_API_KEY`, `MAIL_FROM` | `resend`, a key, a sender | The console transport only logs mail, so production refuses to start with it. The sender is on a verified domain (A), or `Message App <onboarding@resend.dev>` (B: mail reaches the Resend account's own address only) |
| `SESSION_COOKIE` | `__Host-session` | A name with the `__Host-` prefix: the browser then accepts the cookie only over https and only for exactly this host, and refuses it from any other source. The cookie already meets the prefix's rules (`Secure`, path `/`, no domain) |
| `FRONTEND_DIST` | set by the Docker image | Where the built frontend is. When set, the server serves it |
| `LOG_CLIENT_IP` | off | Temporary, section 5 |

## 4. First deployment, step by step

Allow an afternoon. Nothing in it costs money with option B; with option A the domain is the only cost. The steps are written for B, the free stack without a domain, and say where A differs.

### Before you begin

1. The repository on GitHub has the Socket.io work, the hardening, the deployment files and the free-plan changes. Run `npm run check` at the repository root and the tests in `server/` and `frontend/`.
2. Choose A or B (section 2, "Mail without a domain"). The rest assumes B.

### Step 1: mail (Resend)

1. Create a Resend account with the email address you will use as yours.
2. Create an API key with **sending access only** (API Keys). Keep it for step 3.
3. Option A only: add and verify your domain (Domains > Add: Resend shows DNS records, SPF and DKIM, to create where your DNS is managed; wait for *Verified*) and use `Message App <no-reply@yourdomain.com>` as the sender. With B the sender is `Message App <onboarding@resend.dev>`.

### Step 2: the database (Neon)

1. Sign up at neon.com (a GitHub login works; no card).
2. Create a project: name `message-app`, **Postgres 18** (the version the tests run on), region **AWS Asia Pacific (Singapore)**.
3. Open **Connect** and turn **Connection pooling off**. Copy the connection string it shows: its host has no `-pooler` in it, and it ends in `?sslmode=require&channel_binding=require`. This string contains the password: keep it out of the repository and out of chats. It goes into the next step as `DATABASE_URL`. (The direct string is the one `prisma migrate deploy` needs: the pooler cannot hold the lock it takes. One app instance does not need pooling.)

### Step 3: the service (Render)

1. Create a Render account (a GitHub login works; no card) and pick the repository: **New > Blueprint**. Render reads `render.yaml` and shows one web service, `message-app`, on the **Free** plan in Singapore.
2. It asks for the values marked `sync: false`. Enter:
   - `DATABASE_URL`: the Neon string from step 2
   - `TRUST_PROXY`: `1`
   - `APP_ORIGIN`: `https://message-app.onrender.com` (a placeholder: step 3.4 fixes it if Render gives another address)
   - `EMAIL_VERIFICATION_URL`: `https://message-app.onrender.com/verify-email`
   - `PASSWORD_RESET_URL`: `https://message-app.onrender.com/reset-password`
   - `SIGNUP_ENABLED`: `false` for B, `true` for A
   - `RESEND_API_KEY`: the key from step 1
   - `MAIL_FROM`: the sender from step 1
3. Apply. Render builds the image (several minutes the first time; each build uses some of the account's free build minutes), starts the container, and waits for `/api/health`. Open the service's **Logs**. You should see `Applying database migrations...`, Prisma's list of migrations applied (the first start; later starts say there is nothing to apply), and `Server is running on port 10000`. If the service stops at startup, the log names the setting that is wrong (section 11 lists the messages).
4. The service's page shows its real address. If it is not `https://message-app.onrender.com` (the name was taken and Render added letters), change `APP_ORIGIN`, `EMAIL_VERIFICATION_URL` and `PASSWORD_RESET_URL` to it; the service restarts. The security of the socket depends on `APP_ORIGIN` being exactly the address in the browser's bar.

If the Blueprint form rejects the file, run `render blueprints validate` with Render's command-line tool, or make the service by hand in the dashboard with the same values: the Blueprint is a convenience, not a requirement.

### Step 4: find the right `TRUST_PROXY` (do not skip this)

Section 5 explains why. The test takes five minutes:

1. In the service's environment, add `LOG_CLIENT_IP` = `true`. The service restarts.
2. On your computer run `curl https://ifconfig.me` and note your public address (or use any "what is my IP" page; use the same network for the next step).
3. Open `https://your-address/api/health` in the browser (the first request after a restart can take a minute), then read the Render logs for lines that start with `client ip check`. Each shows `req.ip`, `req.ips`, `x-forwarded-for` and `socket`.
4. Read the result:
   - `req.ip` is **your address**: `TRUST_PROXY=1` is right.
   - `req.ip` is **a different address that is the same on every request, whoever makes it** (a Render or Cloudflare address), and your address is in `x-forwarded-for` *before* it: set `TRUST_PROXY=2` and repeat.
   - `x-forwarded-for` is `null` and `socket` is a private address (`10.x`, `172.16-31.x`): the host does not add the header at all; set `TRUST_PROXY=0` and the limits will see the proxy's address, which means one budget for everybody. Tell me, and the code needs another way to find the visitor.
5. Confirm with behaviour: from your computer try to sign in with a wrong password 11 times; the 11th answer is "Too many attempts". Then, from your phone on mobile data (a different address), sign in with a wrong password once: it must **not** be refused. Both results together prove the limit counts addresses one by one.
6. Remove `LOG_CLIENT_IP` (it logs visitors' addresses, which are personal data).

### Step 5: your own domain (option A, or if you want a nicer address)

1. In the service's **Settings > Custom Domains**, add `chat.yourdomain.com`. Render shows the DNS record to create (a CNAME for a subdomain). Create it at your DNS provider (DNS only, no proxy). Render issues the certificate by itself when it sees the record.
2. Change `APP_ORIGIN`, `EMAIL_VERIFICATION_URL` and `PASSWORD_RESET_URL` to the new address. The session cookie is host-only (`__Host-`), so everybody signs in again on the new address.

### Step 6: the first accounts

With B nobody can sign up, so you make the accounts. On your computer, in the repository (`npm ci` in `server/` once; the generated database client exists on a machine where you have run the server, and otherwise `npx prisma generate` makes it):

```text
cd server
```

PowerShell (Windows):

```powershell
$env:DATABASE_URL = '<the Neon string from step 2>'
$env:USER_PASSWORD = 'Str0ng!Pass'
npx tsx src/scripts/createVerifiedUser.ts DemoOne demo1@example.com +84901234567
npx tsx src/scripts/createVerifiedUser.ts DemoTwo demo2@example.com +84901234568
```

bash:

```bash
DATABASE_URL='<the Neon string>' USER_PASSWORD='Str0ng!Pass' \
  npx tsx src/scripts/createVerifiedUser.ts DemoOne demo1@example.com +84901234567
```

The rules are signup's: a name of letters and digits only (no spaces), a strong password (8 or more characters with an upper-case and a lower-case letter, a digit and a special character), a valid international phone number. The password is read from the environment, not from an argument, so it stays out of the shell history. Use a different password for an account you keep for yourself. Each line prints `Created the verified account ...` or the reason it refused. Close the PowerShell window afterwards: the Neon string and the password are in it.

With A, sign up in the app with your own email instead, and the mail arrives.

### Step 7: the smoke test

From your computer, in the repository (`npm ci` in `server/` once):

```text
node server/scripts/smoke-test.mjs https://your-address
```

(The first request wakes the service and can take a minute.) It checks the health endpoints, that the app and a deep link are served, that an unknown API path is a JSON 404 and a protected endpoint is a 401, the security headers, the http to https redirect, and that a socket without a session or from another origin is refused. Every line should say `ok`.

### Step 8: use it like a person

On the deployed address, with two accounts in two browsers (or a phone):

1. Sign in as `DemoOne` in one and `DemoTwo` in the other.
2. Send a friend request from one account and accept it in the other. Both lists should update on their own.
3. Open a chat, send a message: it must appear on the other screen without a refresh, and the typing line must show while the other person types.
4. Edit and delete a message; create a group; remove a member. The other screen follows each.
5. With B, try the sign-up page: it must answer that sign-up is closed. Request a password reset for **your own** address (only your own works with B): the mail must arrive and its link must work, and the old session must be signed out afterwards.
6. Close both tabs, wait 20 minutes, open the address again: it wakes in about a minute, and signing in works. In the Render dashboard trigger a manual deploy with a chat open: the page reconnects on its own and no message is lost.

When all of that works, the app is deployed.

## 5. Finding the right `TRUST_PROXY`

The login limit says "10 tries per 15 minutes per address". For the server to know a visitor's address, it reads the `X-Forwarded-For` header the proxy adds, a list of addresses with the oldest (the visitor's) first and each proxy appending the address it saw. The server must be told how many of the *last* entries were added by proxies it trusts, and take the one before them.

- **Too low** (for example `0` behind one proxy): the server takes the proxy's own address as the visitor's. Everyone shares one budget, so one person's ten wrong passwords lock out all of them. It looks fine until the first time it happens.
- **Too high**, or `true`: the server trusts entries the visitor wrote. A visitor sends `X-Forwarded-For: 1.2.3.4` and is a new person for the limiter on every request, so the limit protects nothing.
- **Right**: the number of proxies you really have. On Render it should be `1`, but Render's own documentation and what people report disagree about whether another layer sits in front, which is why step 4 measures it instead of trusting a number. If you later put Cloudflare's proxy in front, add one.

The server refuses to start in production without an explicit `TRUST_PROXY`, and refuses `true`, so it cannot be left at a default by accident.

## 6. What to watch after launch

- **Logs** (Render > Logs): errors are written with `console.error` and have a prefix saying where. Look at them after the first real day. The free service keeps only recent lines.
- **Uptime**: an UptimeRobot (or Better Stack) check on `/api/health`, with an alert by email. Free plans of these are for personal use. A check every 5 minutes keeps the service awake all day (and uses about 720 of the 750 free hours a month); without one, it sleeps when nobody is online, which is fine for a CV link. **Never watch `/api/health/ready` on the free stack** (section 2).
- **Neon's compute-hours** (Neon console > Usage) and **Render's instance hours and build minutes** (Render > Billing > Usage): look once a week at first. A database that runs out of hours is suspended until the next month, and the app answers errors until then.
- **Resend**: the dashboard shows bounces and the daily count (100 on the free plan).
- **Disk**: the database has 1 GB. Messages are text, so it will take a long time to fill, but check the size in the Neon console once a month. When it is full, writes fail.
- **Dependencies**: run `npm audit` in both folders now and then, and update Node's major version when its LTS changes (the `Dockerfile` pins `node:22`).
- **The free plans themselves**: read the Render and Neon free-plan pages again every few months. Neon's was last updated on 2026-11-03.

## 7. Running it

### Deploying changes

- `autoDeployTrigger: commit` deploys every push to the connected branch, and every deploy builds an image, which uses build minutes. Push to a branch, merge when `npm run check` and the tests are green, and the merge deploys. If you push often, set it to `off` in `render.yaml` and deploy by hand from the dashboard.
- Each deploy builds a new image and starts it; the container applies the pending migrations (`MIGRATE_ON_START`) and then starts the server. Render stops the old one with SIGTERM when the new one answers `/api/health`. A deploy restarts the sockets; pages reconnect and catch up by themselves. The in-memory rate limits start from zero.
- **Rolling back** the code: Render > Deploys > redeploy an earlier one. This does **not** undo migrations, so:

### Migrations, safely

Migrations run when the container starts, so the old code can run against the new schema (after a rollback), and a bad migration stops the new container instead of going live half-way (the old one keeps running until the new one answers its health check). So a migration must keep working with the code before it:

1. **Add, do not change, in one deploy**: new columns nullable or with a default, new tables, new indexes. The old code ignores them.
2. **Remove in a later deploy**: only after no running code reads the column or table, drop it in its own migration.
3. **Renaming** is "add the new, copy, switch the code, drop the old" over several deploys.
4. Never edit a migration that has been applied anywhere. Make a new one.
5. Try every migration on a copy of real data's shape before it ships (`prisma migrate dev` against a local database, with some rows in the tables).
6. A migration that takes minutes (a big table rewrite) would hold the start: Render waits for the port, so the deploy just takes longer. Nothing in this app is that big.

### Backups, and restoring

Neon's free plan keeps 6 hours of restore history and one manual snapshot. That covers "I broke something an hour ago" and nothing older, so the backup is a file you keep:

- **Once a month** (and before any risky migration) take a copy. You need `pg_dump` (it comes with the PostgreSQL client tools: install them from postgresql.org; use version 18 or newer) and the Neon direct connection string:

  ```text
  pg_dump --format=custom --no-owner "NEON_DIRECT_CONNECTION_STRING" > message-app-2026-11-18.dump
  ```

  Keep the file somewhere that is not Neon and not this repository (a cloud drive, a USB disk). **Never commit it and never upload it as a build artifact of a public repository: it holds everybody's messages and password hashes.**
- **Test a restore once**, before you need it: create an empty local database, `pg_restore --no-owner -d postgres://localhost/restoretest message-app-2026-11-18.dump`, start the server against it, sign in. A backup that has never been restored is a hope.

### Secrets

Two: the Resend key, and the Neon connection string (it contains the database password). Sessions are random identifiers stored in the database, so there is no signing key. Rotate the Resend key in Resend and the database password in Neon (Roles > reset password) if either leaks, and update the Render environment. Never put them in the repository; `.env*` files are in `.gitignore` and `.dockerignore`.

### Upgrading to a paid plan

When sleeping or the database limits start to matter: Render's Starter service (about 7 USD a month) never sleeps and can run a pre-deploy command, and a Render database (about 6 USD a month and up) keeps point-in-time recovery. Moving, in an order that never loses data:

1. Take a fresh `pg_dump` of Neon (above).
2. Edit `render.yaml` as the comment at its end says: `plan: starter`, add the `databases:` entry, make `DATABASE_URL` come from it, remove `MIGRATE_ON_START` and add `preDeployCommand: npx prisma migrate deploy`. Let the Blueprint sync create the database (the service will fail to start until `DATABASE_URL` points at a database that is ready).
3. Allow your own address in the new database's access control, `pg_restore --no-owner --clean --if-exists -d "RENDER_EXTERNAL_URL" message-app-xxxx.dump`, and remove your address again.
4. Deploy. The migrations find nothing to apply (the dump has the migration table). Check the app with the smoke test and with the sign-in test of step 8.
5. Keep the Neon project for a week as a fallback, then delete it.

## 8. Limits to know, and what to do about them

- **One instance.** The rate limits and the socket rooms are in memory. When one instance is not enough (hundreds of people online at once, not tens), the steps are: Socket.io's Redis adapter (rooms and emits across instances, and `socketsJoin`/`socketsLeave` become asynchronous), the rate limiters' Redis store, and sticky sessions if the host has them. Until then, a bigger instance is the answer.
- **Sessions and tokens pile up.** An expired session is deleted when its owner signs in again or when it is looked up; one that is never used again stays. The same holds for used or expired mail tokens. A scheduled cleanup (like the empty-room one) would fix it; the rows are small.
- **A deleted account does not tell the rooms.** Its memberships go with it and the other members' member lists are right only the next time they are fetched.
- **No error reports, no request log.** Add them when there is something to look for.
- **Free plans are not a promise.** Render and Neon can lower or end a free plan (Fly.io did, for new accounts, in 2024). The data is yours (`pg_dump`) and the app is an ordinary Docker image, so moving is a matter of an afternoon: section 9 lists the other hosts, and "Upgrading" in section 7 the paid Render one.
- **A sleeping app is not an outage.** A first visit after a quiet spell takes a minute, and someone who does not know it will think the link is broken. Say so next to the link ("the first load takes up to a minute").
- **Socket join/leave race**: a socket that reads its rooms just before a removal commits can stay in the removed room's socket room until it reconnects. A window of milliseconds.

## 9. Other hosts: what changes

The `Dockerfile` is the same everywhere. These are for when you leave the free stack. What differs:

- **Railway.** New project > Deploy from GitHub repository; it finds the `Dockerfile`. Add a Postgres service, reference its connection URL as `DATABASE_URL` (a variable reference), set the same variables, region Singapore. Put `npx prisma migrate deploy` in the pre-deploy command of the service settings. Health check path `/api/health`. `TRUST_PROXY`: measure with step 4.
- **Fly.io + Neon.** (Fly.io has no free plan for new accounts and asks for a card; its machine is billed per second, and a small invoice is waived. Neon's free plan is the one from section 2.) `fly launch --no-deploy` (accept the Dockerfile, pick region `sin`; leave `PORT` unset, the server's default 3000 is what `internal_port` says). In `fly.toml`: `[deploy] release_command = "npx prisma migrate deploy"`, `[http_service] internal_port = 3000, force_https = true, auto_stop_machines = "off", min_machines_running = 1`, and a health check on `/api/health`. Run **one** machine: `fly scale count 1` (Fly's default is two, and the app is built for one). Secrets with `fly secrets set KEY=value`. Database: a Neon project in `aws-ap-southeast-1` (Singapore); use the *pooled* connection string for the app, the *direct* one for migrations if the pooled one refuses them; add `?sslmode=verify-full` to the URL. `TRUST_PROXY`: measure.
- **A VPS.** Install Docker, build the image on the server (`docker build -t message-app .`) or push it to a registry; run Postgres 18 in a container with a volume (and take your own backups: a nightly `pg_dump` to somewhere else); run the app with `--env-file`, `-p 127.0.0.1:3000:3000`, `--restart unless-stopped`; run migrations with `docker run --rm --env-file ... message-app npx prisma migrate deploy` before starting a new version. Put **Caddy** in front: a `Caddyfile` of `chat.yourdomain.com { reverse_proxy 127.0.0.1:3000 }` gets a certificate by itself and passes WebSockets without more settings. `TRUST_PROXY=1`. Open only ports 22, 80 and 443 in the firewall and keep the OS updated.

## 10. Before you invite strangers

- **Personal data.** The app stores names, email addresses and phone numbers, and the messages themselves. If real people in Vietnam use it, Vietnam's personal data rules apply to you as the one who processes it. Since 1 January 2026 that is the Law on Personal Data Protection (Law 91/2025/QH15) with its implementing Decree 356/2025/ND-CP, which replaced the Decree 13/2023 many older guides still cite. In short, as law firms describe it: consent is the main legal basis for processing, and it has to be clear, informed, and kept in a way that lets you show when and to what the person agreed; people have the right to see, correct and delete their data (the account deletion already in the app covers the last); small businesses and startups get a five-year grace period for some of the organisational duties (such as appointing a data protection officer) if they stay small and do not process sensitive data in large amounts. In practice for this app: write a short privacy notice (what is collected, why, who else sees it: the host and Resend, how to delete the account) and make signing up mean agreeing to it, with a checkbox or a visible line that you can show later. I am not a lawyer, and this area is new and changing: read the current rules, or ask someone who knows them, before you invite strangers.
- **With option B the privacy question is smaller, not gone.** Sign-up is closed, so only the accounts you made exist; use made-up demo addresses and numbers for them, and do not give strangers a real person's data to find. Anything real people store (messages, a friend list) is still personal data on Render's and Neon's servers.
- **Messages are not end-to-end encrypted.** Anyone with access to the database can read them. Say so in the notice, and do not call the app "private" beyond what it is.
- **Abuse.** There is no way to report or block a person, and no admin tooling. Fine for friends, a gap for strangers.
- **Moderate the first week of real traffic by reading the logs**, then decide what is missing.

## 11. What is verified, and what is not

Verified in the sandbox:

- The whole test suite after every change (server 976 tests, frontend 406), and each new piece of hardening was checked by deliberately breaking it and seeing that a test failed (all caught; two changes of the free-plan work that did not alter any outcome were kept as redundant safeguards and are noted in the tests).
- The Docker build was followed **command by command** outside Docker, in a clean copy shaped like the build context: the dependency installs (`npm ci`, and `npm ci --omit=dev` for the runtime image, which keeps `prisma` and `helmet` and drops the test tools), `prisma generate`, both builds, and starting the result in production mode with a database: the server serves the frontend, answers the smoke test (9 of 9 checks that apply to http), stops with a clear message when `TRUST_PROXY` is missing or `APP_ORIGIN` is not https, and leaves cleanly on SIGTERM.
- `scripts/docker-start.sh` with a stand-in for `npx` and `node`: it migrates only for the exact word `true`, does not start the server when the migration fails (and passes its exit code on), and replaces the shell with the server (`exec`) so the stop signal reaches it.
- `createVerifiedUser` and `SIGNUP_ENABLED`: the account can sign in at once, with the same validation and duplicate rules as signup (also for two calls at the same moment), and a closed sign-up answers 403 before it reads the body.
- The Prisma database adapter registers an error handler on its connection pool, and the pool drops idle connections after 10 seconds, so Neon suspending the database cannot crash the server (read in the installed packages; not tried against Neon).
- The built `index.html` has no inline scripts or styles and the bundle uses no `eval`, so the Content-Security-Policy has nothing to block in them.
- A real socket client against the running server, through the Vite dev proxy too, including the upgrade to a WebSocket.

**Not** verified, so these are what to watch on the first deployment:

- **`docker build` itself**, because there is no Docker in the sandbox. Likely trouble spots: the Prisma engine download at `npm ci` (needs network at build time, which Render has), the `argon2` native module (the `bookworm-slim` image has what its prebuilt binary needs).
- **`prisma migrate deploy` in the image, and against Neon**: the sandbox could not download Prisma's schema engine, so the migrations were applied with `psql` for the simulation (and the real `prisma` command, run with `MIGRATE_ON_START=true`, failed as it should: the container stopped with exit code 1 and the download error in the log). The `Dockerfile` runs `prisma --version` at build time to fetch the engine into the image, so that a build that cannot get it fails there and a container never tries to download it at start; I could not run that step with network access. If the container stops at start, the log has the migration's error: a connection problem (check that the string is the direct one and complete), or the engine missing.
- **`render.yaml` on the free plan**: Render's schema is not reachable from the sandbox. The fields come from Render's documentation (`runtime: docker`, `plan: free`, `healthCheckPath`, `sync: false`), and I have not seen Render accept `plan: free` together with `runtime: docker` in a Blueprint. If it is rejected, the dashboard shows which line; the same service can be made by hand.
- **The `TRUST_PROXY` value on Render** (step 4), **DNS and HTTPS**, **Resend**, **Neon's connection string with `channel_binding=require`** (the driver ignores that parameter; Prisma's own tools accept it in Neon's string).
- **The sleep and wake behavior** of both free plans with this app: from their documentation, not from a run.
- **The page in a real browser under the new security headers.** The CSP was reasoned from the built files, not seen working. If something is blocked, the browser's console names the directive; the policy is in `server/src/middlewares/securityHeaders.ts`.
- **The `__Host-` cookie in a browser.** It meets the prefix's rules on paper; the sign-in test in step 8 proves it.

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
| Verification mails do not arrive | Resend dashboard: the domain's verification, the daily count, bounces; the sender address must be on the verified domain. With `onboarding@resend.dev` mail reaches only the Resend account's own address (a 403 in the logs says so) |
| The first visit takes a minute, or Render shows a loading page | The free service was asleep; this is expected (section 2) |
| Requests answer errors for a moment after a quiet spell, then work | Neon waking; if it keeps happening, check Neon's Usage for compute-hours that ran out |
| Everything answers errors from some day of the month on | Neon's 100 compute-hours or Render's 750 instance hours ran out; they reset at the start of the month. Look for a monitor pointed at `/api/health/ready` |
| Sign-up says "Sign-up is closed on this deployment" | `SIGNUP_ENABLED=false` (option B): make the account with `createVerifiedUser.ts` |
| The container stops right after "Applying database migrations..." | The migration failed: read the lines after it (a connection error, or the migration's own SQL error) |
