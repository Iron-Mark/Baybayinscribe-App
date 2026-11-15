import { useServerLrStore } from "@/app/store/server/server.store.lr";
import { NextResponse } from "next/server";
import { requireApiAccess } from "@/lib/auth/api-access";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ resource_id: string }> }
) {
  try {
    const access = await requireApiAccess(request, { admin: true });
    if (access.response) return access.response;
    const { resource_id } = await context.params;
    if (!resource_id) {
      return new Response("Resource ID is required", { status: 400 });
    }

    await useServerLrStore
      .getState()
      .deleteLesson(resource_id);

    return NextResponse.json("Module deleted successfully", { status: 201 });
  } catch (error) {
    console.error("Error deleting module:", error);
    return NextResponse.json(
      "Failed to delete module",
      { status: 500 }
    );
  }
}
