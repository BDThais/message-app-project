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
WORKDIR /app/server

# The production dependencies only. `prisma` is one of them: the host runs `prisma migrate deploy` from this
# image before each new version takes traffic.
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/server/dist ./dist
COPY --from=build /app/server/prisma ./prisma
COPY --from=build /app/server/prisma.config.ts ./
COPY --from=build /app/frontend/dist /app/frontend-dist
ENV FRONTEND_DIST=/app/frontend-dist

USER node
EXPOSE 3000

# For hosts that look at it (Docker, Compose). Render and others use their own check of /api/health.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

CMD ["node", "dist/server.js"]
