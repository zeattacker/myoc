# syntax=docker/dockerfile:1

# =============================================================================
# Stage 1: Build QMD with CUDA for Blackwell GB10 (sm_121)
#
# Uses CUDA devel image to compile node-llama-cpp from source.
# Artifacts (dist/ + node_modules/) are copied to the final stage.
# Build contexts required:
#   qmd_src   = ~/Documents/Projects/qmd
#   llama_src = ~/Documents/Projects/llm/llcp/llama.cpp
# =============================================================================
FROM nvcr.io/nvidia/cuda:12.8.1-devel-ubuntu24.04 AS qmd_builder

# Install Node.js 22 + build dependencies for node-llama-cpp CUDA compilation
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl gnupg python3 make g++ cmake \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /qmd

# Copy QMD source (build context: qmd_src)
COPY --from=qmd_src . .

# Install npm dependencies (downloads prebuilt ARM64 CPU binary initially)
RUN npm install

# Use local llama.cpp repo instead of re-downloading from HuggingFace
COPY --from=llama_src . /qmd/node_modules/node-llama-cpp/llama/llama.cpp

# Recompile node-llama-cpp with CUDA targeting Blackwell sm_121 (GB10 = CC 12.1)
RUN CMAKE_CUDA_ARCHITECTURES=121 npx --no node-llama-cpp source build --gpu cuda

# Build TypeScript → dist/qmd.js (adds #!/usr/bin/env node shebang automatically)
RUN npm run build


# =============================================================================
# Stage 2: OpenClaw Gateway
#
# Switched from ubuntu:24.04 to nvcr.io/nvidia/cuda:12.8.1-runtime-ubuntu24.04.
# Both are Ubuntu 24.04 (Noble) — same glibc 2.39 / GCC 13 (CXXABI_1.3.15),
# so the Lucid native module remains fully compatible.
# The CUDA runtime libraries (libcudart, cuBLAS, etc.) enable node-llama-cpp
# GPU acceleration inside the container for QMD memory search.
# =============================================================================
FROM nvcr.io/nvidia/cuda:12.8.1-runtime-ubuntu24.04

# OCI base-image metadata for downstream image consumers.
# If you change these annotations, also update:
# - docs/install/docker.md ("Base image metadata" section)
# - https://docs.openclaw.ai/install/docker
LABEL org.opencontainers.image.base.name="docker.io/library/node:22-bookworm" \
  org.opencontainers.image.base.digest="sha256:cd7bcd2e7a1e6f72052feb023c7f6b722205d3fcab7bbcbd2d1bfdab10b1e935" \
  org.opencontainers.image.source="https://github.com/openclaw/openclaw" \
  org.opencontainers.image.url="https://openclaw.ai" \
  org.opencontainers.image.documentation="https://docs.openclaw.ai/install/docker" \
  org.opencontainers.image.licenses="MIT" \
  org.opencontainers.image.title="OpenClaw" \
  org.opencontainers.image.description="OpenClaw gateway and CLI runtime container image"

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
RUN chown node:node /app

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
      openssh-client \
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

COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY --chown=node:node ui/package.json ./ui/package.json
COPY --chown=node:node patches ./patches
COPY --chown=node:node scripts ./scripts

USER node
# Reduce OOM risk on low-memory hosts during dependency installation.
# Docker builds on small VMs may otherwise fail with "Killed" (exit 137).
RUN NODE_OPTIONS=--max-old-space-size=2048 pnpm install --frozen-lockfile

# Optionally install Chromium and Xvfb for browser automation.
# Build with: docker build --build-arg OPENCLAW_INSTALL_BROWSER=1 ...
# Adds ~300MB but eliminates the 60-90s Playwright install on every container start.
# Must run after pnpm install so playwright-core is available in node_modules.
USER root
ARG OPENCLAW_INSTALL_BROWSER=""
RUN if [ -n "$OPENCLAW_INSTALL_BROWSER" ]; then \
      apt-get update && \
      DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends xvfb && \
      mkdir -p /home/node/.cache/ms-playwright && \
      PLAYWRIGHT_BROWSERS_PATH=/home/node/.cache/ms-playwright \
      node /app/node_modules/playwright-core/cli.js install --with-deps chromium && \
      chown -R node:node /home/node/.cache/ms-playwright && \
      apt-get clean && \
      rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*; \
    fi

# Optionally install Docker CLI for sandbox container management.
# Build with: docker build --build-arg OPENCLAW_INSTALL_DOCKER_CLI=1 ...
# Adds ~50MB. Only the CLI is installed — no Docker daemon.
# Required for agents.defaults.sandbox to function in Docker deployments.
ARG OPENCLAW_INSTALL_DOCKER_CLI=""
ARG OPENCLAW_DOCKER_GPG_FINGERPRINT="9DC858229FC7DD38854AE2D88D81803C0EBFCD88"
RUN if [ -n "$OPENCLAW_INSTALL_DOCKER_CLI" ]; then \
      apt-get update && \
      DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        ca-certificates curl gnupg && \
      install -m 0755 -d /etc/apt/keyrings && \
      # Verify Docker apt signing key fingerprint before trusting it as a root key.
      # Update OPENCLAW_DOCKER_GPG_FINGERPRINT when Docker rotates release keys.
      curl -fsSL https://download.docker.com/linux/debian/gpg -o /tmp/docker.gpg.asc && \
      expected_fingerprint="$(printf '%s' "$OPENCLAW_DOCKER_GPG_FINGERPRINT" | tr '[:lower:]' '[:upper:]' | tr -d '[:space:]')" && \
      actual_fingerprint="$(gpg --batch --show-keys --with-colons /tmp/docker.gpg.asc | awk -F: '$1 == \"fpr\" { print toupper($10); exit }')" && \
      if [ -z "$actual_fingerprint" ] || [ "$actual_fingerprint" != "$expected_fingerprint" ]; then \
        echo "ERROR: Docker apt key fingerprint mismatch (expected $expected_fingerprint, got ${actual_fingerprint:-<empty>})" >&2; \
        exit 1; \
      fi && \
      gpg --dearmor -o /etc/apt/keyrings/docker.gpg /tmp/docker.gpg.asc && \
      rm -f /tmp/docker.gpg.asc && \
      chmod a+r /etc/apt/keyrings/docker.gpg && \
      printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian bookworm stable\n' \
        "$(dpkg --print-architecture)" > /etc/apt/sources.list.d/docker.list && \
      apt-get update && \
      DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        docker-ce-cli docker-compose-plugin && \
      apt-get clean && \
      rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*; \
    fi

USER node
COPY --chown=node:node . .
# Normalize copied plugin/agent paths so plugin safety checks do not reject
# world-writable directories inherited from source file modes.
RUN for dir in /app/extensions /app/.agent /app/.agents; do \
      if [ -d "$dir" ]; then \
        find "$dir" -type d -exec chmod 755 {} +; \
        find "$dir" -type f -exec chmod 644 {} +; \
      fi; \
    done
RUN pnpm build
# Force pnpm for UI build (Bun may fail on ARM/Synology architectures)
ENV OPENCLAW_PREFER_PNPM=1
RUN pnpm ui:build

# Expose the CLI binary without requiring npm global writes as non-root.
USER root
RUN ln -sf /app/openclaw.mjs /usr/local/bin/openclaw \
 && chmod 755 /app/openclaw.mjs

# Install compiled QMD from builder stage.
# /opt/qmd/dist/qmd.js has #!/usr/bin/env node shebang — directly executable.
# node_modules contains node-llama-cpp compiled with CUDA sm_121 for Blackwell GB10.
# libgomp1: GNU OpenMP runtime required by CUDA-compiled node-llama-cpp binaries.
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 \
 && rm -rf /var/lib/apt/lists/*
COPY --chown=node:node --from=qmd_builder /qmd/dist /opt/qmd/dist
COPY --chown=node:node --from=qmd_builder /qmd/node_modules /opt/qmd/node_modules
COPY --chown=node:node --from=qmd_builder /qmd/package.json /opt/qmd/package.json
RUN ln -sf /opt/qmd/dist/qmd.js /usr/local/bin/qmd \
 && chmod 755 /opt/qmd/dist/qmd.js

ENV NODE_ENV=production

USER root
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
ENV PATH="/home/node/.openclaw/bin:/home/node/.lucid/bin:/home/node/.lucid/bun/bin:/home/node/.npm-global/bin:/home/node/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

# Install skill dependencies: Bitwarden CLI (vaultwarden skill), MCPorter (mcporter skill)
RUN npm install -g @bitwarden/cli mcporter

# Install Python packages for skills
# pypdf: PDF text extraction (gamatecha-workspace skill — Drive report summarization)
RUN pip install --break-system-packages --no-cache-dir pypdf

# Start gateway server with default config.
# Binds to loopback (127.0.0.1) by default for security.
#
# IMPORTANT: With Docker bridge networking (-p 18789:18789), loopback bind
# makes the gateway unreachable from the host. Either:
#   - Use --network host, OR
#   - Override --bind to "lan" (0.0.0.0) and set auth credentials
#
# Built-in probe endpoints for container health checks:
#   - GET /healthz (liveness) and GET /readyz (readiness)
#   - aliases: /health and /ready
# For external access from host/ingress, override bind to "lan" and set auth.
HEALTHCHECK --interval=3m --timeout=10s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:18789/healthz').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "openclaw.mjs", "gateway", "--allow-unconfigured"]
