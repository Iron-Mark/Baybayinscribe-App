import { useServerLrStore } from "@/app/store/server/server.store.lr";
import { NextResponse } from "next/server";
import { requireApiAccess } from "@/lib/auth/api-access";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ resource_id: string }> }
) {
  try {
    const access = await requireApiAccess(request, { admin: true });
    if (access.response) return access.response;
    const { resource_id } = await params;
    if (!resource_id) {
      return new Response("Resource ID is required", { status: 400 });
    }

    const data = await request.json();
    if (data.id && data.id !== resource_id) {
      return NextResponse.json({ error: "Resource ID mismatch" }, { status: 400 });
    }
    const lessonsState = useServerLrStore.getState();
    await lessonsState.updateLesson({
      id: resource_id,
      title: typeof data.title === "string" ? data.title : undefined,
      description: typeof data.description === "string" ? data.description : undefined,
      is_visible: typeof data.is_visible === "boolean" ? data.is_visible : undefined,
    });

    return NextResponse.json("Lesson updated successfully", { status: 200 });
  } catch (error) {
    console.error("Error updating lesson:", error);
    return NextResponse.json("Failed to update lesson", { status: 500 });
  }
}
