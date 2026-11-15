"use client";

import Link from 'next/link';
import { authClient } from '@/app/lib/auth-client';

export default function GuestNotice() {
  const { data: session, isPending } = authClient.useSession();
  if (isPending || session) return null;
  return (
    <aside aria-label="Guest mode" className="relative z-10 border-b border-blue-300 bg-blue-50 px-4 py-3 text-sm text-blue-950">
      <strong>Guest showcase.</strong> Explore lessons, quizzes, transliteration,
      scanning and sketching without an account. Practice results stay in this
      visit, not an account. Live chat requires sign-in.{' '}
      <Link href="/auth/login" className="font-semibold underline">Sign in to save progress</Link>
      <nav aria-label="Guest practice tools" className="mt-2 flex flex-wrap gap-4">
        <Link href="/transliterator" className="underline">Try transliteration</Link>
        <Link href="/ai/sketch" className="underline">Try sketching</Link>
        <Link href="/ai/vision" className="underline">Try scanning</Link>
      </nav>
    </aside>
  );
}
