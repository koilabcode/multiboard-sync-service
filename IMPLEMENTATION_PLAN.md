# Multiboard Sync Service - Implementation Plan

## Problem to Solve

The current database sync feature cannot run on Vercel because it uses shell commands (`psql`) and loads entire databases into memory. We need a standalone service that runs on a VPS.

## What to Build

A Node.js service that:
1. Syncs PostgreSQL databases between environments
2. Updates Typesense search index after database sync
3. Shows real-time progress
4. Runs on a VPS (Hetzner/DigitalOcean/Linode)

**IMPORTANT**: Check the `reference/` directory to see the current BROKEN implementation. This shows what NOT to do - avoid using shell commands, CSV format, and loading data into memory.

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

3. **Typesense Sync**
   - Connect to Typesense after database sync completes
   - Update these collections: components, parts, attributes
   - Handle connection failures gracefully
   - Verify sync was successful

4. **Progress Tracking**
   - Implement real-time updates using WebSocket or Server-Sent Events
   - Show which table is currently being processed
   - Display percentage complete
   - Estimate time remaining
   - Send updates to connected clients

## Architecture Guidelines

### Technology Stack
- Use Node.js 18 or higher
- Use Express for HTTP server
- Use pg library for PostgreSQL connections
- Use BullMQ with Redis for job queue
- Use Socket.io or SSE for real-time updates
- Use Typesense JavaScript client

### API Design
Create REST endpoints for:
- Starting export jobs
- Starting import jobs
- Triggering Typesense sync
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
- Node.js 18+ installed
- Redis installed for job queue
- PM2 for process management
- Nginx for reverse proxy (optional)

### Process Management
Use PM2 to:
- Keep the service running
- Auto-restart on crashes
- Monitor memory usage
- Rotate logs
- Support zero-downtime deployments

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
- Typesense connection failures
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
- Typesense credentials
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
- Updates Typesense automatically
- Recovers from failures gracefully
- Can be deployed with simple commands