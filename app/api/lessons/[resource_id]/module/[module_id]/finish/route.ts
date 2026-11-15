import db from "@/db/drizzle";
import {
  learningResourceProgress,
} from "@/db/schema/learning-resources";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { requireApiAccess } from "@/lib/auth/api-access";
import { findReadableLesson, findLessonModule } from "@/lib/auth/lesson-access";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ resource_id: string; module_id: string }> }
) {
  try {
    const access = await requireApiAccess(request);
    if (access.response) return access.response;
    const { resource_id, module_id } = await params;
    const body = await request.json();

    if (body.userId && body.userId !== access.session.user.id) {
      return NextResponse.json({ error: "Cannot finish a module for another user" }, { status: 403 });
    }
    const userId = access.session.user.id;
    if (!await findReadableLesson(resource_id, access.session.user) ||
        !await findLessonModule(resource_id, module_id)) {
      return NextResponse.json({ error: "Module not found" }, { status: 404 });
    }

    if (!userId) {
      return NextResponse.json(
        { error: "User ID is required" },
        { status: 400 }
      );
    }

    const lrModuleQuery = await db
      .select()
      .from(learningResourceProgress)
      .where(
        and(
          eq(learningResourceProgress.user_id, userId),
          eq(learningResourceProgress.learning_resource_module_id, module_id)
        )
      );

    if (lrModuleQuery.length === 0) {
      const insertQuery = await db
        .insert(learningResourceProgress)
        .values({
          user_id: userId,
          learning_resource_module_id: module_id,
          progress: "100",
          id: crypto.randomUUID(),
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();

      return NextResponse.json(insertQuery[0], { status: 201 });
    } else {
      return NextResponse.json(
        { message: "Module already finished" },
        { status: 200 }
      );
    }
  } catch (error) {
    console.error("Error finishing module:", error);
    return NextResponse.json(
      { error: "Failed to finish module" },
      { status: 500 }
    );
  }
}
