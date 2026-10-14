# =============================================================================
# API image for Koyeb (or any container host). Builds only the backend
# workspaces; the Next.js app is deployed separately on Vercel.
# =============================================================================
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/bots/package.json apps/bots/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci -w @cafe/contracts -w @cafe/bots -w @cafe/server --no-audit --no-fund
COPY tsconfig.base.json ./
COPY packages/contracts packages/contracts
COPY apps/bots apps/bots
COPY apps/server apps/server
RUN npm run build -w @cafe/server

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/bots/package.json apps/bots/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci -w @cafe/contracts -w @cafe/bots -w @cafe/server --omit=dev --no-audit --no-fund \
  && npm cache clean --force
COPY --from=build /app/apps/server/dist apps/server/dist
COPY apps/server/drizzle apps/server/drizzle
USER node
ENV PORT=8000
EXPOSE 8000
CMD ["node", "apps/server/dist/main.js"]
