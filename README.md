# Multiboard Sync Service

## Mission

Build a standalone service that syncs PostgreSQL databases for Multiboard.

## Current Problems

1. Database sync uses shell commands (`psql`) - doesn't work on Vercel
2. Loads entire database into memory - crashes on large databases
3. CSV format causes data corruption

## Solution

Build a simple Node.js service that:
- Exports/imports PostgreSQL databases using streaming
- Shows real-time progress
- Runs on a VPS (not Vercel)

## For Devin

1. Read `IMPLEMENTATION_PLAN.md` for technical details
2. **IMPORTANT**: Check `reference/` directory to see the BROKEN implementation - learn what NOT to do
3. The `.env` file is already configured with credentials (DO NOT COMMIT TO GIT)
4. Build the service using Node.js and Express
5. Deploy to a VPS with PM2

## Phase 1 (delivered in this PR)

- TypeScript + Express scaffold
- Health endpoints:
  - GET `/health` → 200 `{ ok: true }`
  - GET `/ready` → 200 when Redis is reachable; 503 otherwise
- Redis connection (ioredis) and BullMQ queue/worker skeleton
- Logging (pino) with secret redaction
- Minimal test job endpoint:
  - POST `/jobs/test` → enqueues a small test job and returns `{ id }`

### Run locally

Prereqs:
- Node.js 18+
- Redis running locally (e.g., `redis-server` or `docker run -p 6379:6379 redis:7`)

Setup:
- Copy `.env.example` to `.env` and set at least:
  ```
  REDIS_URL=redis://localhost:6379
  PORT=8080
  NODE_ENV=development
  LOG_LEVEL=debug
  ```
- Install deps:
  ```
  nvm install 18 && nvm use 18
  npm i
  ```

Start:
- Dev mode: `npm run start:dev`
- Watch mode: `npm run dev`

Verify:
- `curl http://localhost:8080/health` → `{"ok":true}`
- `curl http://localhost:8080/ready` → `{"ok":true,"checks":{"redis":true}}` (requires Redis)
- `curl -X POST http://localhost:8080/jobs/test` → `{"id":"<jobId>"}` and logs should show the worker processing the job

## CRITICAL TESTING SAFETY RULES

**During development and testing:**
- ✅ ONLY copy FROM staging/dev TO localhost
- ❌ NEVER copy TO production or staging databases  
- ❌ NEVER use Supabase databases as destination during testing
- ⚠️ Production sync should only be done after thorough testing on localhost

## Required Features (next phases)

### Database Operations
- Export database to SQL file (streaming, not in memory)
- Import SQL file to target database
- Validate schemas before import
- Create backups before changes

### Progress Tracking
- Real-time updates via WebSocket or SSE
- Show current operation status
- Display percentage complete

## Tech Stack

- Node.js 18+
- Express
- PostgreSQL (`pg` library)
- Redis + BullMQ (job queue)
- Socket.io (real-time updates)

## Deployment

Deploy to a VPS with:
- 4GB RAM minimum
- Node.js 18+
- Redis
- PM2 for process management

No Docker needed - just run directly with PM2.

## Environment Variables

See `.env.example` for all required configuration.

## Success Criteria

- Handle 1-10GB databases without crashing
- Stream data (never load all into memory)
- Zero data corruption
- Real-time progress display
- Simple VPS deployment

## IMPORTANT SAFETY RULE

**NEVER copy to Supabase databases as destination during testing!**
- Only copy FROM staging/production TO localhost for testing
- Supabase databases should only be import destinations in production use
- This prevents accidental data corruption during development
