# Build stage
FROM node:20-slim AS builder

# Build arguments for Vite
ARG VITE_SUPABASE_URL=http://localhost:8000
ARG VITE_SUPABASE_ANON_KEY

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci

# Copy source and build with environment variables
COPY . .
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY
RUN npm run build

# Production stage
FROM node:20-slim AS production

# Install curl for healthcheck
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files and install production dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy built client and server
COPY --from=builder /app/dist ./dist

# Environment variables
ENV NODE_ENV=production
ENV PORT=8973
ENV HOST=0.0.0.0

EXPOSE 8973

CMD ["node", "dist/server/index.js"]
