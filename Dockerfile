# Shopify MCP — container image for remote (HTTP/SSE) deployment on Railway, etc.
# Local/stdio usage does NOT need this; see the README "Local setup" section.

# --- Build stage: compile TypeScript to dist/ ---
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# --- Runtime stage: production deps + compiled output only ---
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist

# Railway injects PORT at runtime; the server reads it (defaults to 3000).
EXPOSE 3000

# --remote enables HTTP/SSE mode (equivalent to REMOTE_MCP=true).
CMD ["node", "dist/index.js", "--remote"]
