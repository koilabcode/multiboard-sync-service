import { NextRequest, NextResponse } from 'next/server';
import { validateSyncAccess } from '../middleware';
import { getDatabaseConfigs } from '@/lib/config/databases';

export async function GET(req: NextRequest) {
  // Validate access
  const accessError = await validateSyncAccess(req);
  if (accessError) return accessError;

  try {
    const databases = getDatabaseConfigs();

    // Don't send passwords to frontend
    const safeDatabases = databases.map((db) => ({
      id: db.id,
      name: db.name,
      description: db.description,
      host: db.host,
      database: db.database,
      user: db.user, // Include user for confirmation
      available: !!(db.host && db.user && db.password)
    }));

    return NextResponse.json({
      databases: safeDatabases
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Failed to get database configurations',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
