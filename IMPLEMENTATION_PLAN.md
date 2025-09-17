# Multiboard Sync Service - Implementation Plan

## Problem to Solve

The current database sync feature cannot run on Vercel because it uses shell commands (`psql`) and loads entire databases into memory. We need a standalone service that runs on a VPS.

## What to Build

A Go service that:
1. Syncs PostgreSQL databases between environments
2. Shows real-time progress of sync operations
3. Runs on a VPS (Hetzner/DigitalOcean/Linode)

**IMPORTANT**: Check the `reference/` directory to see the current BROKEN implementation. This shows what NOT to do - avoid using shell commands, CSV format, and loading data into memory.

## Implementation Phases

### Phase 1: Foundation Setup
**Goal**: Create the basic service structure and job processing system

**Steps**:
1. Initialize Go module and project structure
2. Set up basic folder structure (cmd/, internal/, pkg/, config/)
3. Create HTTP server with health check endpoint
4. Implement Redis connection for job queue
5. Set up Asynq job processor skeleton
6. Add basic error handling and logging

**Deliverables**:
- Go HTTP server running on configured port
- `/health` endpoint returning 200 OK
- Redis connected and job queue initialized
- Basic job can be added and processed (test job)

### Phase 2: Database Connectivity Layer
**Goal**: Establish reliable connections to all database environments

**Steps**:
1. Create database connection manager using `pgx/v5` library
2. Implement connection pooling for each database
3. Build connection validation functions
4. Create endpoint to test database connections
5. Add connection retry logic with exponential backoff
6. Implement connection cleanup on shutdown

**Deliverables**:
- `GET /api/databases` - Lists available databases
- `POST /api/databases/test` - Tests connection to specified database
- Connection pools properly managed
- Graceful handling of connection failures

### Phase 3: Export Functionality
**Goal**: Stream database tables to SQL files without loading into memory

**Steps**:
1. Create streaming query function for single table
2. Build SQL dump format generator (CREATE TABLE, INSERT statements)
3. Implement table-by-table export with progress tracking
4. Add support for all PostgreSQL data types
5. Handle special characters and escaping properly
6. Save exports to filesystem with proper naming

**Deliverables**:
- `POST /api/sync/export` - Starts export job
- Streaming export of single table working
- Full database export with all tables
- Progress updates via job status
- SQL files saved to `DUMP_DIRECTORY`

### Phase 4: Import Functionality
**Goal**: Safely import SQL dumps to target database

**Steps**:
1. Create backup mechanism before any import
2. Build streaming SQL file reader
3. Implement transaction-based import for safety
4. Add schema validation before import
5. Create rollback mechanism on failure
6. Implement import progress tracking

**Deliverables**:
- `POST /api/sync/import` - Starts import job
- Automatic backup creation before import
- Streaming import without loading file into memory
- Transaction rollback on any error
- Progress updates during import

### Phase 5: Progress Tracking & Real-time Updates
**Goal**: Provide real-time feedback on sync operations

**Steps**:
1. Implement WebSocket server using gorilla/websocket or SSE
2. Create progress calculation for exports/imports
3. Build client connection management with goroutines
4. Add detailed status messages (current table, rows processed)
5. Implement time estimation algorithm
6. Create job history storage

**Deliverables**:
- WebSocket endpoint for real-time updates
- `GET /api/jobs` - List all jobs with status
- `GET /api/jobs/:id` - Get specific job details
- Progress percentage and time estimates
- Real-time updates to connected clients

### Phase 6: Web Interface
**Goal**: Simple UI for managing sync operations

**Steps**:
1. Create static HTML interface
2. Add forms for starting export/import jobs
3. Implement real-time progress display
4. Show job history table
5. Add error message display
6. Create job cancellation buttons

**Deliverables**:
- Web interface at root path `/`
- Start export/import forms
- Real-time progress bars
- Job history with status
- Error handling in UI

### Phase 7: Production Readiness
**Goal**: Prepare service for production deployment

**Steps**:
1. Add comprehensive error handling
2. Implement file cleanup for old dumps
3. Create systemd service configuration
4. Add resource usage monitoring with pprof
5. Implement API key authentication middleware
6. Set up structured logging with zerolog

**Deliverables**:
- Systemd service file
- Authenticated API endpoints
- Automatic cleanup of old files
- Structured JSON logs
- Resource limits enforced
- Deployment documentation

## Technical Requirements

### Core Functionality

1. **Database Export**
   - Connect to source PostgreSQL database
   - Stream data table by table (never load all into memory)
   - Generate SQL format output (not CSV)
   - Handle large databases (10GB+)
   - Save output to local filesystem

2. **Database Import**
   - Validate target database connection
   - Create automatic backup before import
   - Execute SQL file in streaming fashion
   - Support rollback on failure
   - Provide clear error messages

3. **Progress Tracking**
   - Implement real-time updates using WebSocket or Server-Sent Events
   - Show which table is currently being processed
   - Display percentage complete
   - Estimate time remaining
   - Send updates to connected clients

## Architecture Guidelines

### Technology Stack
- Use Go 1.21 or higher
- Use standard net/http or Gin for HTTP server
- Use pgx/v5 for PostgreSQL connections
- Use Asynq with Redis for job queue
- Use gorilla/websocket or SSE for real-time updates

### API Design
Create REST endpoints for:
- Starting export jobs
- Starting import jobs
- Getting job status
- Streaming progress updates
- Canceling running jobs

### Database Connection Strategy
- Use connection pooling
- Set appropriate timeouts
- Handle connection failures
- Support multiple simultaneous connections
- Never load entire result sets into memory

### Error Handling Requirements
- Validate all inputs
- Check database connectivity before operations
- Create backups before destructive operations
- Log all errors with context
- Provide user-friendly error messages
- Support graceful shutdown

### Security Requirements
- Store all credentials in environment variables
- Never log sensitive information
- Validate and sanitize all user inputs
- Implement API key authentication
- Limit concurrent operations
- Set resource limits

## Deployment Requirements

### VPS Setup
The service should run on a VPS with:
- Minimum 4GB RAM
- Ubuntu or Debian Linux
- Go 1.21+ installed (or deploy compiled binary)
- Redis installed for job queue
- Systemd for process management
- Nginx for reverse proxy (optional)

### Process Management
Use systemd to:
- Keep the service running
- Auto-restart on crashes
- Monitor memory usage
- Handle log output
- Support graceful restarts

### File Storage
- Store SQL dumps in a dedicated directory
- Implement automatic cleanup of old files
- Set maximum storage limits
- Compress files when possible

## Testing Requirements

**CRITICAL SAFETY RULE**: During development and testing, ONLY copy FROM staging/dev TO localhost. NEVER use Supabase databases as destination!

Test the service with:
- Small test database (less than 100MB)
- Medium database (1-5GB)
- Large database (10GB+)
- Slow network connections
- Database connection failures
- Concurrent operations

**Testing Database Rules:**
- ✅ Source: Staging or Dev database (Supabase) 
- ✅ Destination: Localhost database only
- ❌ NEVER copy TO production database
- ❌ NEVER copy TO staging database
- ❌ NEVER copy TO dev database (Supabase)
- ⚠️ Production operations only after thorough localhost testing

## Performance Requirements

The service must:
- Handle databases up to 1-10 GB
- Use less than 2GB RAM during operations
- Stream all data (no full loading)
- Support multiple concurrent jobs
- Complete 1GB sync in under 10 minutes
- Recover from network interruptions

## User Interface Requirements

Create a simple web interface that:
- Shows list of recent sync jobs
- Displays real-time progress
- Allows starting new sync jobs
- Shows error messages clearly
- Provides job history
- Allows job cancellation

## Configuration

The service should be configurable via environment variables for:
- Database connection strings
- Redis connection
- Port number
- API authentication key
- Resource limits
- Feature flags

## Success Criteria

The service is complete when it:
- Runs reliably on a VPS
- Handles production database sizes
- Never corrupts data
- Provides clear progress indication
- Recovers from failures gracefully
- Can be deployed with simple commands