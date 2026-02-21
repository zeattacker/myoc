# Ubuntu 24.04 Noble — glibc 2.39, GCC 13 (CXXABI_1.3.15)
# Required for Lucid native module (lucid-native.linux-arm64-gnu.node)
FROM ubuntu:24.04

# Install Bun (required for build scripts)
RUN apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      ca-certificates curl unzip && \
    curl -fsSL https://bun.sh/install | bash && \
    apt-get clean && rm -rf /var/lib/apt/lists/*
ENV PATH="/root/.bun/bin:${PATH}"

# Install Node.js 22.x from NodeSource + corepack
RUN apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      ca-certificates curl gnupg && \
    mkdir -p /etc/apt/keyrings && \
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
      | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg && \
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" \
      > /etc/apt/sources.list.d/nodesource.list && \
    apt-get update && \
    apt-get install -y nodejs && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

RUN corepack enable

# Create node user (uid 1000) — same as official node Docker image
# Ubuntu 24.04 may already have uid/gid 1000 used by 'ubuntu' user — rename it
RUN if getent passwd 1000 > /dev/null 2>&1; then \
      usermod -l node -d /home/node -m $(getent passwd 1000 | cut -d: -f1) && \
      groupmod -n node $(getent group 1000 | cut -d: -f1) 2>/dev/null || true; \
    else \
      groupadd --gid 1000 node && \
      useradd --uid 1000 --gid 1000 --shell /bin/bash --create-home node; \
    fi

WORKDIR /app

ARG OPENCLAW_DOCKER_APT_PACKAGES=""
# Install system packages + Docker CLI (ubuntu/noble repo)
RUN apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      python3-pip \
      python3 \
      sudo \
      ca-certificates \
      curl \
      gnupg \
      git \
      $OPENCLAW_DOCKER_APT_PACKAGES && \
    install -m 0755 -d /etc/apt/keyrings && \
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
      | gpg --dearmor -o /etc/apt/keyrings/docker.gpg && \
    chmod a+r /etc/apt/keyrings/docker.gpg && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu noble stable" \
      > /etc/apt/sources.list.d/docker.list && \
    apt-get update && \
    apt-get install -y docker-ce-cli && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY ui/package.json ./ui/package.json
COPY patches ./patches
COPY scripts ./scripts

RUN pnpm install --frozen-lockfile

# Optionally install Chromium and Xvfb for browser automation.
# Build with: docker build --build-arg OPENCLAW_INSTALL_BROWSER=1 ...
# Adds ~300MB but eliminates the 60-90s Playwright install on every container start.
# Must run after pnpm install so playwright-core is available in node_modules.
ARG OPENCLAW_INSTALL_BROWSER=""
RUN if [ -n "$OPENCLAW_INSTALL_BROWSER" ]; then \
      apt-get update && \
      DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends xvfb && \
      node /app/node_modules/playwright-core/cli.js install --with-deps chromium && \
      apt-get clean && \
      rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*; \
    fi

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
USER node

# Setup npm global prefix for non-root skill/MCP installs
RUN mkdir -p /home/node/.npm-global && \
    npm config set prefix /home/node/.npm-global
ENV PATH="/home/node/.lucid/bin:/home/node/.lucid/bun/bin:/home/node/.npm-global/bin:/home/node/.local/bin:${PATH}"

# Install skill dependencies: Bitwarden CLI (vaultwarden skill), MCPorter (mcporter skill)
RUN npm install -g @bitwarden/cli mcporter

# Install Python packages for skills
# pypdf: PDF text extraction (gamatecha-workspace skill — Drive report summarization)
RUN pip install --break-system-packages --no-cache-dir pypdf

# Start gateway server with default config.
# Binds to loopback (127.0.0.1) by default for security.
#
# For container platforms requiring external health checks:
#   1. Set OPENCLAW_GATEWAY_TOKEN or OPENCLAW_GATEWAY_PASSWORD env var
#   2. Override CMD: ["node","openclaw.mjs","gateway","--allow-unconfigured","--bind","lan"]
CMD ["node", "openclaw.mjs", "gateway", "--allow-unconfigured"]
