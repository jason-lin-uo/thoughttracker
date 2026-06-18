# Dev-shaped frontend image. For production you'd build the static bundle
# (`npm run build`) and serve from nginx/CDN — this Dockerfile boots `npm run dev`
# so the compose stack feels like a local dev session.

FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY frontend/package.json frontend/
COPY backend/package.json backend/
RUN npm ci
COPY . .
EXPOSE 5173
WORKDIR /app/frontend
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
