# syntax=docker/dockerfile:1
#
# One image runs the whole app: the Node server (API and sockets), which also serves the built frontend, so
# the browser sees a single origin. Build it from the repository root (the frontend imports the API contract
# from server/src/contract, so both folders are needed to build):
#
#   docker build -t message-app .
#   docker run --env-file server/.env.production -p 3000:3000 message-app
#
# See deployment.doc.md for what the settings are and how a host runs this.

# ---- build: install everything, compile the server, build the frontend --------------------------
FROM node:22-bookworm-slim AS build
WORKDIR /app

# The package files first: a change to the code does not install the dependencies again.
COPY server/package.json server/package-lock.json server/
COPY frontend/package.json frontend/package-lock.json frontend/
RUN cd server && npm ci
RUN cd frontend && npm ci

COPY server server
COPY frontend frontend

# `prisma generate` writes the database client into server/src/generated (which git ignores); it reads
# DATABASE_URL through prisma.config.ts but does not connect to it, so a placeholder will do.
RUN cd server \
    && DATABASE_URL=postgresql://build:build@localhost:5432/build npx prisma generate \
    && npm run build
RUN cd frontend && npm run build

# ---- runtime: only what runs -------------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
# The Prisma command-line tool otherwise looks for updates and sends usage data on every migration run.
ENV CHECKPOINT_DISABLE=1 PRISMA_HIDE_UPDATE_MESSAGE=1
WORKDIR /app/server

# The production dependencies only. `prisma` is one of them: `prisma migrate deploy` runs from this image,
# either as the host's pre-deploy command or at start (MIGRATE_ON_START, see scripts/docker-start.sh).
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/server/prisma ./prisma
COPY --from=build /app/server/prisma.config.ts ./
# Fetch Prisma's schema engine (the binary `migrate deploy` runs) now: `prisma --version` downloads it when it is
# missing, so a build that cannot get it fails here, and the container never tries to download it when it starts
# (the `node` user could not write it into node_modules anyway). The placeholder satisfies prisma.config.ts.
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build npx prisma --version

COPY --from=build /app/server/dist ./dist
COPY --from=build /app/server/scripts/docker-start.sh ./scripts/docker-start.sh
COPY --from=build /app/frontend/dist /app/frontend-dist
ENV FRONTEND_DIST=/app/frontend-dist

USER node
EXPOSE 3000

# For hosts that look at it (Docker, Compose). Render and others use their own check of /api/health.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

CMD ["sh", "scripts/docker-start.sh"]
