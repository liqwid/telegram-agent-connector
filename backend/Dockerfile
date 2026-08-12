# Build from the repository root: docker build -f backend/Dockerfile .
FROM node:22-slim

WORKDIR /srv
COPY package.json package-lock.json* ./
COPY common/package.json common/
COPY backend/package.json backend/
RUN npm install --workspace common --workspace backend --include-workspace-root

COPY common common
COPY backend backend
RUN npm run build --workspace backend

EXPOSE 8300

# Single process only: in-flight QR logins are held in memory.
CMD ["sh", "-c", "npm run migrate --workspace backend && npm run start --workspace backend"]
