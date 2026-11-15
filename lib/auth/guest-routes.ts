/** Explicit showcase page allowlist. API authorization remains in each handler. */
export function isGuestPage(pathname: string): boolean {
  return pathname === '/' || pathname === '/quiz' || pathname === '/transliterator' ||
    pathname === '/ai/sketch' || pathname === '/ai/vision' ||
    /^\/lesson\/(?:all|[^/]+)(?:\/[^/]+\/view)?$/.test(pathname) ||
    /^\/quiz\/(?:all|[^/]+\/view|take\/[^/]+)$/.test(pathname);
}
