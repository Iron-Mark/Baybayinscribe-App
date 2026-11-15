import { auth } from "@/app/lib/auth";
import { NextResponse } from "next/server";

type Session = typeof auth.$Infer.Session;
type AccessResult =
  | { session: Session; response?: never }
  | { response: NextResponse; session?: never };

export type ApiAccessOptions = { admin?: boolean; userId?: string };
type GuestReadOptions = { allowGuest: true; admin?: never; userId?: never };
type PublicAccessResult =
  | { session: Session | null; response?: never }
  | { response: NextResponse; session?: never };

/** Route-level authorization; middleware/caller-supplied identity is not trusted. */
export function requireApiAccess(request: Request, options: GuestReadOptions): Promise<PublicAccessResult>;
export function requireApiAccess(request: Request, options?: ApiAccessOptions): Promise<AccessResult>;
export async function requireApiAccess(
  request: Request,
  options: ApiAccessOptions | GuestReadOptions = {},
): Promise<PublicAccessResult> {
  // Cookie-authenticated mutations must not accept a browser's cross-origin form.
  // Native/API callers without Origin still require a valid server-side session.
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase())) {
    const origin = request.headers.get("origin");
    const fetchSite = request.headers.get("sec-fetch-site");
    const trusted = new Set<string>([new URL(request.url).origin]);
    for (const configured of [process.env.NEXT_PUBLIC_SITE_URL, process.env.NEXT_PUBLIC_BETTER_AUTH_URL]) {
      if (!configured) continue;
      try { trusted.add(new URL(configured).origin); } catch { /* Invalid config grants nothing. */ }
    }
    if ((origin && !trusted.has(origin)) || (!origin && fetchSite === "cross-site")) {
      return { response: NextResponse.json({ error: "Untrusted request origin" }, { status: 403 }) };
    }
  }

  let session: Session | null;
  try {
    session = await auth.api.getSession({ headers: request.headers });
  } catch {
    return { response: NextResponse.json({ error: "Session verification unavailable" }, { status: 503 }) };
  }
  if (!session?.user?.id) {
    // Only explicitly opted-in read endpoints may be anonymous. Never create a
    // synthetic user/session, and never apply this option to writes or owners.
    if ('allowGuest' in options && options.allowGuest && !options.admin && options.userId === undefined &&
        ['GET', 'HEAD'].includes(request.method.toUpperCase())) return { session: null };
    return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (session.user.banned) {
    return { response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  const isAdmin = session.user.role === "admin";
  if ((options.admin && !isAdmin) ||
      (options.userId !== undefined && options.userId !== session.user.id && !isAdmin)) {
    return { response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { session };
}
