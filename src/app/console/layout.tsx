import Link from "next/link";
import { redirect } from "next/navigation";
import { getOwnerEmail } from "@/lib/owner";

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const owner = await getOwnerEmail();
  if (!owner) redirect("/login?next=/console");
  return (
    <div className="min-h-dvh bg-paper">
      <header className="sticky top-0 z-30 flex h-14 items-center gap-4 border-b border-hair bg-white px-4 sm:px-6">
        <Link href="/console" className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- static brand wordmark */}
          <img src="/brand/campustwin-wordmark.webp" alt="CampusTwin" className="h-6 w-auto" />
          <span className="text-[13px] font-medium text-ink-500">Console</span>
        </Link>
        <nav className="flex items-center gap-4 text-[13px]">
          <Link href="/console" className="text-ink-700 hover:text-ink-900">Institutions</Link>
          <Link href="/console/new" className="text-ink-700 hover:text-ink-900">New</Link>
          <Link href="/console/owners" className="text-ink-700 hover:text-ink-900">Team</Link>
        </nav>
        <div className="ml-auto flex items-center gap-3 text-[12px] text-ink-500">
          <span className="hidden sm:inline">{owner}</span>
          <a href="/auth/signout" className="rounded-md border border-hair px-2.5 py-1 text-ink-700 hover:bg-panel">Sign out</a>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
