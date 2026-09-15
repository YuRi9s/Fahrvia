FROM node:24.20.0-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --omit=peer
COPY . .
RUN npm run build

FROM build AS production_dependencies
RUN npm prune --omit=dev --ignore-scripts --omit=peer

FROM node:24.20.0-bookworm-slim AS runtime
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates clamav clamav-freshclam && rm -rf /var/lib/apt/lists/*
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/workers ./workers
COPY --from=production_dependencies --chown=node:node /app/node_modules ./node_modules
USER node
EXPOSE 3000
CMD ["node", "server.js"]
