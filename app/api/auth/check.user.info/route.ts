export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { requireApiAccess } from "@/lib/auth/api-access";
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

export async function GET(req: NextRequest) {
  try {
    const access = await requireApiAccess(req);
    if (access.response) return access.response;

    const result = await pool.query(
      `SELECT * FROM "user_information" WHERE user_id = $1`,
      [access.session.user.id]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ status: "incomplete", step: "userinfo" });
    }

    const userInfo = result.rows[0];

    // Check if user has agreed to terms
    if (!userInfo.agreed_to_terms) {
      return NextResponse.json({ status: "incomplete", step: "terms" });
    }

    return NextResponse.json({ status: "complete" });
  } catch (error) {
    console.error("Error checking user info:", error);
    return NextResponse.json({ status: "error" }, { status: 500 });
  }
}
