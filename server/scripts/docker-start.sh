#!/bin/sh
# What the Docker image runs. With MIGRATE_ON_START=true it applies the pending database migrations first:
# for hosts that have no step to run before a deploy goes live (Render's free plan has none). Where such a
# step exists (a paid Render service's preDeployCommand), leave it unset and run `prisma migrate deploy` there.
#
# Only safe because there is exactly one instance: two starting at once would both run the migrations.
# A failing migration stops here (set -e) and the container exits, which the host shows as a failed deploy.
set -e

if [ "$MIGRATE_ON_START" = "true" ]; then
  echo "Applying database migrations..."
  npx prisma migrate deploy
fi

# exec: node replaces this shell as the container's main process, so that SIGTERM from the host reaches the
# server's own shutdown handler. Without it the shell would take the signal and node would be killed unannounced.
exec node dist/server.js
