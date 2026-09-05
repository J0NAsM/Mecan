FROM node:24-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY deploy/pgdg.sources /etc/apt/sources.list.d/mecan-pgdg.sources.disabled
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
    && install -d /usr/share/postgresql-common/pgdg \
    && curl --fail --silent --show-error https://www.postgresql.org/media/keys/ACCC4CF8.asc -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
    && mv /etc/apt/sources.list.d/mecan-pgdg.sources.disabled /etc/apt/sources.list.d/mecan-pgdg.sources \
    && apt-get update && apt-get install -y --no-install-recommends postgresql-client-18 \
    && apt-get clean && rm -rf /var/lib/apt/lists/*
ENV POSTGRES_BIN_PATH=/usr/lib/postgresql/18/bin
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --chown=node:node src ./src
COPY --chown=node:node public ./public
COPY --chown=node:node scripts ./scripts
RUN mkdir -p /app/storage /app/backups && chown -R node:node /app/storage /app/backups
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node","src/server.js"]
