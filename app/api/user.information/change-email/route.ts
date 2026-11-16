import { auth } from "@/app/lib/auth";
import { requireApiAccess } from "@/lib/auth/api-access";
import { NextResponse } from "next/server";
import { z } from "zod";

const changeEmailSchema = z.object({ newEmail: z.string().trim().email().max(254) });

export async function POST(request: Request) {
  const access = await requireApiAccess(request);
  if (access.response) return access.response;
  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const parsed = changeEmailSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid new email address." }, { status: 400 });
  const newEmail = parsed.data.newEmail.toLowerCase();
  if (newEmail === access.session.user.email.toLowerCase()) {
    return NextResponse.json({ error: "Enter a different email address." }, { status: 400 });
  }
  const needsCurrentVerification = access.session.user.emailVerified !== true;
  const endpoint = needsCurrentVerification ? "/send-verification-email" : "/change-email";
  const headers = new Headers(request.headers);
  headers.delete("content-length");
  headers.set("content-type", "application/json");
  try {
    // Dispatch locally through the real HTTP pipeline, including its rate limiter.
    // No client-supplied callback/identity or network fetch is used.
    const response = await auth.handler(new Request(new URL(`/api/auth${endpoint}`, request.url), {
      method: "POST", headers,
      body: JSON.stringify(needsCurrentVerification
        ? { email: access.session.user.email, callbackURL: "/auth/login" }
        : { newEmail, callbackURL: "/auth/login" }),
    }));
    if (!response.ok) return response;
    const responseHeaders = new Headers(response.headers);
    responseHeaders.delete("content-length");
    responseHeaders.set("cache-control", "no-store");
    return NextResponse.json({
      status: needsCurrentVerification ? "current-email-verification-required" : "confirmation-required",
      emailChangeRequested: !needsCurrentVerification,
    }, { status: 202, headers: responseHeaders });
  } catch {
    return NextResponse.json({ error: "Unable to request email confirmation. Please try again later." }, { status: 503 });
  }
}
