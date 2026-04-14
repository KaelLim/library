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
# NOTE: 目前以 root 執行，因 Claude Code CLI 憑證與 claude-credentials volume
# 綁定於 /root/.claude。改為 non-root 需同步調整 volume 路徑並重新 OAuth 登入，
# 待規劃維護視窗處理（見 docs/security-audit-2026-04-14.md #14）。
CMD ["node", "dist/server.js"]
