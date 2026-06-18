# Production-shaped backend image.
# Multi-stage so the final image doesn't carry build deps.

FROM node:20-alpine AS deps
WORKDIR /app
RUN apk add --no-cache openssl
COPY package.json package-lock.json .npmrc ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci --omit=optional

FROM node:20-alpine AS build
WORKDIR /app
RUN apk add --no-cache openssl
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate --schema backend/prisma/schema.prisma
RUN npm run build --workspace backend

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache openssl && addgroup -S app && adduser -S app -G app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/backend/dist ./backend/dist
COPY --from=build /app/backend/prisma ./backend/prisma
COPY --from=build /app/backend/package.json ./backend/
COPY --from=build /app/package.json .
USER app
EXPOSE 4000
WORKDIR /app/backend
CMD ["sh", "-c", "node dist/prisma/setup-db.js && node dist/src/server.js"]
