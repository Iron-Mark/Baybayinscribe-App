import db from "@/db/drizzle";
import { learningResourceProgress } from "@/db/schema/learning-resources";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { requireApiAccess } from "@/lib/auth/api-access";

export async function POST(
  request: Request,
  params: { params: Promise<{ user_id: string }> }
) {
  try {
    const { user_id } = await params.params;
    const access = await requireApiAccess(request, { userId: user_id });
    if (access.response) return access.response;
    console.log("Clearing progress for user:", user_id);
    await db
      .delete(learningResourceProgress)
      .where(eq(learningResourceProgress.user_id, user_id));
    return NextResponse.json("Progress cleared successfully", { status: 200 });
  } catch (error) {
    console.error("Error clearing progress:", error);
    return NextResponse.json("Failed to clear progress: " + error, {
      status: 500,
    });
  }
}
