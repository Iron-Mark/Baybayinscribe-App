import { useModuleStore } from "@/app/store/server/server.store.modules";
import { NextResponse } from "next/server";
import { requireApiAccess } from "@/lib/auth/api-access";
import { findReadableLesson } from "@/lib/auth/lesson-access";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ resource_id: string }> }
) {
  try {
    const access = await requireApiAccess(request, { allowGuest: true });
    if (access.response) return access.response;
    const { resource_id } = await params;
    if (!resource_id) {
      return NextResponse.json({ message: "Resource ID is required" }, { status: 400 });
    }
    if (!await findReadableLesson(resource_id, access.session?.user ?? {})) {
      return NextResponse.json({ error: "Lesson not found" }, { status: 404 });
    }
    const modules = await useModuleStore.getState().getModules(resource_id);
    return NextResponse.json(modules, { status: 200 });
  } catch (error) {
    console.error("Error fetching modules:", error);
    return NextResponse.json({ message: "Failed to fetch modules" }, { status: 500 });
  }
}
