FROM node:22-bookworm

# Install Bun (required for build scripts)
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

RUN corepack enable

WORKDIR /app

ARG OPENCLAW_DOCKER_APT_PACKAGES=""
# Install Docker CLI from official Docker repository for latest version
RUN apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      python3-pip \
      sudo \
      ca-certificates \
      curl \
      gnupg \
      $OPENCLAW_DOCKER_APT_PACKAGES && \
    install -m 0755 -d /etc/apt/keyrings && \
    curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg && \
    chmod a+r /etc/apt/keyrings/docker.gpg && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian bookworm stable" > /etc/apt/sources.list.d/docker.list && \
    apt-get update && \
    apt-get install -y docker-ce-cli && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY ui/package.json ./ui/package.json
COPY patches ./patches
COPY scripts ./scripts

RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build
# Force pnpm for UI build (Bun may fail on ARM/Synology architectures)
ENV OPENCLAW_PREFER_PNPM=1
RUN pnpm ui:build

ENV NODE_ENV=production

# Allow non-root user to write temp files during runtime/tests.
RUN chown -R node:node /app

# Add node user to docker group for host docker access (GID will be set at runtime)
# Also configure sudo access for the node user
RUN groupadd -g 999 docker || true && \
    usermod -aG docker node && \
    echo "node ALL=(ALL) NOPASSWD: ALL" >> /etc/sudoers

# Security hardening: Run as non-root user
# The node:22-bookworm image includes a 'node' user (uid 1000)
# This reduces the attack surface by preventing container escape via root privileges
USER node

# Setup npm global prefix for non-root skill/MCP installs
RUN mkdir -p /home/node/.npm-global && \
    npm config set prefix /home/node/.npm-global
ENV PATH="/home/node/.lucid/bin:/home/node/.lucid/bun/bin:/home/node/.npm-global/bin:/home/node/.local/bin:${PATH}"

# Install skill dependencies: Bitwarden CLI (vaultwarden skill), MCPorter (mcporter skill)
RUN npm install -g @bitwarden/cli mcporter

# Install Python packages for skills (duckduckgo-search for web search)
RUN pip install --break-system-packages --no-cache-dir duckduckgo-search

# Start gateway server with default config.
# Binds to loopback (127.0.0.1) by default for security.
#
# For container platforms requiring external health checks:
#   1. Set OPENCLAW_GATEWAY_TOKEN or OPENCLAW_GATEWAY_PASSWORD env var
#   2. Override CMD: ["node","openclaw.mjs","gateway","--allow-unconfigured","--bind","lan"]
CMD ["node", "openclaw.mjs", "gateway", "--allow-unconfigured"]
