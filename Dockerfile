# Multi-stage build for UNS Sentinel Explorer
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY server/package*.json ./server/

# Install dependencies
RUN npm ci
RUN cd server && npm ci

# Copy source code
COPY . .

# Build the frontend
RUN npm run build

# Production stage
FROM node:20-alpine AS production

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY server/package*.json ./server/

# Install production dependencies only
RUN npm ci --only=production
RUN cd server && npm ci --only=production

# Copy built frontend from builder
COPY --from=builder /app/dist ./dist

# Copy server code
COPY server/index.js ./server/
COPY server/README.md ./server/

# Expose ports
EXPOSE 4000
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:4000/api/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1) })"

# Start the server
CMD ["node", "server/index.js"]

# Labels for metadata
LABEL maintainer="Nimish Nirmal <nimish.nirmal@outlook.com>"
LABEL description="UNS Sentinel Explorer - Industrial MQTT Dashboard"
LABEL version="1.0.0"