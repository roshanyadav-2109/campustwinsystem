import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { Shell } from "@/components/console/shell";
import { ConsoleNavLink } from "@/components/console/nav-link";

const BASE = process.env.NEXT_PUBLIC_BASE_DOMAIN || "campustwin.org";
function I({ d }: { d: string }) {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>;
}
const ic = {
  overview: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z",
  campuses: "M3 21h18M5 21V7l8-4v18M19 21V11l-6-3M9 9h0M9 13h0M9 17h0",
  admins: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.87",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6M19.4 15a1.6 1.6 0 0 0 .3 1.8M4.6 9A1.6 1.6 0 0 0 4.3 7.2",
};

export default async function UniversityWorkspaceLayout({ params, children }: { params: Promise<{ id: string }>; children: React.ReactNode }) {
  const { id } = await params;
  const admin = createAdminClient();
  const { data: u } = await admin.from("university").select("id, name, slug, status").eq("id", Number(id)).maybeSingle();
  if (!u) notFound();
  const base = `/console/university/${u.id}`;
  const on = u.status === "active";

  const brand = (
    <div className="px-3 py-2.5">
      <Link href="/console" className="text-[11px] text-ink-500 hover:text-[#0F6CBD]">&larr; All institutions</Link>
      <div className="mt-1.5 flex items-center gap-2">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-violet-100 text-[11px] font-bold text-violet-700">{u.name.slice(0, 2).toUpperCase()}</span>
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold leading-tight text-ink-900" title={u.name}>{u.name}</p>
          <p className="flex items-center gap-1 text-[10.5px] text-ink-400"><span className={`h-1.5 w-1.5 rounded-full ${on ? "bg-emerald-500" : "bg-amber-500"}`} />{u.slug}.{BASE}</p>
        </div>
      </div>
    </div>
  );

  return (
    <Shell
      brand={brand}
      nav={
        <>
          <ConsoleNavLink href={base} exact icon={<I d={ic.overview} />} label="Overview" />
          <ConsoleNavLink href={`${base}/campuses`} icon={<I d={ic.campuses} />} label="Campuses" />
          <ConsoleNavLink href={`${base}/admins`} icon={<I d={ic.admins} />} label="Central admins" />
          <ConsoleNavLink href={`${base}/settings`} icon={<I d={ic.settings} />} label="Settings" />
        </>
      }
    >
      {children}
    </Shell>
  );
}
