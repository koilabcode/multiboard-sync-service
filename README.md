# Multiboard Sync Service

## Mission

Build a standalone service that syncs PostgreSQL databases and Typesense search for Multiboard.

## Current Problems

1. Database sync uses shell commands (`psql`) - doesn't work on Vercel
2. Loads entire database into memory - crashes on large databases
3. CSV format causes data corruption
4. Typesense sync is a separate tool - needs to be integrated

## Solution

Build a simple Node.js service that:
- Exports/imports PostgreSQL databases using streaming
- Updates Typesense search automatically
- Shows real-time progress
- Runs on a VPS (not Vercel)

## For Devin

1. Read `IMPLEMENTATION_PLAN.md` for technical details
2. The `.env` file is already configured with credentials (DO NOT COMMIT TO GIT)
3. Build the service using Node.js and Express
4. Deploy to a VPS with PM2

## CRITICAL TESTING SAFETY RULES

**During development and testing:**
- ✅ ONLY copy FROM staging/dev TO localhost
- ❌ NEVER copy TO production or staging databases  
- ❌ NEVER use Supabase databases as destination during testing
- ⚠️ Production sync should only be done after thorough testing on localhost

## Required Features

### Database Operations
- Export database to SQL file (streaming, not in memory)
- Import SQL file to target database
- Validate schemas before import
- Create backups before changes

### Typesense Integration
- Update search index after database sync
- Support collections: components, parts, attributes
- Handle connection errors

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
- Typesense (search)

## Deployment

Deploy to a VPS with:
- 4GB RAM minimum
- Node.js 18+
- Redis
- PM2 for process management

No Docker needed - just run directly with PM2.

## Environment Variables

See `SYNC_SERVICE_CONFIG.env.example` for all required configuration.

## Success Criteria

- Handle 1-10GB databases without crashing
- Stream data (never load all into memory)
- Zero data corruption
- Typesense updates automatically
- Real-time progress display
- Simple VPS deployment

## IMPORTANT SAFETY RULE

**NEVER copy to Supabase databases as destination during testing!**
- Only copy FROM staging/production TO localhost for testing
- Supabase databases should only be import destinations in production use
- This prevents accidental data corruption during development