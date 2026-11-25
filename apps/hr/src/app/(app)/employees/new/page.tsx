import Link from "next/link";
import { requireAdmin } from "@/lib/context";
import { PageHeader, Section, btnPrimary, btnGhost } from "@/components/ui";
import { ActionForm, Submit } from "@/components/action-form";
import { EmployeeFields } from "@/components/employee-fields";
import { addEmployee } from "../../actions";

export const metadata = { title: "Add employee" };

export default async function NewEmployee() {
  const { db, org } = await requireAdmin();
  const [depts, desigs, people, last] = await Promise.all([
    db.from("department").select("id, name").eq("org_id", org.id).order("name"),
    db.from("designation").select("id, name").eq("org_id", org.id).order("name"),
    db.from("employee").select("id, full_name").eq("org_id", org.id).neq("status", "left").order("full_name"),
    db.from("employee").select("code").eq("org_id", org.id).order("id", { ascending: false }).limit(1).maybeSingle(),
  ]);
  // Suggest the next number when the last one ends in digits (E-041 -> E-042).
  const m = last.data?.code.match(/^(.*?)(\d+)$/);
  const nextCode = m ? m[1] + String(Number(m[2]) + 1).padStart(m[2].length, "0") : "E-001";

  return (
    <div>
      <PageHeader title="Add employee" sub="Teaching and non-teaching staff alike" />
      <Section>
        <ActionForm action={addEmployee} className="space-y-5">
          <EmployeeFields
            v={{ code: nextCode }}
            departments={depts.data ?? []}
            designations={desigs.data ?? []}
            managers={(people.data ?? []).map((p) => ({ id: p.id, name: p.full_name }))}
          />
          <div className="flex gap-2">
            <Submit className={btnPrimary} pending="Adding">Add employee</Submit>
            <Link href="/employees" className={btnGhost}>Cancel</Link>
          </div>
        </ActionForm>
      </Section>
    </div>
  );
}
