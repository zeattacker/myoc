# syntax=docker/dockerfile:1.7

# =============================================================================
# Multi-stage build: QMD CUDA builder + upstream OpenClaw pattern
#
# Opt-in extension dependencies at build time (space-separated directory names).
# Example: docker build --build-arg OPENCLAW_EXTENSIONS="diagnostics-otel matrix" .
#
# Stage 1: qmd_builder     — compile QMD with CUDA (our custom stage)
# Stage 2: ext-deps        — extract extension package.json (from upstream)
# Stage 3: build           — compile TypeScript + bundle UI (from upstream)
# Stage 4: runtime-assets  — prune dev deps + strip build metadata (from upstream v2026.3.8)
# Stage 5: base-cuda       — CUDA runtime base image (our custom)
# Stage 6: runtime         — final image (hybrid: upstream layout + CUDA + QMD)
#
# Produces a minimal runtime image without build tools, source code, or Bun.
# Works with Docker, Buildx, and Podman.
# =============================================================================

ARG OPENCLAW_EXTENSIONS=""
ARG OPENCLAW_NODE_BOOKWORM_IMAGE="node:22-bookworm@sha256:b501c082306a4f528bc4038cbf2fbb58095d583d0419a259b2114b5ac53d12e9"
ARG OPENCLAW_NODE_BOOKWORM_DIGEST="sha256:b501c082306a4f528bc4038cbf2fbb58095d583d0419a259b2114b5ac53d12e9"

# ── Stage 1: QMD CUDA Builder ───────────────────────────────────
# Build QMD with CUDA for Blackwell GB10 (sm_121).
# Uses CUDA devel image to compile node-llama-cpp from source.
# Build contexts required:
#   qmd_src   = ~/Documents/Projects/qmd
#   llama_src = ~/Documents/Projects/llm/llcp/llama.cpp
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

# Build TypeScript -> dist/qmd.js (adds #!/usr/bin/env node shebang automatically)
RUN npm run build


# ── Stage 2: Extension deps ─────────────────────────────────────
FROM ${OPENCLAW_NODE_BOOKWORM_IMAGE} AS ext-deps
ARG OPENCLAW_EXTENSIONS
COPY extensions /tmp/extensions
# Copy package.json for opted-in extensions so pnpm resolves their deps.
RUN mkdir -p /out && \
    for ext in $OPENCLAW_EXTENSIONS; do \
      if [ -f "/tmp/extensions/$ext/package.json" ]; then \
        mkdir -p "/out/$ext" && \
        cp "/tmp/extensions/$ext/package.json" "/out/$ext/package.json"; \
      fi; \
    done


# ── Stage 3: Build ──────────────────────────────────────────────
FROM ${OPENCLAW_NODE_BOOKWORM_IMAGE} AS build

# Install Bun (required for build scripts)
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

RUN corepack enable

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY ui/package.json ./ui/package.json
COPY patches ./patches

COPY --from=ext-deps /out/ ./extensions/

# Reduce OOM risk on low-memory hosts during dependency installation.
# Docker builds on small VMs may otherwise fail with "Killed" (exit 137).
RUN --mount=type=cache,id=openclaw-pnpm-store,target=/root/.local/share/pnpm/store,sharing=locked \
    NODE_OPTIONS=--max-old-space-size=2048 pnpm install --frozen-lockfile

COPY . .

# Normalize extension paths now so runtime COPY preserves safe modes
# without adding a second full extensions layer.
RUN for dir in /app/extensions /app/.agent /app/.agents; do \
      if [ -d "$dir" ]; then \
        find "$dir" -type d -exec chmod 755 {} +; \
        find "$dir" -type f -exec chmod 644 {} +; \
      fi; \
    done

# A2UI bundle may fail under QEMU cross-compilation (e.g. building amd64
# on Apple Silicon). CI builds natively per-arch so this is a no-op there.
# Stub it so local cross-arch builds still succeed.
RUN pnpm canvas:a2ui:bundle || \
    (echo "A2UI bundle: creating stub (non-fatal)" && \
     mkdir -p src/canvas-host/a2ui && \
     echo "/* A2UI bundle unavailable in this build */" > src/canvas-host/a2ui/a2ui.bundle.js && \
     echo "stub" > src/canvas-host/a2ui/.bundle.hash && \
     rm -rf vendor/a2ui apps/shared/OpenClawKit/Tools/CanvasA2UI)
RUN pnpm build:docker
# Force pnpm for UI build (Bun may fail on ARM/Synology architectures)
ENV OPENCLAW_PREFER_PNPM=1
RUN pnpm ui:build

# ── Stage 4: Runtime assets (prune dev deps) ─────────────────────
# Prune dev dependencies and strip build-only metadata before copying
# runtime assets into the final image.
FROM build AS runtime-assets
RUN CI=true pnpm prune --prod && \
    find dist -type f \( -name '*.d.ts' -o -name '*.d.mts' -o -name '*.d.cts' -o -name '*.map' \) -delete

# ── Stage 5: CUDA runtime base ──────────────────────────────────
# Uses CUDA runtime instead of upstream's node:22-bookworm for GPU inference.
# Ubuntu 24.04 Noble (glibc 2.39) is forward-compatible with bookworm (2.36) builds.
FROM nvcr.io/nvidia/cuda:12.8.1-runtime-ubuntu24.04 AS base-cuda
ARG OPENCLAW_NODE_BOOKWORM_DIGEST

LABEL org.opencontainers.image.base.name="nvcr.io/nvidia/cuda:12.8.1-runtime-ubuntu24.04" \
  org.opencontainers.image.base.digest="${OPENCLAW_NODE_BOOKWORM_DIGEST}"

# Install Node.js 22.x from NodeSource (CUDA image doesn't include it)
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

# Create node user (uid 1000) — same as official node Docker image.
# Ubuntu 24.04 may already have uid/gid 1000 used by 'ubuntu' user — rename it.
RUN if getent passwd 1000 > /dev/null 2>&1; then \
      usermod -l node -d /home/node -m $(getent passwd 1000 | cut -d: -f1) && \
      groupmod -n node $(getent group 1000 | cut -d: -f1) 2>/dev/null || true; \
    else \
      groupadd --gid 1000 node && \
      useradd --uid 1000 --gid 1000 --shell /bin/bash --create-home node; \
    fi


# ── Stage 6: Runtime ────────────────────────────────────────────
FROM base-cuda

# OCI metadata
LABEL org.opencontainers.image.source="https://github.com/openclaw/openclaw" \
  org.opencontainers.image.url="https://openclaw.ai" \
  org.opencontainers.image.documentation="https://docs.openclaw.ai/install/docker" \
  org.opencontainers.image.licenses="MIT" \
  org.opencontainers.image.title="OpenClaw" \
  org.opencontainers.image.description="OpenClaw gateway and CLI runtime container image (CUDA GPU)"

WORKDIR /app

# Install system utilities (from upstream) + our custom additions.
# python3/pip: skill scripts; sudo: runtime admin; openssh-client: SSH skills;
# libgomp1: GNU OpenMP runtime required by CUDA-compiled node-llama-cpp.
RUN apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      procps hostname curl git openssl \
      python3 python3-pip sudo openssh-client libgomp1 && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*

RUN chown node:node /app

# Copy pruned runtime artifacts (no dev deps, no .d.ts/.map files)
COPY --from=runtime-assets --chown=node:node /app/dist ./dist
COPY --from=runtime-assets --chown=node:node /app/node_modules ./node_modules
COPY --from=runtime-assets --chown=node:node /app/package.json .
COPY --from=runtime-assets --chown=node:node /app/openclaw.mjs .
COPY --from=runtime-assets --chown=node:node /app/extensions ./extensions
COPY --from=runtime-assets --chown=node:node /app/skills ./skills
COPY --from=runtime-assets --chown=node:node /app/docs ./docs

# Keep pnpm available in the runtime image for container-local workflows.
# Use a shared Corepack home so the non-root `node` user does not need a
# first-run network fetch when invoking pnpm.
ENV COREPACK_HOME=/usr/local/share/corepack
RUN install -d -m 0755 "$COREPACK_HOME" && \
    corepack enable && \
    corepack prepare "$(node -p "require('./package.json').packageManager")" --activate && \
    chmod -R a+rX "$COREPACK_HOME"

# Install Docker CLI unconditionally (needed for sandbox/DinD).
# Uses Ubuntu noble repo (not Debian bookworm) since base is Ubuntu 24.04.
RUN install -m 0755 -d /etc/apt/keyrings && \
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
      | gpg --dearmor -o /etc/apt/keyrings/docker.gpg && \
    chmod a+r /etc/apt/keyrings/docker.gpg && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu noble stable" \
      > /etc/apt/sources.list.d/docker.list && \
    apt-get update && \
    apt-get install -y docker-ce-cli && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*

# Install additional system packages needed by skills or extensions.
# Example: docker build --build-arg OPENCLAW_DOCKER_APT_PACKAGES="wget" .
ARG OPENCLAW_DOCKER_APT_PACKAGES=""
RUN --mount=type=cache,id=openclaw-bookworm-apt-cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,id=openclaw-bookworm-apt-lists,target=/var/lib/apt,sharing=locked \
    if [ -n "$OPENCLAW_DOCKER_APT_PACKAGES" ]; then \
      apt-get update && \
      DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends $OPENCLAW_DOCKER_APT_PACKAGES; \
    fi

# Optionally install Chromium and Xvfb for browser automation.
# Build with: docker build --build-arg OPENCLAW_INSTALL_BROWSER=1 ...
# Adds ~300MB but eliminates the 60-90s Playwright install on every container start.
# Must run after node_modules COPY so playwright-core is available.
ARG OPENCLAW_INSTALL_BROWSER=""
RUN --mount=type=cache,id=openclaw-bookworm-apt-cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,id=openclaw-bookworm-apt-lists,target=/var/lib/apt,sharing=locked \
    if [ -n "$OPENCLAW_INSTALL_BROWSER" ]; then \
      apt-get update && \
      DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends xvfb && \
      mkdir -p /home/node/.cache/ms-playwright && \
      PLAYWRIGHT_BROWSERS_PATH=/home/node/.cache/ms-playwright \
      node /app/node_modules/playwright-core/cli.js install --with-deps chromium && \
      chown -R node:node /home/node/.cache/ms-playwright; \
    fi

# Normalize extension paths so plugin safety checks do not reject
# world-writable directories inherited from source file modes.
RUN for dir in /app/extensions /app/.agent /app/.agents; do \
      if [ -d "$dir" ]; then \
        find "$dir" -type d -exec chmod 755 {} +; \
        find "$dir" -type f -exec chmod 644 {} +; \
      fi; \
    done

# Expose the CLI binary without requiring npm global writes as non-root.
RUN ln -sf /app/openclaw.mjs /usr/local/bin/openclaw \
 && chmod 755 /app/openclaw.mjs

# Install compiled QMD from builder stage.
# /opt/qmd/dist/qmd.js has #!/usr/bin/env node shebang — directly executable.
# node_modules contains node-llama-cpp compiled with CUDA sm_121 for Blackwell GB10.
COPY --chown=node:node --from=qmd_builder /qmd/dist /opt/qmd/dist
COPY --chown=node:node --from=qmd_builder /qmd/node_modules /opt/qmd/node_modules
COPY --chown=node:node --from=qmd_builder /qmd/package.json /opt/qmd/package.json
RUN ln -sf /opt/qmd/dist/qmd.js /usr/local/bin/qmd \
 && chmod 755 /opt/qmd/dist/qmd.js

ENV NODE_ENV=production

# Add node user to docker group for host docker access (GID set at runtime).
# Also configure sudo access for the node user.
RUN groupadd -g 999 docker || true && \
    usermod -aG docker node && \
    echo "node ALL=(ALL) NOPASSWD: ALL" >> /etc/sudoers

# Security hardening: Run as non-root user
USER node

# Setup npm global prefix for non-root skill/MCP installs
RUN mkdir -p /home/node/.npm-global && \
    npm config set prefix /home/node/.npm-global
ENV PATH="/home/node/.openclaw/bin:/home/node/.npm-global/bin:/home/node/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

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
