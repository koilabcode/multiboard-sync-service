# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Node.js service for syncing PostgreSQL databases for Multiboard. It's designed to run on a VPS (not Vercel) and handle large databases through streaming operations.

## Critical Safety Rules

**During development and testing:**
- ✅ ONLY copy FROM staging/dev TO localhost
- ❌ NEVER copy TO production or staging databases
- ❌ NEVER use Supabase databases as destination during testing
- ⚠️ Production sync should only be done after thorough testing on localhost

## Architecture Constraints

### What NOT to do (from broken reference implementation)
The `reference/` directory contains the current broken implementation. Avoid these patterns:
- Shell commands (`psql`, `exec()`) - doesn't work on Vercel
- Loading entire datasets into memory - causes crashes
- CSV format with COPY commands - causes data corruption

### Required Approach
- Use `pg` library for native PostgreSQL connections
- Stream all data (never load full tables into memory)
- Generate proper SQL dumps (not CSV)
- Use BullMQ with Redis for job queuing
- Use Socket.io or SSE for real-time progress updates

## Development Setup

Since the project doesn't have a package.json yet, initialize with:
```bash
npm init -y
npm install express pg bullmq socket.io redis ioredis dotenv
npm install --save-dev @types/node @types/express nodemon typescript
```

## Common Commands

### Local Development
```bash
npm run dev        # Run with nodemon (after setup)
node src/server.js # Run directly
```

### Production Deployment
```bash
pm2 start src/server.js --name sync-service
pm2 restart sync-service
pm2 logs sync-service
```

## Core Components Architecture

### Database Operations (`src/services/database.js`)
- Export: Stream tables using cursor-based queries with `pg` library
- Import: Execute SQL files in streaming fashion with transaction support
- Backup: Create automatic backups before destructive operations
- Never use `psql` shell commands or load entire result sets into memory

### Job Queue (`src/services/queue.js`)
- Use BullMQ with Redis for managing sync jobs
- Track job progress and status
- Support job cancellation and retries
- Maintain job history

### Real-time Updates (`src/services/websocket.js`)
- Implement Socket.io or Server-Sent Events
- Send progress updates for: current table, percentage complete, estimated time
- Handle client reconnections gracefully

## API Endpoints Structure

- `POST /api/sync/export` - Start database export job
- `POST /api/sync/import` - Start database import job
- `GET /api/jobs/:id` - Get job status
- `GET /api/jobs` - List recent jobs
- `DELETE /api/jobs/:id` - Cancel running job
- WebSocket at `/socket.io` for real-time updates

## Environment Configuration

The `.env` file contains all credentials (DO NOT COMMIT). Key variables:
- Database URLs: `PRODUCTION_DATABASE_URL`, `STAGING_DATABASE_URL`, `DEV_DATABASE_URL`
- Redis: `REDIS_URL`
- Service: `PORT`, `API_KEY`, `NODE_ENV`
- Storage: `DUMP_DIRECTORY`, `BACKUP_DIRECTORY`

## Performance Requirements

- Handle 1-10GB databases without crashes
- Use less than 2GB RAM during operations
- Stream all data operations
- Support multiple concurrent jobs
- Complete 1GB sync in under 10 minutes

## Testing Strategy

Test with progressively larger databases:
1. Small test database (<100MB) on localhost
2. Medium database (1-5GB) from staging to localhost
3. Large database (10GB+) stress testing
4. Network failure recovery testing
5. Concurrent operations testing

Remember: During testing, only sync FROM staging/dev TO localhost, never the reverse.