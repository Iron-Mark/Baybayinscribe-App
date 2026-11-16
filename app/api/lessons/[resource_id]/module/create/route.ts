import { useModuleStore } from "@/app/store/server/server.store.modules";
import { NextResponse } from "next/server";
import { requireApiAccess } from "@/lib/auth/api-access";
import { findReadableLesson } from "@/lib/auth/lesson-access";

export async function POST(
	request: Request,
	params: { params: Promise<{ resource_id: string }> }
) {
	try {
		const access = await requireApiAccess(request, { admin: true });
		if (access.response) return access.response;
		const { resource_id } = await params.params;
		if (!await findReadableLesson(resource_id, access.session.user)) {
			return NextResponse.json({ error: "Lesson not found" }, { status: 404 });
		}
		const formData = await request.formData();
		const file = formData.get("file") as File | null;
		const title = formData.get("module_title")?.toString();
		const description = formData.get("module_description")?.toString();

		if (!resource_id) {
			return new Response("Resource ID is required", { status: 400 });
		}
		if (!title || !description) {
			return new Response("Title and description are required", { status: 400 });
		}

		const moduleData = await useModuleStore
			.getState()
			.createModule(resource_id, title, description, file);

		return NextResponse.json(
			{ message: "Module created successfully", module: moduleData },
			{ status: 201 }
		);
	} catch (error) {
		console.error("Error creating module:", error);
		return NextResponse.json(
			{ message: "Failed to create module" },
			{ status: 500 }
		);
	}
}
