FROM node:20-slim

# Install system dependencies
# - curl: for Claude Code installation
# - qpdf: for lossless PDF optimization (no re-rendering, preserves layout)
# - poppler-utils: for PDF thumbnail extraction (pdftoppm)
# - ffmpeg: for WAV to MP3 conversion (TTS audio)
RUN apt-get update && apt-get install -y \
    curl \
    qpdf \
    poppler-utils \
    ffmpeg \
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

# Copy source files and assets
COPY tsconfig.json ./
COPY src ./src
COPY assets ./assets

# Build TypeScript
RUN npm run build

# Remove devDependencies
RUN npm prune --production

# Expose port
EXPOSE 3001

# Start server
CMD ["node", "dist/server.js"]
