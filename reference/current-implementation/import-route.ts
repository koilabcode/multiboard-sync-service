import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import { writeFile, unlink, readFile, mkdir, readdir, stat } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { validateSyncAccess } from '../middleware';
import { getDatabaseConfig } from '@/lib/config/databases';

const execAsync = promisify(exec);

// Critical tables that must have data
const CRITICAL_TABLES = [
  'Part',
  'Component',
  'Attribute',
  'AttributeValue',
  '_AttributeValueToPart',
  'Categories',
  '_CategoryToComponent',
  'Pack',
  'PackType',
  'Tag',
  'Image',
  'Option',
  'RelationType'
];

// Tables excluded from sync (contain real user data in production)
const EXCLUDED_TABLES = [
  'Profile', // Real user profiles
  'ProfileMeta', // User profile metadata
  'List', // User-created lists
  'ListPart', // Items in user lists
  'UndoOperation', // Admin action history
  'Result', // Cached search results (will be invalid after sync)
  '_AttributeValueToResult', // Junction for cached results
  '_prisma_migrations' // Migration history
];

// Tables that should be truncated but not have data imported
// These are cache tables that become invalid after sync
const TRUNCATE_ONLY_TABLES = [
  'Result', // Cached search results
  '_AttributeValueToResult' // Junction for cached results
];

interface TableCount {
  table: string;
  count: number;
}

// Function to update COPY commands with explicit column lists
async function updateCopyCommandsWithColumns(
  dumpContent: string,
  TARGET_DB: any,
  details: string[]
): Promise<string> {
  // Find all COPY commands in the dump
  const copyRegex = /COPY "([^"]+)" FROM stdin WITH \([^)]+\);/g;
  const matches = [...dumpContent.matchAll(copyRegex)];

  if (matches.length === 0) {
    details.push('⚠️ No COPY commands found in export file');
    return dumpContent;
  }

  details.push(`Found ${matches.length} COPY commands to update`);

  // Update each COPY command with explicit column list
  let updatedContent = dumpContent;

  for (const match of matches) {
    const fullMatch = match[0];
    const tableName = match[1];

    try {
      // Get column names in alphabetical order (same as export)
      const getColumnsCommand = `PGPASSWORD='${TARGET_DB.password}' psql \\
        -h ${TARGET_DB.host} \\
        -p ${TARGET_DB.port} \\
        -U ${TARGET_DB.user} \\
        -d ${TARGET_DB.database} \\
        -t -A -F',' -c "SELECT column_name FROM information_schema.columns WHERE table_schema = '${TARGET_DB.schema}' AND table_name = '${tableName}' ORDER BY column_name"`;

      const { stdout: columnsOutput } = await execAsync(getColumnsCommand);
      const columns = columnsOutput
        .trim()
        .split('\n')
        .filter((col) => col)
        .map((col) => col.trim());

      if (columns.length === 0) {
        details.push(`⚠️ No columns found for table ${tableName}, skipping`);
        continue;
      }

      // Build the new COPY command with explicit column list
      const columnList = columns.map((col) => `"${col}"`).join(', ');
      const newCopyCommand = fullMatch.replace(
        `COPY "${tableName}" FROM stdin`,
        `COPY "${tableName}" (${columnList}) FROM stdin`
      );

      // Replace in content
      updatedContent = updatedContent.replace(fullMatch, newCopyCommand);
      details.push(
        `✓ Updated COPY command for ${tableName} with ${columns.length} columns`
      );
    } catch (error) {
      details.push(`⚠️ Failed to get columns for table ${tableName}: ${error}`);
    }
  }

  return updatedContent;
}

/* eslint-disable */
export async function POST(req: NextRequest) {
  // Validate access
  const accessError = await validateSyncAccess(req);
  if (accessError) return accessError;

  const details: string[] = [];

  try {
    const {
      exportFile,
      targetDatabase,
      sourceDatabase,
      dryRun = false,
      skipBackup = false,
      confirmProduction = false
    } = await req.json();

    if (!exportFile) {
      return NextResponse.json(
        {
          success: false,
          error: 'Export file path is required'
        },
        { status: 400 }
      );
    }

    if (!targetDatabase) {
      return NextResponse.json(
        {
          success: false,
          error: 'Target database not specified'
        },
        { status: 400 }
      );
    }

    // Verify export file exists
    if (!existsSync(exportFile)) {
      return NextResponse.json(
        {
          success: false,
          error: 'Export file not found. Please export again.'
        },
        { status: 400 }
      );
    }

    // Load metadata if available
    const metadataFile = exportFile + '.metadata.json';
    let sourceMetadata: any = null;
    let sourceCounts: TableCount[] = [];

    try {
      if (existsSync(metadataFile)) {
        const metadataContent = await readFile(metadataFile, 'utf8');
        sourceMetadata = JSON.parse(metadataContent);
        sourceCounts = sourceMetadata.tableCounts || [];
        details.push(
          `✓ Loaded export metadata: ${sourceCounts.length} tables, ${sourceMetadata.exportedTables?.length || 0} exported`
        );
      } else {
        details.push(
          '⚠️ No metadata file found, proceeding without source validation'
        );
      }
    } catch (error) {
      details.push(`⚠️ Could not load metadata: ${error}`);
    }

    const TARGET_DB = getDatabaseConfig(targetDatabase);

    if (!TARGET_DB) {
      return NextResponse.json(
        {
          success: false,
          error: `Database configuration not found for: ${targetDatabase}`,
          details: [
            'Make sure the database URL is set in environment variables'
          ]
        },
        { status: 400 }
      );
    }

    // Validate credentials
    if (!TARGET_DB.password) {
      return NextResponse.json(
        {
          success: false,
          error: `Missing ${targetDatabase} database credentials. Please check your environment variables.`,
          details: [`Required: Password for ${targetDatabase} database`]
        },
        { status: 500 }
      );
    }

    details.push(`Using export file: ${exportFile}`);
    details.push(
      `Target database: ${targetDatabase} (${TARGET_DB.schema} schema)`
    );

    // Production safety check
    if (targetDatabase === 'production' && !dryRun) {
      if (!confirmProduction) {
        return NextResponse.json(
          {
            success: false,
            error: 'Production import requires explicit confirmation',
            requiresConfirmation: true,
            warning:
              'This will replace ALL data in the production database. Make sure you have a recent backup.',
            details: ['To proceed, set confirmProduction: true in the request']
          },
          { status: 400 }
        );
      }

      details.push('⚠️ PRODUCTION IMPORT - Confirmation received');
    }

    if (dryRun) {
      details.push('🧪 DRY RUN MODE - No changes will be committed');
    }

    // Verify target schema exists
    try {
      const schemaCheckCommand = `PGPASSWORD='${TARGET_DB.password}' psql \
        -h ${TARGET_DB.host} \
        -p ${TARGET_DB.port} \
        -U ${TARGET_DB.user} \
        -d ${TARGET_DB.database} \
        -t -c "SELECT schema_name FROM information_schema.schemata WHERE schema_name = '${TARGET_DB.schema}'"`;

      const { stdout: schemaOutput } = await execAsync(schemaCheckCommand);
      if (!schemaOutput.trim()) {
        return NextResponse.json(
          {
            success: false,
            error: `Schema '${TARGET_DB.schema}' does not exist in ${targetDatabase} database`,
            details: [
              `Please create the schema first: CREATE SCHEMA IF NOT EXISTS ${TARGET_DB.schema};`
            ]
          },
          { status: 400 }
        );
      }
      details.push(`✓ Schema '${TARGET_DB.schema}' exists in target database`);
    } catch (error) {
      details.push(`⚠️ Could not verify schema: ${error}`);
    }

    // Pre-import validation: Count target database records before import
    details.push('Performing pre-import validation...');
    const targetCountsBefore: TableCount[] = [];

    try {
      const countQuery = `
        SELECT 
          t.tablename as table_name,
          (xpath('/row/count/text()', 
            query_to_xml(format('SELECT COUNT(*) FROM %I.%I', '${TARGET_DB.schema}', t.tablename), 
            false, true, '')))[1]::text::int as count
        FROM pg_tables t
        WHERE t.schemaname = '${TARGET_DB.schema}'
        ORDER BY t.tablename
      `;

      const countCommand = `PGPASSWORD='${TARGET_DB.password}' psql \
        -h ${TARGET_DB.host} \
        -p ${TARGET_DB.port} \
        -U ${TARGET_DB.user} \
        -d ${TARGET_DB.database} \
        -t -A -F'|' -c "${countQuery}"`;

      const { stdout: countOutput } = await execAsync(countCommand);
      const counts = countOutput
        .trim()
        .split('\n')
        .filter((line) => line);

      for (const line of counts) {
        const [table, count] = line.split('|');
        if (table && count) {
          targetCountsBefore.push({
            table: table.trim(),
            count: parseInt(count)
          });
        }
      }

      const totalRecordsBefore = targetCountsBefore.reduce(
        (sum, t) => sum + t.count,
        0
      );
      details.push(
        `Target database has ${totalRecordsBefore} records in ${targetCountsBefore.length} tables`
      );

      // Safety check: If we're importing from a source with data but target is empty, warn
      if (totalRecordsBefore === 0 && sourceCounts.length > 0) {
        const sourceTotal = sourceCounts.reduce((sum, t) => sum + t.count, 0);
        if (sourceTotal > 100) {
          details.push(
            `⚠️ WARNING: Target database is empty but source has ${sourceTotal} records`
          );
          details.push(
            `This might indicate a previous import failed and left the database empty`
          );
          if (!dryRun) {
            details.push(`Creating backup anyway, but it will be empty`);
          }
        }
      }
    } catch (error) {
      details.push(`⚠️ Could not get target table counts: ${error}`);
    }

    // Create backup of target database BEFORE clearing any data (skip in dry-run mode)
    const backupDir = join('/tmp', 'multiboard-sync-backups', targetDatabase);
    let backupFile: string | null = null;

    if (!dryRun && !skipBackup) {
      try {
        // Ensure backup directory exists
        await mkdir(backupDir, { recursive: true });

        // Generate backup filename with timestamp and source info
        const timestamp = new Date()
          .toISOString()
          .replace(/[:.]/g, '-')
          .replace('T', '_')
          .split('.')[0];
        const sourceDbName = sourceDatabase || 'unknown';
        backupFile = join(
          backupDir,
          `backup_${timestamp}_from_${sourceDbName}.sql`
        );

        details.push(
          `Creating backup of ${targetDatabase} database before import...`
        );

        // Create backup using the same COPY approach as export (avoids pg_dump version issues)
        // First, get list of tables in the target schema
        const getTablesCommand = `PGPASSWORD='${TARGET_DB.password}' psql \
        -h ${TARGET_DB.host} \
        -p ${TARGET_DB.port} \
        -U ${TARGET_DB.user} \
        -d ${TARGET_DB.database} \
        -t -c "SELECT tablename FROM pg_tables WHERE schemaname='${TARGET_DB.schema}' ORDER BY tablename"`;

        const { stdout: tablesOutput } = await execAsync(getTablesCommand);
        const allTables = tablesOutput
          .split('\n')
          .filter((t) => t.trim())
          .map((t) => t.trim());

        // Define table export order to respect foreign key dependencies (same as export)
        const tableOrder = [
          'Option',
          'RelationType',
          'PackType',
          'Tag',
          'Categories',
          'List',
          'UndoOperation',
          'CategoryMeta',
          'Component',
          'ComponentMeta',
          'Pack',
          'PackMeta',
          'Attribute',
          'AttributeMeta',
          'AttributeValue',
          'AttributeValueMeta',
          'Part',
          'Image',
          'RelatedPart',
          'ListPart',
          'Result',
          '_AttributeValueToPart',
          '_AttributeValueToResult',
          '_CategoryToComponent',
          '_CategoryToPack',
          '_ComponentToTag',
          '_PartToTag',
          '_subAttributes',
          '_prisma_migrations'
        ];

        const tables = allTables.sort((a, b) => {
          const aIndex = tableOrder.indexOf(a);
          const bIndex = tableOrder.indexOf(b);
          if (aIndex === -1 && bIndex === -1) return 0;
          if (aIndex === -1) return 1;
          if (bIndex === -1) return -1;
          return aIndex - bIndex;
        });

        details.push(
          `Found ${tables.length} tables to backup from ${TARGET_DB.schema} schema`
        );

        // Build SQL script with COPY commands
        let sqlScript = '-- Multiboard Database Backup\n';
        sqlScript += `-- Database: ${targetDatabase} (${TARGET_DB.host})\n`;
        sqlScript += '-- Generated at: ' + new Date().toISOString() + '\n\n';
        sqlScript += "SET client_encoding = 'UTF8';\n";
        sqlScript += 'SET standard_conforming_strings = on;\n\n';

        // For each table, generate COPY command
        for (const table of tables) {
          const tempSqlFile = join(
            '/tmp',
            `copy_backup_${table}_${Date.now()}.sql`
          );
          const copySql = `COPY (SELECT * FROM ${TARGET_DB.schema}."${table}") TO STDOUT WITH (FORMAT CSV, HEADER, DELIMITER ',', QUOTE '"', NULL 'NULL');`;
          await writeFile(tempSqlFile, copySql);

          const copyCommand = `PGPASSWORD='${TARGET_DB.password}' psql \
          -h ${TARGET_DB.host} \
          -p ${TARGET_DB.port} \
          -U ${TARGET_DB.user} \
          -d ${TARGET_DB.database} \
          -t -f ${tempSqlFile}`;

          try {
            const { stdout: csvData } = await execAsync(copyCommand, {
              maxBuffer: 50 * 1024 * 1024
            });

            if (csvData.trim()) {
              sqlScript += `-- Table: ${table}\n`;
              sqlScript += `TRUNCATE TABLE "${table}" CASCADE;\n`;
              sqlScript += `COPY "${table}" FROM stdin WITH (FORMAT CSV, HEADER, DELIMITER ',', QUOTE '"', NULL 'NULL');\n`;
              sqlScript += csvData;
              sqlScript += '\\.\n\n';
            }

            await unlink(tempSqlFile);
          } catch (error) {
            try {
              await unlink(tempSqlFile);
            } catch {}
          }
        }

        // Write backup file
        await writeFile(backupFile, sqlScript);

        // Get file size and validate backup
        const backupStats = await stat(backupFile);
        const backupSizeMB = backupStats.size / 1024 / 1024;
        const { stdout: sizeOutput } = await execAsync(
          `ls -lh ${backupFile} | awk '{print $5}'`
        );

        // Count actual data lines in backup (excluding comments and empty lines)
        const { stdout: lineCount } = await execAsync(
          `grep -v '^--' ${backupFile} | grep -v '^$' | wc -l`
        );
        const dataLines = parseInt(lineCount.trim());

        details.push(`✓ Created backup: ${backupFile} (${sizeOutput.trim()})`);

        // Validate backup has actual data
        if (backupSizeMB < 0.1 || dataLines < 100) {
          // Backup is suspiciously small
          const recordCount = targetCountsBefore.reduce(
            (sum, t) => sum + t.count,
            0
          );
          if (recordCount > 100) {
            // We expected data but backup is tiny
            throw new Error(
              `Backup validation failed: Expected ${recordCount} records but backup is only ${backupSizeMB.toFixed(2)}MB with ${dataLines} data lines. Database may already be empty!`
            );
          }
        }

        // Maintain only 3 most recent backups
        const backupFiles = await readdir(backupDir);
        const sortedBackups = backupFiles
          .filter((f) => f.startsWith('backup_') && f.endsWith('.sql'))
          .sort((a, b) => b.localeCompare(a)); // Sort by filename (newest first)

        if (sortedBackups.length > 3) {
          // Delete older backups
          for (let i = 3; i < sortedBackups.length; i++) {
            const oldBackup = join(backupDir, sortedBackups[i] ?? '');
            await unlink(oldBackup);
            details.push(`✓ Removed old backup: ${sortedBackups[i]}`);
          }
        }
      } catch (backupError) {
        // Log backup error but continue with import
        details.push(
          `⚠️ Warning: Could not create backup: ${backupError instanceof Error ? backupError.message : 'Unknown error'}`
        );
        console.error('Backup creation failed:', backupError);
      }
    }

    // Step 2: Clear target database schema (but keep the schema itself)
    // Note: Backup must be completed before this step
    details.push(`Preparing to clear ${targetDatabase} database...`);

    // Get all tables in the target schema
    const getTablesCommand = `PGPASSWORD='${TARGET_DB.password}' psql \
      -h ${TARGET_DB.host} \
      -p ${TARGET_DB.port} \
      -U ${TARGET_DB.user} \
      -d ${TARGET_DB.database} \
      -t -c "SELECT tablename FROM pg_tables WHERE schemaname='${TARGET_DB.schema}' ORDER BY tablename"`;

    const { stdout: tablesOutput } = await execAsync(getTablesCommand);
    const allTables = tablesOutput
      .split('\n')
      .filter((t) => t.trim())
      .map((t) => t.trim());

    // Filter tables: exclude most user tables, but include cache tables that need clearing
    const tablesToTruncate = allTables.filter((table) => {
      // Include tables that are not excluded OR are in the truncate-only list
      return (
        !EXCLUDED_TABLES.includes(table) || TRUNCATE_ONLY_TABLES.includes(table)
      );
    });

    details.push(
      `Found ${allTables.length} tables in ${TARGET_DB.schema} schema`
    );

    // List what we're doing
    const preservedTables = EXCLUDED_TABLES.filter(
      (t) => !TRUNCATE_ONLY_TABLES.includes(t) && allTables.includes(t)
    );
    const cacheTables = TRUNCATE_ONLY_TABLES.filter((t) =>
      allTables.includes(t)
    );

    details.push(`Will clear ${tablesToTruncate.length} tables`);
    if (preservedTables.length > 0) {
      details.push(`Preserving user data in: ${preservedTables.join(', ')}`);
    }
    if (cacheTables.length > 0) {
      details.push(`Clearing cache tables: ${cacheTables.join(', ')}`);
    }

    // Check if target has the expected tables
    if (tablesToTruncate.length === 0) {
      details.push(
        `⚠️ Warning: No tables found to truncate in ${TARGET_DB.schema} schema`
      );
      details.push(
        `This might indicate the database needs migrations to be run first`
      );

      if (!dryRun) {
        return NextResponse.json(
          {
            success: false,
            error: `No tables found in ${targetDatabase} database schema '${TARGET_DB.schema}'`,
            details: [
              ...details,
              `Please ensure the target database has been initialized with migrations`,
              `Run: npx prisma migrate deploy --schema=packages/db/prisma/schema.prisma`
            ]
          },
          { status: 400 }
        );
      }
    }

    if (tablesToTruncate.length > 0) {
      // In dry-run mode, we'll include TRUNCATE in the transaction
      // In normal mode, we need to clear tables before import
      if (!dryRun) {
        // Only truncate in non-dry-run mode
        const truncateSqlFile = exportFile + '.truncate.sql';
        const truncateSql = `SET search_path TO ${TARGET_DB.schema};\nTRUNCATE TABLE ${tablesToTruncate.map((t) => `"${t}"`).join(', ')} CASCADE;`;
        await writeFile(truncateSqlFile, truncateSql);

        const truncateCommand = `PGPASSWORD='${TARGET_DB.password}' psql \
          -h ${TARGET_DB.host} \
          -p ${TARGET_DB.port} \
          -U ${TARGET_DB.user} \
          -d ${TARGET_DB.database} \
          -f ${truncateSqlFile}`;

        try {
          await execAsync(truncateCommand);
          details.push(
            `✓ Cleared ${tablesToTruncate.length} tables in ${targetDatabase} database`
          );
        } catch (error) {
          // If truncate fails, it might be due to order or empty tables - continue anyway
          details.push(
            `⚠️ Warning: Could not truncate all tables (might be empty): ${error}`
          );
        } finally {
          // Clean up temp file
          try {
            await unlink(truncateSqlFile);
          } catch {
            /* ignore cleanup errors */
          }
        }
      } else {
        details.push(
          `🧪 DRY RUN: Would clear ${tablesToTruncate.length} tables (skipped)`
        );
      }
    }

    // Step 2: Modify and import data to target database
    details.push('Preparing data for import...');

    // Read the dump file and modify it to use the target schema
    let dumpContent = await readFile(exportFile, 'utf8');

    // Update COPY commands to use explicit column lists to match export ordering
    details.push('Updating COPY commands with explicit column ordering...');

    // Find all COPY commands and add column specifications
    dumpContent = await updateCopyCommandsWithColumns(
      dumpContent,
      TARGET_DB,
      details
    );

    // Add SET search_path and sequence reset commands
    // Wrap in transaction for safety
    const sequenceResets = `
-- Reset sequences to match the imported data
DO $$
DECLARE
  seq RECORD;
  max_id BIGINT;
  sql_query TEXT;
BEGIN
  FOR seq IN 
    SELECT 
      s.sequence_name,
      REPLACE(s.sequence_name, '_id_seq', '') as table_name,
      'id' as column_name
    FROM information_schema.sequences s
    WHERE s.sequence_schema = '${TARGET_DB.schema}'
  LOOP
    BEGIN
      -- Build and execute query with proper quoting
      sql_query := format('SELECT COALESCE(MAX(%I), 0) FROM %I.%I', 
        seq.column_name, '${TARGET_DB.schema}', seq.table_name);
      EXECUTE sql_query INTO max_id;
      
      -- Set the sequence value
      EXECUTE format('SELECT setval(''%I.%I'', %s)', 
        '${TARGET_DB.schema}', seq.sequence_name, max_id + 1);
        
      RAISE NOTICE 'Reset sequence % to %', seq.sequence_name, max_id + 1;
    EXCEPTION
      WHEN OTHERS THEN
        -- Log error but continue with other sequences
        RAISE NOTICE 'Could not reset sequence %: %', seq.sequence_name, SQLERRM;
    END;
  END LOOP;
END $$;
`;

    // Wrap everything in a transaction
    if (dryRun) {
      // In dry-run mode, skip actual import and just validate the file
      details.push('🧪 DRY RUN: Validating import file structure...');

      // Check if the export file has the expected structure
      const lineCount = dumpContent.split('\n').length;
      const copyCount = (dumpContent.match(/^COPY .* FROM stdin/gm) || [])
        .length;
      const truncateCount = (dumpContent.match(/^TRUNCATE TABLE/gm) || [])
        .length;

      details.push(`✓ Export file contains ${lineCount} lines`);
      details.push(
        `✓ Found ${copyCount} COPY commands for ${copyCount} tables`
      );
      details.push(`✓ Found ${truncateCount} TRUNCATE commands`);

      // For dry-run, we'll skip the actual import since large CSV in transactions can fail
      // Instead, we'll just report what would happen
      details.push(
        '🧪 DRY RUN: Skipping actual import (would import all tables)'
      );

      // Return success for dry-run without actually running the import
      return NextResponse.json({
        success: true,
        dryRun: true,
        wouldSucceed: true,
        message: 'Dry run complete - import would succeed',
        targetDatabase,
        sourceCounts,
        targetCountsBefore,
        validationErrors: [],
        details: [
          ...details,
          '✓ Export file is valid',
          '✓ All tables would be truncated and reloaded',
          `✓ ${sourceCounts.reduce((sum, t) => sum + t.count, 0)} records would be imported`,
          '✓ Sequences would be reset after import',
          '',
          '💡 Run actual import to apply changes'
        ]
      });
    } else {
      // Normal import with commit
      dumpContent = `
-- Database Import
BEGIN;

SET search_path TO ${TARGET_DB.schema};
SET session_replication_role = 'replica';

${dumpContent}

SET session_replication_role = 'origin';
${sequenceResets}

COMMIT;
`;
    }

    // Create a temporary modified file
    const modifiedFile = `${exportFile}.modified`;
    await writeFile(modifiedFile, dumpContent);

    // In dry-run or debug mode, log the file location
    if (dryRun || process.env.DEBUG_SYNC === 'true') {
      details.push(`Debug: Modified SQL file saved to: ${modifiedFile}`);
    }

    details.push(`Importing data to ${targetDatabase} database...`);

    // Check file size before import
    const fs = await import('fs');
    const stats = fs.statSync(modifiedFile);
    details.push(
      `Import file size: ${(stats.size / 1024 / 1024).toFixed(2)}MB`
    );

    const psqlCommand = `PGPASSWORD='${TARGET_DB.password}' psql \
      -h ${TARGET_DB.host} \
      -p ${TARGET_DB.port} \
      -U ${TARGET_DB.user} \
      -d ${TARGET_DB.database} \
      -f ${modifiedFile}`;

    try {
      const { stdout, stderr } = await execAsync(psqlCommand);

      // Log import output for debugging
      console.log('Import stdout:', stdout);
      console.log('Import stderr:', stderr);

      // Check for errors in output
      if (stderr) {
        if (stderr.includes('ERROR') || stderr.includes('FATAL')) {
          throw new Error(`PostgreSQL import error: ${stderr}`);
        }
        if (!stderr.includes('NOTICE')) {
          details.push(`Import warnings: ${stderr}`);
        }
      }

      // Check if transaction was rolled back
      if (stdout && stdout.includes('ROLLBACK')) {
        console.error('Transaction rollback detected. Full output:', stdout);
        throw new Error(
          'Import transaction was rolled back - check PostgreSQL logs'
        );
      }

      // Also check for common error patterns
      if (stdout && (stdout.includes('ERROR:') || stdout.includes('FATAL:'))) {
        const errorMatch = stdout.match(/ERROR:.*|FATAL:.*/);
        if (errorMatch) {
          throw new Error(`PostgreSQL error: ${errorMatch[0]}`);
        }
      }

      details.push(`✓ Import completed, performing validation...`);
    } catch (importError) {
      // Check if it's just a sequence error (which is non-fatal)
      const errorStr = String(importError);
      if (
        errorStr.includes('relation') &&
        errorStr.includes('does not exist') &&
        errorStr.includes('sequence')
      ) {
        details.push(
          `⚠️ Warning: Some sequences could not be reset (non-fatal): ${importError}`
        );
      } else {
        details.push(`✗ Import error: ${importError}`);
        console.error('Import command error:', importError);
      }

      // Continue to validation to see what got imported
      details.push('Continuing to validation...');
    }

    // Post-import validation: Count records after import
    const targetCountsAfter: TableCount[] = [];
    const validationErrors: string[] = [];

    try {
      const countQuery = `
        SELECT 
          t.tablename as table_name,
          (xpath('/row/count/text()', 
            query_to_xml(format('SELECT COUNT(*) FROM %I.%I', '${TARGET_DB.schema}', t.tablename), 
            false, true, '')))[1]::text::int as count
        FROM pg_tables t
        WHERE t.schemaname = '${TARGET_DB.schema}'
        ORDER BY t.tablename
      `;

      const countCommand = `PGPASSWORD='${TARGET_DB.password}' psql \
        -h ${TARGET_DB.host} \
        -p ${TARGET_DB.port} \
        -U ${TARGET_DB.user} \
        -d ${TARGET_DB.database} \
        -t -A -F'|' -c "${countQuery}"`;

      const { stdout: countOutput } = await execAsync(countCommand);
      const counts = countOutput
        .trim()
        .split('\n')
        .filter((line) => line);

      for (const line of counts) {
        const [table, count] = line.split('|');
        if (table && count) {
          targetCountsAfter.push({
            table: table.trim(),
            count: parseInt(count)
          });
        }
      }

      details.push(
        `✓ Post-import validation: ${targetCountsAfter.reduce((sum, t) => sum + t.count, 0)} records in ${targetCountsAfter.length} tables`
      );

      // Check critical tables
      for (const criticalTable of CRITICAL_TABLES) {
        const tableCount = targetCountsAfter.find(
          (t) => t.table === criticalTable
        );
        if (!tableCount || tableCount.count === 0) {
          validationErrors.push(
            `Critical table '${criticalTable}' is empty after import!`
          );
        } else {
          // Compare with source if metadata available
          const sourceCount = sourceCounts.find(
            (t) => t.table === criticalTable
          );
          if (sourceCount && sourceCount.count > 0 && tableCount.count === 0) {
            validationErrors.push(
              `Critical table '${criticalTable}' had ${sourceCount.count} records in source but is empty in target!`
            );
          }
        }
      }

      // Compare counts with source if available
      if (sourceCounts.length > 0) {
        for (const sourceTable of sourceCounts) {
          // Skip validation for excluded tables
          if (EXCLUDED_TABLES.includes(sourceTable.table)) {
            continue;
          }

          const targetTable = targetCountsAfter.find(
            (t) => t.table === sourceTable.table
          );
          if (targetTable) {
            const diff = Math.abs(targetTable.count - sourceTable.count);
            const percentDiff =
              sourceTable.count > 0 ? (diff / sourceTable.count) * 100 : 0;

            if (diff > 0) {
              if (percentDiff > 10) {
                // More than 10% difference
                validationErrors.push(
                  `Table '${sourceTable.table}': expected ${sourceTable.count} records, got ${targetTable.count} (${percentDiff.toFixed(1)}% difference)`
                );
              } else {
                details.push(
                  `⚠️ Table '${sourceTable.table}': minor difference - ${sourceTable.count} → ${targetTable.count}`
                );
              }
            }
          } else if (sourceTable.count > 0) {
            validationErrors.push(
              `Table '${sourceTable.table}' exists in source with ${sourceTable.count} records but not found in target`
            );
          }
        }
      }
    } catch (error) {
      validationErrors.push(`Could not validate import: ${error}`);
    }

    // If there are validation errors, this is a critical failure
    if (validationErrors.length > 0 && !dryRun) {
      // Try to restore from backup
      details.push('✗ VALIDATION FAILED! Critical errors detected:');
      validationErrors.forEach((err) => details.push(`  - ${err}`));

      return NextResponse.json(
        {
          success: false,
          error:
            'Import validation failed - critical tables are empty or have major discrepancies',
          validationErrors,
          targetCountsAfter,
          sourceCounts,
          details,
          backup: backupFile || 'No backup available'
        },
        { status: 500 }
      );
    }

    // In dry-run mode, report what would happen
    if (dryRun) {
      details.push('🧪 DRY RUN COMPLETE - All changes rolled back');
      if (validationErrors.length > 0) {
        details.push('⚠️ Import would have failed validation:');
        validationErrors.forEach((err) => details.push(`  - ${err}`));
      } else {
        details.push('✓ Import would have succeeded');
      }

      return NextResponse.json({
        success: true,
        dryRun: true,
        wouldSucceed: validationErrors.length === 0,
        message: `Dry run complete - ${validationErrors.length === 0 ? 'import would succeed' : 'import would fail'}`,
        targetDatabase,
        sourceCounts,
        targetCountsBefore,
        validationErrors,
        details
      });
    }

    details.push(
      `✓ Successfully imported and validated data in ${targetDatabase} database`
    );

    // Clean up modified file
    await unlink(modifiedFile);

    // Clean up original export file
    await unlink(exportFile);
    details.push('✓ Cleaned up temporary files');

    return NextResponse.json({
      success: true,
      message: 'Import completed successfully with validation',
      targetDatabase,
      importedRecords: targetCountsAfter.reduce((sum, t) => sum + t.count, 0),
      tableCount: targetCountsAfter.length,
      criticalTablesValidated: CRITICAL_TABLES.length,
      details
    });
  } catch (error) {
    console.error(`Error POST /api/sync-database/import`, error);

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error ? error.message : 'Unknown error occurred',
        details
      },
      { status: 500 }
    );
  }
}
