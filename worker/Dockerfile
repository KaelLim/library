FROM node:20-slim

# Install curl for Claude Code installation
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI (required for claude-agent-sdk)
RUN curl -fsSL https://claude.ai/install.sh | bash

# Set PATH for Claude Code
ENV PATH="/root/.claude/bin:$PATH"

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production

# Copy built files
COPY dist ./dist

# Expose port
EXPOSE 3001

# Start server
CMD ["node", "dist/server.js"]
