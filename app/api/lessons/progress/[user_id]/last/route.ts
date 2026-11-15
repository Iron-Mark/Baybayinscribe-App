import db from "@/db/drizzle";
import { learningResource, learningResourceModule, learningResourceProgress } from "@/db/schema/learning-resources";
import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { requireApiAccess } from "@/lib/auth/api-access";

export async function GET(
  request: Request,
  params: { params: Promise<{ user_id: string }> }
) {
  try {
    const { user_id } = await params.params;
    const access = await requireApiAccess(request, { userId: user_id });
    if (access.response) return access.response;
    const query = await db
      .select({
        progress: learningResourceProgress,
        moduleName: learningResourceModule.module_name,
        lessonTitle: learningResource.title,
      })
      .from(learningResourceProgress)
      .leftJoin(learningResourceModule, eq(learningResourceProgress.learning_resource_module_id, learningResourceModule.id))
      .leftJoin(learningResource, eq(learningResourceModule.learning_resource_id, learningResource.id))
      .orderBy(desc(learningResourceProgress.createdAt))
      .where(eq(learningResourceProgress.user_id, user_id))
      .limit(1);

    const latest = query[0];
    return NextResponse.json(latest ? {
      ...latest.progress,
      moduleName: latest.moduleName,
      lessonTitle: latest.lessonTitle,
    } : null, { status: 200 });
  } catch (error: unknown) {
    console.error("Error fetching last progress:", error);
    return NextResponse.json("Failed to fetch last progress: " + error, {
      status: 500,
    });
  }
}
