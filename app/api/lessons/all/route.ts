import db from "@/db/drizzle";
import { learningResource } from "@/db/schema/learning-resources";
import { requireApiAccess } from "@/lib/auth/api-access";
import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

function isDatabaseUnconfigured(error: unknown, depth = 0): boolean {
  if (!error || typeof error !== "object" || depth > 4) return false;
  const { message, cause } = error as { message?: unknown; cause?: unknown };
  if (typeof message === "string" && message.includes("DATABASE_URL is required for database access.")) {
    return true;
  }
  return isDatabaseUnconfigured(cause, depth + 1);
}

export async function GET(request: Request) {
  const access = await requireApiAccess(request, { allowGuest: true });
  if (access.response) return access.response;
  try {
    const lessons = await db.select().from(learningResource)
      .where(access.session?.user.role === "admin" ? undefined : eq(learningResource.is_visible, true))
      .orderBy(desc(learningResource.createdAt));
    return NextResponse.json(lessons, { status: 200 });
  } catch (error) {
    if (isDatabaseUnconfigured(error)) return NextResponse.json([], { status: 200 });
    return NextResponse.json({ error: "Failed to fetch lessons" }, { status: 500 });
  }
}
