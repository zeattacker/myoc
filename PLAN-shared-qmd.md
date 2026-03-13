# Plan: Shared QMD for Company Docs (Option C)
**Tanggal implementasi:** 2026-03-04
**Status:** ✅ SELESAI & VERIFIED

---

## Latar Belakang

Company doc collections (11 collections dari Google Drive) sebelumnya diindeks **per-agent** di QMD,
menghasilkan 275MB storage (vs ~55MB shared) dan 5x compute saat `qmd embed` di daily-ingest.

Plan ini memigrasikan company docs ke **shared QMD daemon** di dalam container openclaw-gateway
yang sama (port 19300), sedangkan per-agent QMD daemons (19200-19204) tetap eksklusif untuk
agentic memory (workspace, sessions).

---

## Arsitektur Setelah Migrasi

```
openclaw-gateway container:
├── Per-agent QMD daemons (port 19200-19204) → workspace + session memory SAJA
└── Shared QMD daemon (port 19300)           → 11 company doc collections
    XDG_CACHE_HOME: ~/.openclaw/qmd/shared/xdg-cache
    XDG_CONFIG_HOME: ~/.openclaw/qmd/shared/xdg-config
```

---

## Yang Diimplementasikan

### Step 1 — Git Commits & Push ✅

| Repo | File | Perubahan |
|------|------|-----------|
| `qmd` (zeattacker/qmd) | `src/mcp.ts` | IPv4 fix: `listen("localhost")` → `listen("127.0.0.1")` |
| `openclaw-docker` (zeattacker/myoc) | `src/telegram/bot-message-dispatch.ts` | previewTransport fallback: `"auto"` → `"draft"` |
| `mission-control` (branch v2.3.0-gateway-migration) | Dockerfile, server.py, assets/index.html, css/, js/, server/, skills/, scripts/ | Phase 3 plan server (port 8001) + dashboard UI updates |

### Step 2 — Shared QMD Config ✅

**File baru:** `~/.openclaw/qmd/shared/xdg-config/qmd/index.yml`

11 collections dikonfigurasi dengan path container:
- `daily-report-marketing`, `monthly-reports`, `meeting-notes`, `change-request-reports`
- `business-travel-reports`, `sop-docs`, `project-reports-2026`, `project-archive-2025`
- `pengadaan-barang`, `pengadaan-jasa`, `tech-team-docs`

### Step 3 — Startup Hook `qmd-shared-start` ✅

**File baru:**
- `~/.openclaw/hooks/qmd-shared-start/HOOK.md` — event: `gateway:startup`
- `~/.openclaw/hooks/qmd-shared-start/handler.js` — spawn detached `qmd mcp --http --port 19300`

Logic:
1. Health check `http://127.0.0.1:19300/health` (timeout 2s)
2. Jika sudah running → skip
3. Jika belum → `spawn('qmd', [...], { detached: true, stdio: 'ignore' })` + `proc.unref()`

### Step 4 — Update `openclaw.json` ✅

`memory.qmd.paths[]` dikurangi dari 13 entries → **2 entries** (workspace only):
- `shared-workspace` (MEMORY.md)
- `shared-workspace-memory` (memory/*.md)

11 company doc paths dihapus — tidak lagi diindeks oleh per-agent daemons.

### Step 5 — Update `daily-ingest.sh` ✅

**File:** `~/.openclaw/skills/gamatecha-workspace/scripts/daily-ingest.sh`

Bagian "── QMD Index ──" diganti:
```bash
# SEBELUM: loop 5 agent × qmd embed
for AGENT_ID in zenith orion cipher ledger nova; do
  XDG_CACHE_HOME_AGENT="/home/node/.openclaw/agents/$AGENT_ID/qmd/xdg-cache"
  ...qmd embed...
done

# SESUDAH: 1x qmd update ke shared daemon
XDG_CACHE_HOME="/home/node/.openclaw/qmd/shared/xdg-cache" \
XDG_CONFIG_HOME="/home/node/.openclaw/qmd/shared/xdg-config" \
qmd update
```

### Step 6 — Update Fetch Briefing Scripts ✅

Tiga script diupdate: `QMD=` variable + hapus suffix agent dari collection names.

**`fetch-nova-briefing.sh`:**
- `QMD=`: `agents/nova/qmd/xdg-{cache,config}` → `qmd/shared/xdg-{cache,config}`
- Collection names: hapus suffix `-nova` di semua referensi
- `memory-dir-nova` dihapus dari COLLECTIONS array
- Path `daily-report-marketing-nova/root/...` → `daily-report-marketing/root/...`

**`fetch-cipher-briefing.sh`:**
- `QMD=`: `agents/cipher/qmd/xdg-{cache,config}` → `qmd/shared/xdg-{cache,config}`
- Collection names: hapus suffix `-cipher` di semua referensi
- `memory-dir-cipher` dihapus dari COLLECTIONS array
- `qmd_ls_and_get_latest` paths: `tech-team-docs-cipher/...` → `tech-team-docs/...`

**`fetch-orion-briefing.sh`:**
- `QMD=`: `agents/orion/qmd/xdg-{cache,config}` → `qmd/shared/xdg-{cache,config}`
- Collection names: hapus suffix `-orion` di semua referensi
- `memory-dir-orion` dihapus dari COLLECTIONS array
- Direct `qmd get` paths: `project-reports-2026-orion/...` → `project-reports-2026/...`

### Step 7 — Update `qmd-search/SKILL.md` ✅

**File:** `~/.openclaw/skills/qmd-search/SKILL.md`

- Base URL: `http://host.docker.internal:8282` → `http://127.0.0.1:19300`
- Hapus referensi mcporter dan standalone container lama
- Kolom "Agent" dihapus dari collection table (shared, tidak per-agent)
- Tambah catatan: daemon via startup hook + troubleshooting manual start
- Update semua contoh curl ke URL baru

### Step 8 — Update MEMORY.md ✅

**File:** `~/.claude/projects/.../memory/MEMORY.md`

Section `## QMD Document Search Layer` diupdate:
- Arsitektur baru: shared daemon port 19300 + per-agent 19200-19204
- `openclaw.json paths[]`: 2 entries only (workspace)
- Collection names tanpa agent suffix
- `daily-ingest.sh`: single `qmd update` (bukan 5x loop)
- Fetch briefing scripts: QMD= shared

---

## Verifikasi (Dijalankan 2026-03-04) ✅

```
# 1. Gateway restart
docker compose up -d --force-recreate openclaw-gateway
→ Hook registered: qmd-shared-start -> gateway:startup ✓

# 2. Daemon health check
curl http://127.0.0.1:19300/health
→ {"status":"ok","uptime":16} ✓

# 3. Initial index
qmd update (shared XDG)
→ ✓ All collections updated.
→ 11/11 collections processed
→ 823 unique hashes need vectors

# 4. Embedding
qmd embed (shared XDG)
→ ✓ Done! Embedded 293 docs in 3m 22s
→ 2844 "failures" = UNIQUE constraint (already written by partial first run) — OK

# 5. Test search (lex + vec)
POST http://127.0.0.1:19300/query
→ daily-report-marketing score 0.93 ✓
→ sop-docs score 0.56 ✓
→ BM25 + vector search working ✓
```

---

## Storage Improvement

| Sebelum | Sesudah |
|---------|---------|
| 5 per-agent indexes × 11 collections = ~275MB | 1 shared index × 11 collections = ~55MB |
| `qmd embed` 5x per daily-ingest | `qmd update` 1x per daily-ingest |
| Collection names: `daily-report-marketing-nova` | Collection names: `daily-report-marketing` |
