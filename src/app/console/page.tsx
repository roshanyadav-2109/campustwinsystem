import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { setSchoolStatus, setUniversityStatus, toggleModule } from "./actions";

const BASE = process.env.NEXT_PUBLIC_BASE_DOMAIN || "campustwin.org";
const GATEABLE = ["fees", "library", "homework", "admissions", "hr", "transport"] as const;

type SchoolRow = {
  id: number; name: string; slug: string; place: string | null; plan: string | null;
  status: string; modules: Record<string, boolean> | null; university_id: number | null;
  students: { count: number }[]; staff: { count: number }[];
};
type Uni = { id: number; name: string; slug: string; plan: string | null; status: string };

function count(a: { count: number }[] | null) { return a?.[0]?.count ?? 0; }

function StatusBadge({ status }: { status: string }) {
  const on = status === "active";
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${on ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{status}</span>;
}

function SchoolCard({ s }: { s: SchoolRow }) {
  const mods = s.modules ?? {};
  return (
    <div className="rounded-lg border border-hair bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[15px] font-semibold text-ink-900">{s.name}</span>
            <StatusBadge status={s.status} />
          </div>
          <a href={`https://${s.slug}.${BASE}`} target="_blank" rel="noreferrer" className="text-[12px] text-[#0F6CBD] hover:underline">{s.slug}.{BASE}</a>
          <span className="ml-3 text-[12px] text-ink-500">{count(s.students).toLocaleString()} students · {count(s.staff).toLocaleString()} staff{s.plan ? ` · ${s.plan}` : ""}</span>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/console/school/${s.id}`} className="rounded-md border border-hair px-2.5 py-1 text-[12px] text-ink-700 hover:bg-panel">Edit</Link>
          <form action={setSchoolStatus}>
            <input type="hidden" name="id" value={s.id} />
            <input type="hidden" name="status" value={s.status === "active" ? "suspended" : "active"} />
            <button className="rounded-md border border-hair px-2.5 py-1 text-[12px] text-ink-700 hover:bg-panel">{s.status === "active" ? "Suspend" : "Activate"}</button>
          </form>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {GATEABLE.map((k) => (
          <form key={k} action={toggleModule}>
            <input type="hidden" name="id" value={s.id} />
            <input type="hidden" name="key" value={k} />
            <button className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors ${mods[k] ? "bg-[#0F6CBD] text-white" : "bg-panel text-ink-500 hover:text-ink-900"}`}>{k}</button>
          </form>
        ))}
      </div>
    </div>
  );
}

export default async function ConsolePage() {
  const admin = createAdminClient();
  const [{ data: unis }, { data: schools }] = await Promise.all([
    admin.from("university").select("id, name, slug, plan, status").order("name"),
    admin.from("school").select("id, name, slug, place, plan, status, modules, university_id, students:student(count), staff:staff(count)").order("id"),
  ]);
  const allSchools = (schools ?? []) as unknown as SchoolRow[];
  const standalone = allSchools.filter((s) => !s.university_id);
  const byUni = (uid: number) => allSchools.filter((s) => s.university_id === uid);
  const universities = (unis ?? []) as Uni[];

  const totalStudents = allSchools.reduce((n, s) => n + count(s.students), 0);

  return (
    <div>
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="t-h1 text-ink-900">Institutions</h1>
          <p className="mt-1 text-[13px] text-ink-500">{universities.length} universities · {standalone.length} standalone schools · {totalStudents.toLocaleString()} students</p>
        </div>
        <Link href="/console/new" className="rounded-md bg-[#0F6CBD] px-3 py-2 text-[13px] font-medium text-white">+ New institution</Link>
      </div>

      {universities.map((u) => (
        <section key={u.id} className="mb-6">
          <div className="mb-2 flex items-center gap-2">
            <h2 className="text-[16px] font-semibold text-ink-900">{u.name}</h2>
            <StatusBadge status={u.status} />
            <a href={`https://${u.slug}.${BASE}`} target="_blank" rel="noreferrer" className="text-[12px] text-[#0F6CBD] hover:underline">{u.slug}.{BASE}</a>
            <Link href={`/console/university/${u.id}`} className="ml-auto rounded-md border border-hair px-2.5 py-1 text-[12px] text-ink-700 hover:bg-panel">Edit</Link>
            <form action={setUniversityStatus}>
              <input type="hidden" name="id" value={u.id} />
              <input type="hidden" name="status" value={u.status === "active" ? "suspended" : "active"} />
              <button className="rounded-md border border-hair px-2.5 py-1 text-[12px] text-ink-700 hover:bg-panel">{u.status === "active" ? "Suspend" : "Activate"}</button>
            </form>
          </div>
          <div className="grid gap-2 pl-3 sm:grid-cols-2">
            {byUni(u.id).map((s) => <SchoolCard key={s.id} s={s} />)}
            {byUni(u.id).length === 0 && <p className="text-[13px] text-ink-500">No campuses yet. <Link href={`/console/university/${u.id}`} className="text-[#0F6CBD]">Add one</Link>.</p>}
          </div>
        </section>
      ))}

      <section>
        <h2 className="mb-2 text-[16px] font-semibold text-ink-900">Standalone schools</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          {standalone.map((s) => <SchoolCard key={s.id} s={s} />)}
          {standalone.length === 0 && <p className="text-[13px] text-ink-500">None.</p>}
        </div>
      </section>
    </div>
  );
}
