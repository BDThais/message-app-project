# Notes for Claude: working on this repo in the claude.ai chat sandbox

Notes to self from earlier sessions, so a new session does not re-discover them. They describe the claude.ai chat sandbox only, not the developer's machine (there, `npm test` with Docker works as documented in `project-planning-doc.md`). Last verified 2026-10-05. If something below no longer matches reality, fix this file in the same patch.

## What the sandbox can and cannot do

- Runs as root on Ubuntu 24 with Node 22. **No Docker**, no Postgres preinstalled. The file system resets between sessions, so the setup below is needed every time (check first: `pg_isready -h /tmp -p 55432`; in a fresh sandbox it prints "not found" because `postgresql-client` is not installed yet, which also means step 1 is needed).
- Works: `git clone` from github.com, `npm ci` (npm registry), `apt-get install` (archive.ubuntu.com). `apt-get update` prints a 403 for the nodesource repo; ignore it, installs still work.
- **Blocked: `binaries.prisma.sh`.** Every Prisma command that wants the schema engine dies with `Failed to fetch the engine file ... 403`. That covers `npx prisma generate` as-is, `prisma migrate deploy/reset`, and so `npm run db:test:deploy`, `db:test:reset` and `npm test` (which also calls Docker). `PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING=1` does not help. What works instead:
  - `prisma generate` never calls the schema engine, so stub it: `PRISMA_SCHEMA_ENGINE_BINARY=/bin/true npx prisma generate`
  - apply the migrations yourself: run each `prisma/migrations/*/migration.sql` through `psql`, in folder-name order (below). This does not fill `_prisma_migrations`, which is irrelevant for tests.
  - run tests with `npx vitest run`, not `npm test`. `npm run test:unit` needs no database.
- The Postgres process can be gone between turns of the same conversation, and on 2026-10-03 it also vanished between two tool calls inside one turn, although `/tmp/pgdata` is still there. So a check at the start of the turn is not enough: begin every command that touches the database with `pg_isready -h /tmp -p 55432 >/dev/null || su postgres -c "$PGBIN/pg_ctl -D /tmp/pgdata -o '-p 55432 -k /tmp' -l /tmp/pg.log -w start" >/dev/null 2>&1`. Only restart it, never redo `initdb`, that wipes the data. When a whole run fails with `Can't reach database server at 127.0.0.1:55432`, that is this, not your code.
- The default shell is `/bin/sh`: `<( ... )` fails there. Wrap such commands in `bash -c '...'`.

## Setup (tested from a clean sandbox)

Postgres 16 from apt stands in for the `postgres:18-alpine` container. It listens on 55432 with the same user, password and database as `docker-compose.test.yml` and `.env.test.example`, so the tests need no changes. Set `WORK` to wherever the clone should go.

```bash
WORK=${WORK:-/home/claude}
PGBIN=/usr/lib/postgresql/16/bin
DB_URL=postgresql://chatapp_test:chatapp_test@localhost:55432/chatapp_test

# 1. Postgres (skip if `pg_isready -h /tmp -p 55432` already says accepting connections)
apt-get update -qq >/dev/null 2>&1
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq postgresql postgresql-client >/dev/null 2>&1
rm -rf /tmp/pgdata && mkdir -p /tmp/pgdata && chown postgres:postgres /tmp/pgdata
su postgres -c "$PGBIN/initdb -D /tmp/pgdata -A trust >/dev/null"
su postgres -c "$PGBIN/pg_ctl -D /tmp/pgdata -o '-p 55432 -k /tmp' -l /tmp/pg.log -w start"
su postgres -c "psql -h /tmp -p 55432 -c \"CREATE USER chatapp_test WITH SUPERUSER PASSWORD 'chatapp_test'\" -c 'CREATE DATABASE chatapp_test OWNER chatapp_test'"

# 2. Repo, dependencies, test env file (.env.test and src/generated/ are gitignored)
cd "$WORK" && git clone -q https://github.com/BDThais/message-app-project.git && cd message-app-project/server
npm ci >/dev/null 2>&1
cp .env.test.example .env.test

# 3. Prisma client, with the schema engine stubbed out
DATABASE_URL=$DB_URL PRISMA_SCHEMA_ENGINE_BINARY=/bin/true npx prisma generate

# 4. Migrations, in order
for d in $(ls -d prisma/migrations/2*/ | sort); do
  psql -h /tmp -p 55432 -U chatapp_test -d chatapp_test -v ON_ERROR_STOP=1 -q -f "$d/migration.sql"
done

# 5. Check
npx tsc --noEmit && npx vitest run
```

After a schema change: re-run step 3, and apply only the new `migration.sql`. To start over: `dropdb`/`createdb` `chatapp_test` (or redo step 1), then step 4.

## Working from the user's uploads

- The uploaded `project-planning-doc.md` and `schema.prisma` have CRLF line endings (a Windows checkout); the repo has LF. Compare with `tr -d '\r'`, and never copy an upload over a repo file. On 2026-09-30, 2026-10-02 and 2026-10-05 both matched the remote's HEAD exactly, so cloning is enough; still diff them once.
- Read the doc with `grep -n -i friend`/`sed -n` on the relevant section; it is ~970 lines and the viewer truncates it. "Friend endpoints" is the spec for the friend routes, "Project structure" lists files and tests, and the conventions (file names, layering, tests per file, error bodies `{ error }`) are stated there. Follow them; do not re-derive them from the code.
- The user has each time asked for the result **as a patch file**, and for the planning doc to be updated alongside the code. Per implemented endpoint, the doc needs: the "Completed" list, the "Integration tests for ..." bullet, the "Still planned" list, the "rest of the friend features" sentence, the section heading of "Friend endpoints", the endpoint's own heading marked `(implemented)` with any new rules, and the test-file tree.

## Delivering a patch

1. Work in the clone, `git config user.name "Claude"` and `user.email "noreply@anthropic.com"`, commit with a one-line lowercase subject like the existing history (`implement the GET /friend/requests endpoint`), body optional.
2. `git ls-remote origin HEAD` first: if the remote moved, re-clone or rebase.
3. `git format-patch -1 -o /mnt/user-data/outputs`, then `present_files`. Mention that `git am` or `git apply` both work.
4. Verify on a fresh clone: `git apply --check`, `git am`, symlink `node_modules`, copy `src/generated` and `.env.test`, run `npx tsc --noEmit && npx vitest run`.
5. Do not include `.env.test`, `src/generated/` or `dist/` (all ignored, so `git add -A` is safe).

## Habits that paid off

- Baseline first: run `tsc` and the existing tests before changing anything, so a later failure is clearly mine.
- Mutation-check new tests: break the code on purpose (wrong sort, wrong filter), confirm the test fails, restore. A test of a sort or tie-break only bites if the rows go in in a different order than the expected one: on a tiny table Postgres hands rows back in insertion/primary-key order, so a test that inserts in the expected order passes even with the tie-break removed.
- Edit files with small `python3` scripts that `assert` the target text occurs exactly once.
- Wrap anything that can block (raw `pg` sessions in a lock experiment, long loops) in `timeout 60`: a hung command costs the whole 300 s tool call. Never `pkill -f <pattern>` when the pattern is in your own command line, it kills your shell.
- A failing `vitest run` prints every test of the file, which can be thousands of lines: pipe it, e.g. `npx vitest run <files> 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "×|FAIL|Tests |Error" | cut -c1-200 | head -40`.
- Do not fire dozens of parallel requests through `request.agent(app)` / `request(app)`: each one starts its own ephemeral server and the run dies with `ECONNRESET` (and "Cannot use a pool after calling end" from requests still in flight). For a race test call the service function directly (that is where the atomic statement lives), or share one server: `const server = app.listen(0)`, `request(server)`, `server.close()` in a `finally`.
- To see the SQL Prisma really sends, turn on statement logging, run one test and read `/tmp/pg.log`: `psql -h /tmp -p 55432 -U chatapp_test -d chatapp_test -c "ALTER SYSTEM SET log_statement='all'" -c "SELECT pg_reload_conf()"`, then `ALTER SYSTEM RESET log_statement`.
