import { createAdminClient } from "@/lib/supabase/admin";
import { loadSchool } from "@/lib/console/tenant";
import { ConsoleTable, Pill, ZoneHeader, type Col } from "@/components/console/table";

type Row = { id: string; full_name: string; role: string; staff_id: number | null; student_id: number | null; guardian_id: number | null; created_at: string };

export default async function AccessZone({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await loadSchool(id);
  const admin = createAdminClient();
  const { data } = await admin.from("profile").select("id, full_name, role, staff_id, student_id, guardian_id, created_at").eq("school_id", s.id).order("created_at");
  const rows = (data ?? []) as Row[];

  const linkOf = (r: Row) => r.staff_id ? `Staff #${r.staff_id}` : r.student_id ? `Student #${r.student_id}` : r.guardian_id ? `Guardian #${r.guardian_id}` : "—";
  const tone = (role: string) => (role === "staff" ? "violet" : role === "student" ? "sky" : "amber") as "violet" | "sky" | "amber";

  const cols: Col<Row>[] = [
    { key: "name", label: "Account", render: (r) => <span className="font-medium text-cx-text">{r.full_name}</span> },
    { key: "role", label: "Role", render: (r) => <Pill tone={tone(r.role)}>{r.role}</Pill> },
    { key: "link", label: "Linked record", render: (r) => <span className="text-cx-text-2">{linkOf(r)}</span> },
    { key: "created", label: "Since", align: "right", render: (r) => <span className="text-cx-muted">{new Date(r.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</span> },
  ];

  return (
    <div>
      <ZoneHeader title="Login access" sub={`${rows.length} account${rows.length === 1 ? "" : "s"} can sign in to this institution`} />
      <ConsoleTable columns={cols} rows={rows} rowKey={(r) => r.id} empty="No one has signed in yet" />
      <p className="mt-3 text-[12px] text-cx-muted">Accounts are created automatically when a staff member, parent or student first signs in with a Google email that matches a record here.</p>
    </div>
  );
}
