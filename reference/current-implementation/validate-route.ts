import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { validateSyncAccess } from '../middleware';

// Critical tables that must have data
const CRITICAL_TABLES = [
  'Part',
  'Component',
  'Attribute',
  'AttributeValue',
  '_AttributeValueToPart',
  'Categories',
  '_CategoryToComponent'
];

export async function POST(req: NextRequest) {
  // Validate access
  const accessError = await validateSyncAccess(req);
  if (accessError) return accessError;

  try {
    const { exportFile } = await req.json();

    if (!exportFile) {
      return NextResponse.json(
        {
          success: false,
          error: 'Export file path is required'
        },
        { status: 400 }
      );
    }

    // Verify export file exists
    if (!existsSync(exportFile)) {
      return NextResponse.json(
        {
          success: false,
          error: 'Export file not found'
        },
        { status: 404 }
      );
    }

    // Load metadata
    const metadataFile = exportFile + '.metadata.json';
    let metadata: any = null;

    if (existsSync(metadataFile)) {
      const metadataContent = await readFile(metadataFile, 'utf8');
      metadata = JSON.parse(metadataContent);
    }

    // Read export file and analyze
    const exportContent = await readFile(exportFile, 'utf8');
    const lines = exportContent.split('\n');

    // Count COPY statements
    const copyStatements = lines.filter((line) =>
      line.trim().startsWith('COPY "')
    );
    const tableNames = copyStatements
      .map((line) => {
        const match = line.match(/COPY "([^"]+)"/);
        return match ? match[1] : null;
      })
      .filter(Boolean);

    // Check for critical tables
    const missingCriticalTables = CRITICAL_TABLES.filter(
      (table) => !tableNames.includes(table)
    );

    // Count data lines (between COPY and \.)
    const tableDataCounts: Record<string, number> = {};
    let currentTable: string | null = null;
    let dataLineCount = 0;

    for (const line of lines) {
      if (line.trim().startsWith('COPY "')) {
        const match = line.match(/COPY "([^"]+)"/);
        currentTable = match && match[1] ? match[1] : null;
        dataLineCount = 0;
      } else if (line.trim() === '\\.') {
        if (currentTable) {
          tableDataCounts[currentTable] = dataLineCount - 1; // -1 for header
        }
        currentTable = null;
      } else if (currentTable && line.trim()) {
        dataLineCount++;
      }
    }

    // Check for empty critical tables
    const emptyCriticalTables = CRITICAL_TABLES.filter(
      (table) =>
        tableDataCounts[table] === 0 || tableDataCounts[table] === undefined
    );

    const validation = {
      valid:
        missingCriticalTables.length === 0 && emptyCriticalTables.length === 0,
      exportFile,
      exportFileSize: exportContent.length,
      tablesFound: tableNames.length,
      criticalTablesPresent: CRITICAL_TABLES.filter((t) =>
        tableNames.includes(t)
      ).length,
      missingCriticalTables,
      emptyCriticalTables,
      tableDataCounts,
      metadata
    };

    return NextResponse.json({
      success: true,
      validation
    });
  } catch (error) {
    console.error('Error validating export:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Validation failed'
      },
      { status: 500 }
    );
  }
}
