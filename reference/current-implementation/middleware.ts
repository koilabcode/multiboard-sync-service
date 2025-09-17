import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
/* eslint-disable */
export async function validateSyncAccess(req: NextRequest) {
  // Check if user is authenticated
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Additional check: Only allow in production if a special env var is set
  if (
    process.env.NODE_ENV === 'production' &&
    !process.env.ENABLE_DATABASE_SYNC
  ) {
    return NextResponse.json(
      {
        error:
          'Database sync is disabled in production. Set ENABLE_DATABASE_SYNC=true to enable.'
      },
      { status: 403 }
    );
  }

  // Optional: Check for admin role or specific user
  // if (session.user?.email !== 'admin@example.com') {
  //   return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  // }

  return null; // Access granted
}
