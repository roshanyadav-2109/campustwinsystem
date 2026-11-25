import { requireAdmin } from "@/lib/context";
import { todayIST, fmtShort } from "@/lib/format";
import { PageHeader, Section, Empty, inputCls, inputBase, btnGhost, btnQuiet } from "@/components/ui";
import { ActionForm, Submit } from "@/components/action-form";
import { addNamed, removeNamed, addHoliday, removeHoliday } from "../actions";

export const metadata = { title: "Organisation" };

function NamedList({ table, title, rows, counts }: { table: "department" | "designation"; title: string; rows: { id: number; name: string }[]; counts: Map<number, number> }) {
  return (
    <Section title={title} flush>
      {rows.length ? (
        <ul className="divide-y divide-cx-line">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 px-5 py-2">
              <span className="text-[14px] text-cx-text">{r.name} <span className="text-cx-faint">{counts.get(r.id) ? `${counts.get(r.id)} ${counts.get(r.id) === 1 ? "person" : "people"}` : ""}</span></span>
              <ActionForm action={removeNamed}>
                <input type="hidden" name="table" value={table} />
                <input type="hidden" name="id" value={r.id} />
                <Submit className={btnQuiet} pending="Removing">Remove</Submit>
              </ActionForm>
            </li>
          ))}
        </ul>
      ) : <Empty>None yet.</Empty>}
      <ActionForm action={addNamed} reset className="border-t border-cx-line p-4">
        <input type="hidden" name="table" value={table} />
        <div className="flex gap-2">
          <label htmlFor={`add-${table}`} className="sr-only">New {table}</label>
          <input id={`add-${table}`} name="name" required maxLength={120} placeholder={table === "department" ? "e.g. Accounts" : "e.g. Lab assistant"} className={inputCls} />
          <Submit className={btnGhost} pending="Adding">Add</Submit>
        </div>
      </ActionForm>
    </Section>
  );
}

export default async function Organisation() {
  const { db, org } = await requireAdmin();
  const year = todayIST().slice(0, 4);
  const [depts, desigs, people, holidays] = await Promise.all([
    db.from("department").select("id, name").eq("org_id", org.id).order("name"),
    db.from("designation").select("id, name").eq("org_id", org.id).order("name"),
    db.from("employee").select("department_id, designation_id").eq("org_id", org.id).neq("status", "left"),
    db.from("holiday").select("id, day, name").eq("org_id", org.id).gte("day", `${year}-01-01`).order("day"),
  ]);
  const deptCount = new Map<number, number>();
  const desigCount = new Map<number, number>();
  for (const p of people.data ?? []) {
    if (p.department_id) deptCount.set(p.department_id, (deptCount.get(p.department_id) ?? 0) + 1);
    if (p.designation_id) desigCount.set(p.designation_id, (desigCount.get(p.designation_id) ?? 0) + 1);
  }

  return (
    <div>
      <PageHeader title="Organisation" sub="Departments, designations and holidays" />
      <div className="grid items-start gap-4 lg:grid-cols-3">
        <NamedList table="department" title="Departments" rows={depts.data ?? []} counts={deptCount} />
        <NamedList table="designation" title="Designations" rows={desigs.data ?? []} counts={desigCount} />
        <Section title={`Holidays from ${year}`} flush>
          {holidays.data?.length ? (
            <ul className="divide-y divide-cx-line">
              {holidays.data.map((h) => (
                <li key={h.id} className="flex items-center justify-between gap-3 px-5 py-2">
                  <span className="text-[14px] text-cx-text">{h.name}<span className="block text-[12.5px] text-cx-muted">{fmtShort(h.day)}</span></span>
                  <ActionForm action={removeHoliday}>
                    <input type="hidden" name="id" value={h.id} />
                    <Submit className={btnQuiet} pending="Removing">Remove</Submit>
                  </ActionForm>
                </li>
              ))}
            </ul>
          ) : <Empty>No holidays yet.</Empty>}
          <ActionForm action={addHoliday} reset className="space-y-2 border-t border-cx-line p-4">
            <div className="flex gap-2">
              <label htmlFor="h-day" className="sr-only">Date</label>
              <input id="h-day" name="day" type="date" required className={`${inputBase} w-auto`} />
              <label htmlFor="h-name" className="sr-only">Name</label>
              <input id="h-name" name="name" required maxLength={120} placeholder="e.g. Diwali" className={inputCls} />
            </div>
            <Submit className={btnGhost} pending="Adding">Add holiday</Submit>
          </ActionForm>
        </Section>
      </div>
    </div>
  );
}
