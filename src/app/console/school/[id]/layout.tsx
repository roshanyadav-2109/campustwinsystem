import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { Shell, NavLabel } from "@/components/console/shell";
import { ConsoleNavLink } from "@/components/console/nav-link";

const BASE = process.env.NEXT_PUBLIC_BASE_DOMAIN || "campustwin.org";

function I({ d }: { d: string }) {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>;
}
const ic = {
  overview: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z",
  students: "M22 10 12 5 2 10l10 5 10-5zM6 12v5c0 1 2.7 2.5 6 2.5s6-1.5 6-2.5v-5",
  staff: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M19 8v6M22 11h-6",
  guardians: "M17 21v-2a4 4 0 0 0-3-3.87M7 21v-2a4 4 0 0 1 3-3.87M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8",
  access: "M15 7a4 4 0 1 1-4 4M11 11 3 19l2 2M8 16l2 2",
  classes: "M12 2 2 7l10 5 10-5zM2 17l10 5 10-5M2 12l10 5 10-5",
  attendance: "M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2M9 16l2 2 4-4",
  exams: "M9 2h6a1 1 0 0 1 1 1v1h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2V3a1 1 0 0 1 1-1zM9 12l2 2 4-4",
  fees: "M3 10h18M3 6h18a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1M7 15h3",
  admissions: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M19 8v6M22 11h-6",
  transport: "M8 6h11a2 2 0 0 1 2 2v7H3V8a2 2 0 0 1 2-2zM3 15h18M7 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4M17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4",
  library: "M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z",
  announcements: "M3 11v2a1 1 0 0 0 1 1h3l4 4V6L7 10H4a1 1 0 0 0-1 1M15.5 8.5a4 4 0 0 1 0 7",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H1a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 2.6 7a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H7a1.6 1.6 0 0 0 1-1.5V1a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V7a1.6 1.6 0 0 0 1.5 1H23a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z",
};

export default async function SchoolWorkspaceLayout({ params, children }: { params: Promise<{ id: string }>; children: React.ReactNode }) {
  const { id } = await params;
  const admin = createAdminClient();
  const { data: s } = await admin.from("school").select("id, name, slug, status, university_id").eq("id", Number(id)).maybeSingle();
  if (!s) notFound();
  const base = `/console/school/${s.id}`;
  const on = s.status === "active";

  const brand = (
    <div className="px-3 py-2.5">
      <Link href={s.university_id ? `/console/university/${s.university_id}` : "/console"} className="text-[11px] text-ink-500 hover:text-[#0F6CBD]">&larr; {s.university_id ? "University" : "All institutions"}</Link>
      <div className="mt-1.5 flex items-center gap-2">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[#0F6CBD]/10 text-[11px] font-bold text-[#0F6CBD]">{s.name.slice(0, 2).toUpperCase()}</span>
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold leading-tight text-ink-900" title={s.name}>{s.name}</p>
          <p className="flex items-center gap-1 text-[10.5px] text-ink-400"><span className={`h-1.5 w-1.5 rounded-full ${on ? "bg-emerald-500" : "bg-amber-500"}`} />{s.slug}.{BASE}</p>
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
          <NavLabel>People</NavLabel>
          <ConsoleNavLink href={`${base}/students`} icon={<I d={ic.students} />} label="Students" />
          <ConsoleNavLink href={`${base}/staff`} icon={<I d={ic.staff} />} label="Staff" />
          <ConsoleNavLink href={`${base}/guardians`} icon={<I d={ic.guardians} />} label="Guardians" />
          <ConsoleNavLink href={`${base}/access`} icon={<I d={ic.access} />} label="Login access" />
          <NavLabel>Academics</NavLabel>
          <ConsoleNavLink href={`${base}/classes`} icon={<I d={ic.classes} />} label="Classes & sections" />
          <ConsoleNavLink href={`${base}/attendance`} icon={<I d={ic.attendance} />} label="Attendance" />
          <ConsoleNavLink href={`${base}/exams`} icon={<I d={ic.exams} />} label="Exams & marks" />
          <NavLabel>Operations</NavLabel>
          <ConsoleNavLink href={`${base}/fees`} icon={<I d={ic.fees} />} label="Fees" />
          <ConsoleNavLink href={`${base}/admissions`} icon={<I d={ic.admissions} />} label="Admissions" />
          <ConsoleNavLink href={`${base}/transport`} icon={<I d={ic.transport} />} label="Transport" />
          <ConsoleNavLink href={`${base}/library`} icon={<I d={ic.library} />} label="Library" />
          <ConsoleNavLink href={`${base}/announcements`} icon={<I d={ic.announcements} />} label="Announcements" />
          <NavLabel>Administration</NavLabel>
          <ConsoleNavLink href={`${base}/settings`} icon={<I d={ic.settings} />} label="Settings" />
        </>
      }
    >
      {children}
    </Shell>
  );
}
