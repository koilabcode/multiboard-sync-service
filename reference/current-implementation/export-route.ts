import { NextRequest, NextResponse } from 'next/server';
import { exec } from 'child_process';
import { promisify } from 'util';
import { join } from 'path';
import { tmpdir } from 'os';
import { writeFile, unlink, stat, readFile } from 'fs/promises';
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

// Tables to exclude from sync (contain real user data in production)
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

interface TableCount {
  table: string;
  count: number;
}

/* eslint-disable */
export async function POST(req: NextRequest) {
  // Validate access
  const accessError = await validateSyncAccess(req);
  if (accessError) return accessError;

  const details: string[] = [];
  const timestamp = Date.now();
  const exportFile = join(tmpdir(), `multiboard_export_${timestamp}.sql`);

  try {
    const { sourceDatabase } = await req.json();

    if (!sourceDatabase) {
      return NextResponse.json(
        {
          success: false,
          error: 'Source database not specified'
        },
        { status: 400 }
      );
    }

    const SOURCE_DB = getDatabaseConfig(sourceDatabase);

    if (!SOURCE_DB) {
      return NextResponse.json(
        {
          success: false,
          error: `Database configuration not found for: ${sourceDatabase}`,
          details: [
            'Make sure the database URL is set in environment variables'
          ]
        },
        { status: 400 }
      );
    }

    // Validate credentials
    if (!SOURCE_DB.host || !SOURCE_DB.user || !SOURCE_DB.password) {
      return NextResponse.json(
        {
          success: false,
          error: `Missing ${sourceDatabase} database credentials. Please check your environment variables.`,
          details: [
            `Required environment variables for ${sourceDatabase}: host, user, password`
          ]
        },
        { status: 500 }
      );
    }

    details.push(
      `Starting database export from ${sourceDatabase} (${SOURCE_DB.schema} schema)...`
    );

    // Step 1: Pre-export validation - count records in all tables
    details.push('Performing pre-export validation...');
    const tableCounts: TableCount[] = [];

    try {
      // Get counts for all tables
      const countQuery = `
        SELECT 
          t.tablename as table_name,
          (xpath('/row/count/text()', 
            query_to_xml(format('SELECT COUNT(*) FROM %I.%I', '${SOURCE_DB.schema}', t.tablename), 
            false, true, '')))[1]::text::int as count
        FROM pg_tables t
        WHERE t.schemaname = '${SOURCE_DB.schema}'
        ORDER BY t.tablename
      `;

      const countCommand = `PGPASSWORD='${SOURCE_DB.password}' psql \
        -h ${SOURCE_DB.host} \
        -p ${SOURCE_DB.port} \
        -U ${SOURCE_DB.user} \
        -d ${SOURCE_DB.database} \
        -t -A -F'|' -c "${countQuery}"`;

      const { stdout: countOutput } = await execAsync(countCommand);
      const counts = countOutput
        .trim()
        .split('\n')
        .filter((line) => line);

      for (const line of counts) {
        const [table, count] = line.split('|');
        if (table && count) {
          tableCounts.push({ table: table.trim(), count: parseInt(count) });
        }
      }

      details.push(
        `Found ${tableCounts.length} tables with total ${tableCounts.reduce((sum, t) => sum + t.count, 0)} records`
      );

      // Check critical tables
      const criticalTablesEmpty = CRITICAL_TABLES.filter((table) => {
        const tableCount = tableCounts.find((t) => t.table === table);
        return !tableCount || tableCount.count === 0;
      });

      if (criticalTablesEmpty.length > 0) {
        return NextResponse.json(
          {
            success: false,
            error: `Critical tables are empty in source database: ${criticalTablesEmpty.join(', ')}`,
            details,
            tableCounts
          },
          { status: 400 }
        );
      }
    } catch (error) {
      details.push(`Warning: Could not get table counts: ${error}`);
    }

    // Alternative approach: Use COPY commands through psql
    // First, get list of tables in the specified schema
    const getTablesCommand = `PGPASSWORD='${SOURCE_DB.password}' psql \
      -h ${SOURCE_DB.host} \
      -p ${SOURCE_DB.port} \
      -U ${SOURCE_DB.user} \
      -d ${SOURCE_DB.database} \
      -t -c "SELECT tablename FROM pg_tables WHERE schemaname='${SOURCE_DB.schema}' ORDER BY tablename"`;

    const { stdout: tablesOutput } = await execAsync(getTablesCommand);
    const allTables = tablesOutput
      .split('\n')
      .filter((t) => t.trim())
      .map((t) => t.trim());

    // Define table export order to respect foreign key dependencies
    const tableOrder = [
      // Independent tables first
      'Option',
      'RelationType',
      'PackType',
      'Tag',
      'Categories',
      'List',
      'UndoOperation',
      // Then dependent tables
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
      // Junction tables last
      '_AttributeValueToPart',
      '_AttributeValueToResult',
      '_CategoryToComponent',
      '_CategoryToPack',
      '_ComponentToTag',
      '_PartToTag',
      '_subAttributes',
      '_prisma_migrations'
    ];

    // Filter out excluded tables
    const tablesToExport = allTables.filter(
      (table) => !EXCLUDED_TABLES.includes(table)
    );

    // Sort tables according to defined order, keeping any unlisted tables at the end
    const tables = tablesToExport.sort((a, b) => {
      const aIndex = tableOrder.indexOf(a);
      const bIndex = tableOrder.indexOf(b);
      if (aIndex === -1 && bIndex === -1) return 0;
      if (aIndex === -1) return 1;
      if (bIndex === -1) return -1;
      return aIndex - bIndex;
    });

    details.push(
      `Found ${allTables.length} tables in schema, exporting ${tables.length} tables (excluded: ${EXCLUDED_TABLES.filter((t) => allTables.includes(t)).join(', ')})`
    );

    // Build SQL script with COPY commands
    let sqlScript = '-- Multiboard Database Export\n';
    sqlScript += `-- Source: ${sourceDatabase} (${SOURCE_DB.host})\n`;
    sqlScript += '-- Generated at: ' + new Date().toISOString() + '\n\n';
    sqlScript += "SET client_encoding = 'UTF8';\n";
    sqlScript += 'SET standard_conforming_strings = on;\n\n';

    // Create metadata file to store counts
    const metadataFile = exportFile + '.metadata.json';
    const exportedTables: string[] = [];
    const failedTables: string[] = [];

    // For each table, generate COPY command
    for (const table of tables) {
      details.push(`Exporting table: ${table}`);

      // Get column names in consistent order (alphabetical) to avoid column mismatch between databases
      const getColumnsCommand = `PGPASSWORD='${SOURCE_DB.password}' psql \
        -h ${SOURCE_DB.host} \
        -p ${SOURCE_DB.port} \
        -U ${SOURCE_DB.user} \
        -d ${SOURCE_DB.database} \
        -t -A -F',' -c "SELECT column_name FROM information_schema.columns WHERE table_schema = '${SOURCE_DB.schema}' AND table_name = '${table}' ORDER BY column_name"`;

      const { stdout: columnsOutput } = await execAsync(getColumnsCommand);
      const columns = columnsOutput
        .trim()
        .split('\n')
        .filter((col) => col)
        .map((col) => col.trim());

      if (columns.length === 0) {
        failedTables.push(table);
        details.push(`✗ No columns found for table ${table}`);
        continue;
      }

      // Create a temporary CSV file for this table
      const tableCsvFile = join(tmpdir(), `${table}_${timestamp}.csv`);

      // Use \copy with explicit column list to ensure consistent ordering
      // We need to use a temporary SQL file to avoid shell escaping issues with quotes
      const tempSqlFile = join(tmpdir(), `export_${table}_${timestamp}.sql`);
      const columnList = columns.map((col) => `"${col}"`).join(', ');
      const copySql = `\\copy (SELECT ${columnList} FROM ${SOURCE_DB.schema}."${table}") TO '${tableCsvFile}' WITH (FORMAT CSV, HEADER, DELIMITER ',', QUOTE '"', NULL 'NULL')`;
      await writeFile(tempSqlFile, copySql);

      const copyCommand = `PGPASSWORD='${SOURCE_DB.password}' psql \
        -h ${SOURCE_DB.host} \
        -p ${SOURCE_DB.port} \
        -U ${SOURCE_DB.user} \
        -d ${SOURCE_DB.database} \
        -f ${tempSqlFile}`;

      try {
        const { stdout, stderr } = await execAsync(copyCommand);

        // Log any psql output for debugging
        if (stderr) {
          console.error(`psql stderr for table ${table}:`, stderr);
          if (stderr.includes('ERROR') || stderr.includes('FATAL')) {
            throw new Error(`PostgreSQL error: ${stderr}`);
          }
        }

        // Verify the file was created and has content
        const fileStats = await stat(tableCsvFile);
        if (fileStats.size <= 0) {
          throw new Error(`Export file for table ${table} is empty`);
        }

        // Read the CSV data
        const csvData = await readFile(tableCsvFile, 'utf8');

        if (csvData.trim()) {
          // Add to SQL script
          sqlScript += `-- Table: ${table}\n`;
          sqlScript += `TRUNCATE TABLE "${table}" CASCADE;\n`;
          sqlScript += `COPY "${table}" FROM stdin WITH (FORMAT CSV, HEADER, DELIMITER ',', QUOTE '"', NULL 'NULL');\n`;
          sqlScript += csvData;
          sqlScript += '\\.\n\n';

          exportedTables.push(table);

          // Count lines (rows) in CSV
          const lineCount = csvData.trim().split('\n').length - 1; // -1 for header
          details.push(
            `✓ Exported ${table}: ${lineCount} records (${(fileStats.size / 1024).toFixed(2)}KB)`
          );
        }

        // Clean up temp files
        await unlink(tableCsvFile);
        await unlink(tempSqlFile);
      } catch (error) {
        failedTables.push(table);

        // Get detailed error information
        let errorDetails = '';
        if (error instanceof Error) {
          errorDetails = error.message;
          // If it's an exec error, it might have stdout/stderr
          if ('stdout' in error) {
            errorDetails += `\nstdout: ${(error as any).stdout}`;
          }
          if ('stderr' in error) {
            errorDetails += `\nstderr: ${(error as any).stderr}`;
          }
          if ('code' in error) {
            errorDetails += `\nExit code: ${(error as any).code}`;
          }
        } else {
          errorDetails = String(error);
        }

        const errorMsg = `Failed to export table ${table}: ${errorDetails}`;
        details.push(`✗ ${errorMsg}`);
        console.error(`Export error for table ${table}:`, error);

        // Try to clean up temp files even on error
        try {
          await unlink(tableCsvFile);
        } catch {}
        try {
          await unlink(tempSqlFile);
        } catch {}

        // Check if this is a critical table
        if (CRITICAL_TABLES.includes(table)) {
          // Also try to read the SQL file to see what command failed
          let sqlCommand = 'Unknown';
          try {
            sqlCommand = await readFile(tempSqlFile, 'utf8');
          } catch {}

          return NextResponse.json(
            {
              success: false,
              error: `Failed to export critical table: ${table}`,
              errorDetails,
              failedCommand: sqlCommand,
              details,
              exportedTables,
              failedTables
            },
            { status: 500 }
          );
        }
      }
    }

    // Check if any tables failed
    if (failedTables.length > 0) {
      return NextResponse.json(
        {
          success: false,
          error: `Failed to export ${failedTables.length} tables`,
          details,
          exportedTables,
          failedTables
        },
        { status: 500 }
      );
    }

    // Write SQL script to file
    await writeFile(exportFile, sqlScript);
    details.push(
      `✓ Successfully exported ${exportedTables.length} tables from ${sourceDatabase} database (${SOURCE_DB.schema} schema)`
    );

    // Get file size
    const exportFileStats = await stat(exportFile);
    details.push(
      `✓ Export file size: ${(exportFileStats.size / 1024 / 1024).toFixed(2)}MB`
    );

    // Get schema information for all exported tables
    const tableSchemas: Record<string, any[]> = {};
    details.push('Collecting table schemas...');

    for (const table of exportedTables) {
      try {
        const schemaQuery = `
          SELECT 
            column_name,
            data_type,
            character_maximum_length,
            numeric_precision,
            numeric_scale,
            is_nullable,
            column_default,
            ordinal_position
          FROM information_schema.columns
          WHERE table_schema = '${SOURCE_DB.schema}'
          AND table_name = '${table}'
          ORDER BY ordinal_position
        `;

        const schemaCommand = `PGPASSWORD='${SOURCE_DB.password}' psql \
          -h ${SOURCE_DB.host} \
          -p ${SOURCE_DB.port} \
          -U ${SOURCE_DB.user} \
          -d ${SOURCE_DB.database} \
          -t -A -F'|' -c "${schemaQuery}"`;

        const { stdout: schemaOutput } = await execAsync(schemaCommand);
        const columns = schemaOutput
          .trim()
          .split('\n')
          .filter((c) => c);

        tableSchemas[table] = columns.map((col) => {
          const [
            column_name,
            data_type,
            char_max_length,
            numeric_precision,
            numeric_scale,
            is_nullable,
            column_default,
            ordinal_position
          ] = col.split('|');
          return {
            column_name,
            data_type,
            character_maximum_length: char_max_length,
            numeric_precision,
            numeric_scale,
            is_nullable,
            column_default,
            ordinal_position: parseInt(ordinal_position || '0')
          };
        });
      } catch (error) {
        console.error(`Failed to get schema for table ${table}:`, error);
        details.push(`⚠️ Could not get schema for table ${table}`);
      }
    }

    details.push(
      `✓ Collected schemas for ${Object.keys(tableSchemas).length} tables`
    );

    // Save metadata with table counts and schemas
    const metadata = {
      sourceDatabase,
      sourceSchema: SOURCE_DB.schema,
      exportDate: new Date().toISOString(),
      exportedTables,
      tableCounts,
      tableSchemas,
      exportFileSize: exportFileStats.size
    };
    await writeFile(metadataFile, JSON.stringify(metadata, null, 2));
    details.push(`✓ Saved export metadata with schemas`);

    // Final validation
    const missingCriticalTables = CRITICAL_TABLES.filter(
      (table) => !exportedTables.includes(table)
    );
    if (missingCriticalTables.length > 0) {
      return NextResponse.json(
        {
          success: false,
          error: `Critical tables missing from export: ${missingCriticalTables.join(', ')}`,
          details,
          exportedTables,
          failedTables
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Export completed successfully',
      exportFile,
      metadataFile,
      sourceDatabase,
      exportedTables: exportedTables.length,
      totalRecords: tableCounts.reduce((sum, t) => sum + t.count, 0),
      details
    });
  } catch (error) {
    console.error(`Error POST /api/sync-database/export`, error);

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
