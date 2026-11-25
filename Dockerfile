FROM node:20-slim

# Install Chromium and system dependencies for Headless Puppeteer
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-ipafont-gothic \
    fonts-wqy-zenhei \
    fonts-thai-tlwg \
    fonts-kacst \
    fonts-freefont-ttf \
    libxss1 \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install --omit=dev

# Copy application code
COPY . .

# Create persistent data directories
RUN mkdir -p /app/data /app/.chrome-data

# Keep a seed copy of the employee directory outside data/ so a mounted disk
# cannot leave production with an empty contact list.
RUN mkdir -p /app/seed && if [ -f data/employees.json ]; then cp data/employees.json /app/seed/employees.json; fi

EXPOSE 3000

CMD ["node", "server.js"]
