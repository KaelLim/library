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
RUN npm run build:client

# Production stage - Nginx
FROM nginx:alpine

COPY --from=builder /app/dist/client /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 8973
