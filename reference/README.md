# Reference Implementation

This directory contains the CURRENT BROKEN implementation that needs to be replaced.

## Why These Files Don't Work

These files from the current admin app have critical problems:

1. **Uses Shell Commands**: They execute `psql` commands via `exec()` which doesn't work on Vercel
2. **Memory Issues**: Loads entire database into memory causing crashes
3. **CSV Format**: Uses CSV with COPY commands that cause data corruption
4. **No Typesense Integration**: Search sync is a completely separate tool

## Files Included

- `export-route.ts` - Current export implementation (uses psql shell commands)
- `import-route.ts` - Current import implementation (uses psql shell commands)
- `databases-config.ts` - Database configuration helper
- `middleware.ts` - Authentication middleware
- `databases-route.ts` - Lists available databases
- `validate-route.ts` - Validates export files

## What Needs to Change

### Replace Shell Commands
Current (BROKEN):
- Uses `PGPASSWORD='${password}' psql -h ${host} -c "\\copy ..."`
- Requires psql binary

New (REQUIRED):
- Use `pg` library for native PostgreSQL connections
- Stream data without shell commands

### Fix Memory Usage
Current (BROKEN):
- Loads entire tables into memory
- Crashes on databases over 1GB

New (REQUIRED):
- Stream all data
- Never load full tables into memory
- Use cursor-based queries

### Replace CSV Format
Current (BROKEN):
- Uses CSV with COPY commands
- Has encoding and escaping issues

New (REQUIRED):
- Generate proper SQL dumps
- Handle all data types correctly

### Add Typesense Integration
Current (MISSING):
- No Typesense sync
- Separate external tool at http://188.245.47.69:5000/

New (REQUIRED):
- Integrate Typesense sync
- Update search after database sync
- Handle collections: components, parts, attributes

## Important Notes

- DO NOT copy the approach from these files
- These are examples of what NOT to do
- The new service must work completely differently
- Focus on streaming, no shell commands, proper SQL format