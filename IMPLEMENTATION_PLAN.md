# Multiboard Sync Service - Implementation Plan

## Problem to Solve

The current database sync feature cannot run on Vercel because it uses shell commands (`psql`) and loads entire databases into memory. We need a standalone service that runs on a VPS.

## What to Build

A simple Node.js service that:
1. Syncs PostgreSQL databases between environments
2. Updates Typesense search index after database sync
3. Shows real-time progress
4. Runs on a VPS (Hetzner/DigitalOcean/Linode)

## Technical Requirements

### Core Functionality

1. **Database Export**
   - Connect to source PostgreSQL using `pg` library
   - Stream data (don't load into memory)
   - Generate SQL format (not CSV)
   - Save to local file

2. **Database Import**
   - Validate target database exists
   - Create backup before import
   - Execute SQL file
   - Handle errors gracefully

3. **Typesense Sync**
   - Connect to Typesense after database sync
   - Update collections: components, parts, attributes
   - Verify sync completed

4. **Progress Tracking**
   - WebSocket or Server-Sent Events
   - Show current table being processed
   - Display percentage complete

## Technology Stack

```json
{
  "runtime": "Node.js 18+",
  "framework": "Express",
  "database": "pg (PostgreSQL client)",
  "queue": "BullMQ + Redis",
  "search": "typesense",
  "realtime": "socket.io"
}
```

## API Endpoints

```
POST /api/sync/export     - Start database export
POST /api/sync/import     - Start database import  
POST /api/sync/typesense  - Sync search index
GET  /api/jobs/:id        - Get job status
GET  /api/jobs/:id/stream - Real-time progress (SSE)
```

## Deployment

### VPS Setup
```bash
# Install Node.js 18+
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install PM2
npm install -g pm2

# Install Redis
sudo apt-get install redis-server

# Clone and run
git clone [repo]
cd multiboard-sync-service
npm install
npm start
```

### PM2 Configuration
```javascript
// ecosystem.config.js
module.exports = {
  apps: [{
    name: 'sync-service',
    script: './src/server.js',
    instances: 1,
    max_memory_restart: '2G',
    env: {
      NODE_ENV: 'production'
    }
  }]
}
```

## Database Connection

Use connection pooling with the `pg` library:

```javascript
const { Pool } = require('pg');

const sourcePool = new Pool({
  connectionString: process.env.SOURCE_DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 30000
});

// Stream data, never load all into memory
const { QueryStream } = require('pg-query-stream');
const stream = sourcePool.query(new QueryStream('SELECT * FROM "Part"'));
```

## Error Handling

1. Always validate database connections before operations
2. Create backups before destructive operations
3. Log all errors with context
4. Provide clear error messages to UI
5. Support rollback on failure

## Security

1. Use environment variables for all credentials
2. Never log sensitive data
3. Validate all inputs
4. Use connection pooling with timeouts
5. Limit concurrent operations

## Testing

Test with:
- Small database (< 100MB)
- Medium database (1-5GB)  
- Large database (10GB+)
- Network interruptions
- Invalid credentials

## Success Criteria

- No memory issues with 10GB+ databases
- Complete sync in reasonable time
- Zero data loss
- Automatic Typesense update
- Clear progress indication
- Works on basic VPS (4GB RAM)