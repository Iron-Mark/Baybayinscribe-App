import { useModuleStore } from "@/app/store/server/server.store.modules";
import { NextResponse } from "next/server";
import { requireApiAccess } from "@/lib/auth/api-access";
import { findLessonModule } from "@/lib/auth/lesson-access";

export async function DELETE(
  request: Request,
  params: { params: Promise<{ resource_id: string; module_id: string }> }
) {
  try {
    const access = await requireApiAccess(request, { admin: true });
    if (access.response) return access.response;
    const { resource_id, module_id } = await params.params;
    if (!await findLessonModule(resource_id, module_id)) {
      return NextResponse.json({ error: "Module not found" }, { status: 404 });
    }
    const result = await useModuleStore.getState().deleteModule(module_id);
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    console.error("Error deleting module:", error);
    return NextResponse.json(
      { message: "Failed to delete module" },
      { status: 500 }
    );
  }
}
