FROM node:20-slim

# Install system dependencies
# - curl: for Claude Code installation
# - ghostscript: for PDF compression
RUN apt-get update && apt-get install -y \
    curl \
    ghostscript \
    && rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI (required for claude-agent-sdk)
RUN curl -fsSL https://claude.ai/install.sh | bash

# Set PATH for Claude Code
ENV PATH="/root/.local/bin:$PATH"

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Copy source files
COPY tsconfig.json ./
COPY src ./src

# Build TypeScript
RUN npm run build

# Remove devDependencies
RUN npm prune --production

# Expose port
EXPOSE 3001

# Start server
CMD ["node", "dist/server.js"]
