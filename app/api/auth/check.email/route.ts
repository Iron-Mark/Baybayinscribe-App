import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/db/drizzle';
import { requireApiAccess } from '@/lib/auth/api-access';

export async function GET(request: NextRequest) {
  const access = await requireApiAccess(request, { admin: true });
  if (access.response) return access.response;
  const searchParams = request.nextUrl.searchParams;
  const email = searchParams.get('email');

  if (!email) {
    return NextResponse.json({ error: 'Email is required' }, { status: 400 });
  }

  try {
    const userResult = await pool.query(
      `SELECT 1 FROM "user" WHERE email = $1 LIMIT 1`,
      [email.toLowerCase()]
    );

    return NextResponse.json({ exists: userResult.rows.length > 0 });
  } catch (error) {
    console.error('Error checking email:', error);
    return NextResponse.json({ error: 'Database operation failed' }, { status: 503 });
  }
}
