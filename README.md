# Multiboard Database & Search Sync Service

## 🎯 Mission

Build a standalone service that syncs PostgreSQL databases and Typesense search indices for the Multiboard parts library system. This service replaces the current broken sync feature that cannot run on Vercel.

## 🤖 Instructions for Devin

This entire service should be built by you (Devin). This README contains everything you need to build a production-ready sync service.

### Your Task

1. **Read** `DATABASE_SYNC_SERVICE_PLAN.md` for complete architecture details
2. **Configure** credentials using `SYNC_SERVICE_CONFIG.env.example` 
3. **Build** a simple, reliable service that runs on a VPS
4. **Test** with real database dumps
5. **Document** how to deploy and operate

## 🚨 Current Problems to Solve

1. **Vercel Incompatible**: Current sync uses `psql` shell commands
2. **Memory Crashes**: Loads entire database into memory
3. **Data Corruption**: CSV format causes encoding issues
4. **Fragmented Tools**: Typesense sync is a separate tool
5. **No Progress Tracking**: Can't see what's happening during sync

## ✅ What to Build

### Core Features

```
multiboard-sync-service/
├── apps/
│   ├── api/          # Node.js API service
│   └── web/          # Next.js UI (optional)
├── docker/
│   └── docker-compose.yml
├── scripts/
│   └── deploy.sh     # One-click deployment
└── docs/
    └── OPERATION.md  # How to run this service
```

### Required Functionality

1. **Database Export**
   - Stream data from PostgreSQL (don't load in memory)
   - Generate SQL dumps (not CSV)
   - Support partial exports (specific tables)

2. **Database Import** 
   - Validate schema before import
   - Auto-backup before changes
   - Stream SQL execution
   - Rollback on failure

3. **Typesense Sync**
   - Update search index after database sync
   - Support incremental updates
   - Validate collections exist

4. **Progress Tracking**
   - WebSocket/SSE for real-time updates
   - Show current table being processed
   - Estimate time remaining

## 🛠 Technical Requirements

### Use These Libraries

```json
{
  "dependencies": {
    "pg": "^8.11.0",           // PostgreSQL client
    "express": "^4.18.0",       // API framework
    "bullmq": "^4.0.0",         // Job queue
    "socket.io": "^4.6.0",      // Real-time updates
    "typesense": "^1.7.0",      // Search client
    "zlib": "^1.0.5"            // Compression
  }
}
```

### PostgreSQL Connection Example

```javascript
const { Pool } = require('pg');
const { pipeline } = require('stream');

// Use connection pooling
const sourcePool = new Pool({ connectionString: SOURCE_DATABASE_URL });
const targetPool = new Pool({ connectionString: TARGET_DATABASE_URL });

// Stream data, don't load in memory!
async function exportTable(tableName) {
  const stream = sourcePool.query(new QueryStream(`SELECT * FROM "${tableName}"`));
  // Process stream in chunks...
}
```

### Docker Setup

```yaml
# docker-compose.yml
version: '3.8'

services:
  api:
    build: ./apps/api
    ports: ["8080:8080"]
    env_file: .env
    volumes:
      - ./dumps:/app/dumps
    depends_on:
      - redis

  redis:
    image: redis:7-alpine
    volumes:
      - redis-data:/data

  nginx:
    image: nginx:alpine
    ports: ["80:80"]
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
    depends_on:
      - api

volumes:
  redis-data:
```

## 📁 Current Code Reference

Look at these files to understand what needs to be replaced:

### Database Sync (Currently Broken)
- `/apps/admin/app/api/sync-database/export/route.ts` - Uses psql commands
- `/apps/admin/app/api/sync-database/import/route.ts` - Uses psql commands
- Problem: Executes shell commands like `PGPASSWORD='...' psql -h ...`

### Typesense Sync (External Tool)
- Currently at: http://188.245.47.69:5000/
- Needs to be integrated into this service

## 🚀 Development Steps

### Step 1: Setup Project

```bash
# Initialize project
npm init -y
npm install express pg bullmq socket.io typesense dotenv

# Create structure
mkdir -p apps/api apps/web docker scripts
```

### Step 2: Build Core API

Create `/apps/api/server.js`:

```javascript
const express = require('express');
const { Pool } = require('pg');
const Bull = require('bullmq');

const app = express();

// Endpoints
app.post('/api/sync/export', handleExport);
app.post('/api/sync/import', handleImport);
app.post('/api/sync/typesense', handleTypesense);
app.get('/api/jobs/:id', getJobStatus);

// WebSocket for progress
io.on('connection', (socket) => {
  socket.on('subscribe', (jobId) => {
    socket.join(`job:${jobId}`);
  });
});
```

### Step 3: Implement Export/Import

Replace shell commands with native PostgreSQL:

```javascript
// BAD (current approach)
exec(`PGPASSWORD='${password}' psql -h ${host} -c "\\copy ..."`)

// GOOD (new approach)  
const { rows } = await pool.query('SELECT * FROM "Component"');
const sql = generateInsertStatements(rows);
```

### Step 4: Add Typesense Integration

```javascript
const Typesense = require('typesense');

const client = new Typesense.Client({
  nodes: [{ host: 'your-typesense-host', port: 443, protocol: 'https' }],
  apiKey: process.env.TYPESENSE_API_KEY
});

async function syncTypesense(tables) {
  // Update collections after database sync
  for (const table of tables) {
    await client.collections(table.toLowerCase()).documents().import(data);
  }
}
```

### Step 5: Deploy to VPS

```bash
# deploy.sh
#!/bin/bash
ssh root@your-vps-ip << 'EOF'
  cd /opt/sync-service
  git pull
  docker-compose down
  docker-compose build
  docker-compose up -d
  echo "Deployed successfully!"
EOF
```

## 🧪 Testing Requirements

1. **Unit Tests**: Core sync logic
2. **Integration Tests**: Database operations
3. **Load Tests**: Handle 10GB+ databases
4. **Error Tests**: Rollback scenarios

## 📋 Acceptance Criteria

- [ ] Replaces current sync without using shell commands
- [ ] Handles 10GB+ databases without memory issues  
- [ ] Syncs Typesense automatically after database sync
- [ ] Shows real-time progress via WebSocket
- [ ] Runs on simple VPS with Docker Compose
- [ ] One-click deployment script
- [ ] Zero data corruption in testing

## 🔑 Environment Configuration

Copy `SYNC_SERVICE_CONFIG.env.example` to `.env` and fill in:

```env
# Database URLs
PRODUCTION_DATABASE_URL=postgresql://...
STAGING_DATABASE_URL=postgresql://...

# Typesense
TYPESENSE_HOST=your-typesense-host
TYPESENSE_API_KEY=your-api-key

# Redis
REDIS_URL=redis://localhost:6379
```

## 📝 Documentation to Create

1. **DEPLOYMENT.md** - How to deploy to VPS
2. **OPERATION.md** - How to run syncs
3. **TROUBLESHOOTING.md** - Common issues and fixes

## 🎯 Success Metrics

- Sync 5GB database in <5 minutes
- Use <2GB RAM during sync
- 100% success rate in testing
- Typesense updated within 1 minute

## 💡 Important Notes

1. **DO NOT** load entire tables into memory
2. **DO NOT** use shell commands (`exec`, `spawn`)
3. **DO** use streaming for all data operations
4. **DO** validate schemas before import
5. **DO** create backups before destructive operations

## 📞 Questions?

If anything is unclear, review:
- `DATABASE_SYNC_SERVICE_PLAN.md` - Full technical details
- `SYNC_SERVICE_CONFIG.env.example` - All configuration options

## 🚢 Ready to Ship?

When complete, this service should:
1. Run independently on any VPS
2. Handle production workloads reliably
3. Be maintainable by the team
4. Cost <$30/month to operate

Good luck, Devin! Build something simple, reliable, and effective.