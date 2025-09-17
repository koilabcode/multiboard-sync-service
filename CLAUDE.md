# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Go service for syncing PostgreSQL databases for Multiboard. It's designed to run on a VPS (not Vercel) and handle large databases through streaming operations with excellent memory efficiency and native concurrency.

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
- Use `pgx/v5` library for native PostgreSQL connections with superior performance
- Stream all data using Go's efficient I/O (never load full tables into memory)
- Generate proper SQL dumps (not CSV)
- Use Asynq with Redis for job queuing
- Use gorilla/websocket or SSE for real-time progress updates
- Leverage goroutines for concurrent table exports

## Development Setup

Initialize the Go module:
```bash
go mod init github.com/koilabcode/multiboard-sync-service
go get github.com/jackc/pgx/v5
go get github.com/hibiken/asynq
go get github.com/gorilla/websocket
go get github.com/joho/godotenv
go get github.com/rs/zerolog
```

## Common Commands

### Local Development
```bash
go run cmd/server/main.go  # Run directly
go build -o sync-service cmd/server/main.go  # Build binary
air  # Hot reload with Air (optional)
```

### Production Deployment
```bash
go build -o sync-service cmd/server/main.go
sudo systemctl start sync-service
sudo systemctl restart sync-service
journalctl -u sync-service -f  # View logs
```

## Core Components Architecture

### Database Operations (`internal/database/`)
- Export: Stream tables using pgx/v5 CopyFrom for maximum performance
- Import: Execute SQL files using streaming with proper transaction boundaries
- Backup: Create automatic backups using pg_dump equivalent in Go
- Use connection pools and prepared statements
- Leverage goroutines for parallel table processing

### Job Queue (`internal/queue/`)
- Use Asynq with Redis for distributed job processing
- Track job progress using Redis keys
- Support job cancellation via context
- Maintain job history with TTL

### Real-time Updates (`internal/websocket/`)
- Implement gorilla/websocket or Server-Sent Events
- Use channels for broadcasting updates to multiple clients
- Send progress updates for: current table, percentage complete, estimated time
- Handle client reconnections with goroutine management

## Project Structure

```
cmd/
  server/
    main.go         # Main entry point
internal/
  database/         # Database operations
  queue/            # Job queue management
  websocket/        # Real-time updates
  handlers/         # HTTP handlers
  config/           # Configuration
pkg/
  models/           # Shared data models
migrations/         # Database migrations
```

## API Endpoints Structure

- `POST /api/sync/export` - Start database export job
- `POST /api/sync/import` - Start database import job
- `GET /api/jobs/:id` - Get job status
- `GET /api/jobs` - List recent jobs
- `DELETE /api/jobs/:id` - Cancel running job
- WebSocket at `/ws` for real-time updates

## Environment Configuration

The `.env` file contains all credentials (DO NOT COMMIT). Key variables:
- Database URLs: `PRODUCTION_DATABASE_URL`, `STAGING_DATABASE_URL`, `DEV_DATABASE_URL`
- Redis: `REDIS_URL`
- Service: `PORT`, `API_KEY`, `NODE_ENV`
- Storage: `DUMP_DIRECTORY`, `BACKUP_DIRECTORY`

## Performance Requirements

- Handle 1-10GB databases without crashes
- Use less than 500MB RAM during operations (Go's efficiency)
- Stream all data operations with minimal allocations
- Support multiple concurrent jobs with goroutines
- Complete 1GB sync in under 5 minutes (Go's superior performance)

## Testing Strategy

Test with progressively larger databases:
1. Small test database (<100MB) on localhost
2. Medium database (1-5GB) from staging to localhost
3. Large database (10GB+) stress testing
4. Network failure recovery testing
5. Concurrent operations testing with race detector (`go test -race`)

Benchmarking:
```bash
go test -bench=. ./...
go test -benchmem -bench=. ./...  # Include memory allocations
```

Remember: During testing, only sync FROM staging/dev TO localhost, never the reverse.