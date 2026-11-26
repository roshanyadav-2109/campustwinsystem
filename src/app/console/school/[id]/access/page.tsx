import { createAdminClient } from "@/lib/supabase/admin";
import { loadSchool, headCount } from "@/lib/console/tenant";
import { ConsoleTable, Kpi, ZoneHeader, kpiStrip, type Col } from "@/components/console/table";
import { Section } from "@/components/console/ui";
import { FirstLoginForm } from "@/components/console/first-login-form";

type Row = { id: string; full_name: string; role: string; staff_id: number | null; student_id: number | null; guardian_id: number | null; created_at: string };
const ROLE: Record<string, string> = { staff: "Staff", guardian: "Parent or guardian", student: "Student" };
const fmt = (d: string) => new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

export default async function AccessZone({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await loadSchool(id);
  const admin = createAdminClient();
  const { data } = await admin.from("profile").select("id, full_name, role, staff_id, student_id, guardian_id, created_at").eq("school_id", s.id).order("created_at", { ascending: false });
  const rows = (data ?? []) as Row[];
  const { data: leaders } = await admin.from("staff").select("id, full_name, email, role").eq("school_id", s.id).in("role", ["principal", "office"]).not("email", "is", null).order("full_name");
  const [staffTotal, guardianTotal, studentTotal] = await Promise.all([headCount(admin, "staff", s.id), headCount(admin, "guardian", s.id), headCount(admin, "student", s.id)]);
  const count = (role: string) => rows.filter((r) => r.role === role).length;
  const share = (n: number, of: number) => (of ? `${n.toLocaleString("en-IN")} of ${of.toLocaleString("en-IN")}` : "None on record");

  const cols: Col<Row>[] = [
    { key: "name", label: "Name", render: (r) => <span className="font-medium text-cx-text">{r.full_name}</span> },
    { key: "role", label: "Signs in as", render: (r) => ROLE[r.role] ?? r.role },
    { key: "created", label: "First signed in", render: (r) => <span className="tabular-nums">{fmt(r.created_at)}</span> },
  ];

  return (
    <div>
      <ZoneHeader title="Login access" />

      <div className={kpiStrip}>
        <Kpi label="Accounts" value={rows.length} />
        <Kpi label="Staff with a login" value={count("staff")} sub={share(count("staff"), staffTotal)} />
        <Kpi label="Parents with a login" value={count("guardian")} sub={share(count("guardian"), guardianTotal)} />
        <Kpi label="Students with a login" value={count("student")} sub={share(count("student"), studentTotal)} />
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <Section title="Accounts" desc="Newest first" flush>
            <ConsoleTable bare columns={cols} rows={rows} rowKey={(r) => r.id} empty="No one has signed in yet" />
          </Section>
        </div>
        <div className="space-y-4">
        <Section title="Give a school leader access" desc="For a new school: their first principal or office login">
          <FirstLoginForm schoolId={s.id} />
          {!!leaders?.length && (
            <ul className="mt-4 space-y-1.5 border-t border-cx-line pt-3 text-[13px]">
              {leaders.map((l) => (
                <li key={l.id} className="flex justify-between gap-3"><span className="text-cx-text">{l.full_name}</span><span className="truncate text-cx-muted">{l.role === "principal" ? "Principal" : "Office"}, {l.email}</span></li>
              ))}
            </ul>
          )}
        </Section>
        <Section title="How sign-in works">
          <ol className="space-y-3 text-[13px] leading-5 text-cx-text-2">
            <li className="flex gap-3"><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-cx-raised text-[11px] font-semibold text-cx-text">1</span>The school office adds a person with their email address.</li>
            <li className="flex gap-3"><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-cx-raised text-[11px] font-semibold text-cx-text">2</span>That person chooses Sign in with Google on the school&apos;s portal.</li>
            <li className="flex gap-3"><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-cx-raised text-[11px] font-semibold text-cx-text">3</span>Their account is created on that first sign-in and appears in this list.</li>
          </ol>
        </Section>
        </div>
      </div>
    </div>
  );
}
