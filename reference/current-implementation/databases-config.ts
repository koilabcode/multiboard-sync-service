// Database configurations for sync tool
// This keeps sync database configs separate from the main DATABASE_URL

export interface DatabaseConfig {
  id: string;
  name: string;
  description: string;
  host: string;
  port: string;
  database: string;
  user: string;
  password: string;
  schema: string;
}

// Parse PostgreSQL connection string
function parseConnectionString(
  connectionString: string
): Partial<DatabaseConfig> {
  try {
    // Remove any pgbouncer params for parsing
    const cleanUrl = connectionString.split('?')[0];
    if (!cleanUrl) {
      return {};
    }
    const url = new URL(cleanUrl);

    // Extract schema from query params if present
    const params = new URLSearchParams(connectionString.split('?')[1] || '');
    const schema = params.get('schema') || 'public';

    return {
      host: url.hostname,
      port: url.port || '5432',
      database: url.pathname.slice(1), // Remove leading slash
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      schema
    };
  } catch {
    return {};
  }
}

// Get database configurations
export function getDatabaseConfigs(): DatabaseConfig[] {
  const databases: DatabaseConfig[] = [];

  // Production Database
  if (process.env.PRODUCTION_DATABASE_URL) {
    const parsed = parseConnectionString(process.env.PRODUCTION_DATABASE_URL);
    databases.push({
      id: 'production',
      name: 'Production Database',
      description: 'Live production database (Supabase)',
      host: parsed.host || '',
      port: parsed.port || '5432',
      database: parsed.database || 'postgres',
      user: parsed.user || '',
      password: parsed.password || '',
      schema: parsed.schema || 'public'
    });
  }

  // Dev Database - Use the current DATABASE_URL if it's the dev one
  const currentDbUrl = process.env.DATABASE_URL || '';
  if (currentDbUrl.includes('mqqnlltbmvhqocnconda')) {
    const parsed = parseConnectionString(currentDbUrl);
    databases.push({
      id: 'dev',
      name: 'Dev Database',
      description: 'Development database (Supabase)',
      host: parsed.host || '',
      port: parsed.port || '5432',
      database: parsed.database || 'postgres',
      user: parsed.user || '',
      password: parsed.password || '',
      schema: parsed.schema || 'public'
    });
  } else if (process.env.DEV_DATABASE_URL) {
    const parsed = parseConnectionString(process.env.DEV_DATABASE_URL);
    databases.push({
      id: 'dev',
      name: 'Dev Database',
      description: 'Development database (Supabase)',
      host: parsed.host || '',
      port: parsed.port || '5432',
      database: parsed.database || 'postgres',
      user: parsed.user || '',
      password: parsed.password || '',
      schema: parsed.schema || 'public'
    });
  }

  // Staging Database
  if (process.env.STAGING_DATABASE_URL) {
    const parsed = parseConnectionString(process.env.STAGING_DATABASE_URL);
    databases.push({
      id: 'staging',
      name: 'Staging Database',
      description: 'Staging/testing database (Supabase)',
      host: parsed.host || '',
      port: parsed.port || '5432',
      database: parsed.database || 'postgres',
      user: parsed.user || '',
      password: parsed.password || '',
      schema: parsed.schema || 'public'
    });
  }

  // Local Database - Check if current DATABASE_URL is local
  if (currentDbUrl.includes('localhost')) {
    const parsed = parseConnectionString(currentDbUrl);
    databases.push({
      id: 'local',
      name: 'Local Database',
      description: 'Local development database',
      host: parsed.host || 'localhost',
      port: parsed.port || '5432',
      database: parsed.database || 'postgres',
      user: parsed.user || 'postgres',
      password: parsed.password || '',
      schema: parsed.schema || 'multiboard'
    });
  } else if (process.env.LOCAL_DATABASE_URL) {
    const parsed = parseConnectionString(process.env.LOCAL_DATABASE_URL);
    databases.push({
      id: 'local',
      name: 'Local Database',
      description: 'Local development database',
      host: parsed.host || 'localhost',
      port: parsed.port || '5432',
      database: parsed.database || 'postgres',
      user: parsed.user || 'postgres',
      password: parsed.password || '',
      schema: parsed.schema || 'multiboard'
    });
  }

  // Fallback: Add known databases with connection strings
  if (databases.length === 0) {
    // Add default configurations if no env vars are set
    console.warn('No database configurations found in environment variables');
  }

  return databases;
}

// Get a specific database config
export function getDatabaseConfig(databaseId: string): DatabaseConfig | null {
  const configs = getDatabaseConfigs();
  return configs.find((db) => db.id === databaseId) || null;
}
