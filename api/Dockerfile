FROM node:20-slim

# Install ffmpeg + deps for sharp and playwright
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    ca-certificates \
    fonts-liberation \
    libnss3 \
    libatk-bridge2.0-0 \
    libdrm2 \
    libxkbcommon0 \
    libgbm1 \
    libasound2 \
    libatspi2.0-0 \
    libxshmfence1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files first for better Docker layer caching
COPY package.json package-lock.json ./

# Install production dependencies
RUN npm ci --omit=dev

# Install playwright browsers (chromium only)
RUN npx playwright install chromium --with-deps 2>/dev/null || true

# Copy source code
COPY . .

# Create output directories
RUN mkdir -p output/sessions assets

EXPOSE 5001

CMD ["node", "index.js"]
