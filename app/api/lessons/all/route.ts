import db from "@/db/drizzle";
import { learningResource } from "@/db/schema/learning-resources";
import { requireApiAccess } from "@/lib/auth/api-access";
import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const access = await requireApiAccess(request, { allowGuest: true });
  if (access.response) return access.response;
  const lessons = await db.select().from(learningResource)
    .where(access.session?.user.role === "admin" ? undefined : eq(learningResource.is_visible, true))
    .orderBy(desc(learningResource.createdAt));
  return NextResponse.json(lessons, { status: 200 });
}
