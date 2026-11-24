import { createAdminClient } from "@/lib/supabase/admin";
import { loadSchool, currentYear, type Admin } from "@/lib/console/tenant";
import { ConsoleTable, Pill, ZoneHeader, type Col } from "@/components/console/table";

async function enrollmentBySection(admin: Admin, schoolId: number, yearId: number) {
  const tally = new Map<number, number>();
  for (let from = 0; ; from += 1000) {
    const { data } = await admin.from("student_enrollment").select("section_id").eq("school_id", schoolId).eq("academic_year_id", yearId).neq("status", "transferred").range(from, from + 999);
    for (const e of data ?? []) tally.set(e.section_id, (tally.get(e.section_id) ?? 0) + 1);
    if (!data || data.length < 1000) break;
  }
  return tally;
}

export default async function ClassesZone({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await loadSchool(id);
  const admin = createAdminClient();
  const [{ data: classes }, { data: sections }, year] = await Promise.all([
    admin.from("class").select("id, name, level, stage").eq("school_id", s.id).order("level"),
    admin.from("section").select("id, name, class_id").eq("school_id", s.id).order("name"),
    currentYear(admin, s.id),
  ]);
  const cls = classes ?? [];
  const secs = sections ?? [];
  const classById = new Map(cls.map((c) => [c.id, c]));
  const tally = year ? await enrollmentBySection(admin, s.id, year.id) : new Map<number, number>();

  type C = { id: number; name: string; level: number; stage: string };
  const classCols: Col<C>[] = [
    { key: "name", label: "Class", render: (c) => <span className="font-medium text-cx-text">{c.name}</span> },
    { key: "stage", label: "NEP stage", render: (c) => <Pill>{c.stage}</Pill> },
    { key: "sections", label: "Sections", align: "right", render: (c) => secs.filter((x) => x.class_id === c.id).length },
    { key: "students", label: "Students", align: "right", render: (c) => secs.filter((x) => x.class_id === c.id).reduce((n, x) => n + (tally.get(x.id) ?? 0), 0).toLocaleString("en-IN") },
  ];

  type S = { id: number; name: string; class_id: number };
  const secCols: Col<S>[] = [
    { key: "label", label: "Section", render: (x) => <span className="font-medium text-cx-text">{classById.get(x.class_id)?.name ?? "?"}-{x.name}</span> },
    { key: "students", label: "Students", align: "right", render: (x) => (tally.get(x.id) ?? 0).toLocaleString("en-IN") },
  ];

  return (
    <div>
      <ZoneHeader title="Classes & sections" sub={`${cls.length} classes · ${secs.length} sections${year ? ` · ${year.name}` : ""}`} />
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <p className="mb-2 text-[14px] font-semibold text-cx-text">Classes</p>
          <ConsoleTable columns={classCols} rows={cls as C[]} rowKey={(c) => c.id} empty="No classes" />
        </div>
        <div>
          <p className="mb-2 text-[14px] font-semibold text-cx-text">Sections</p>
          <ConsoleTable columns={secCols} rows={secs as S[]} rowKey={(x) => x.id} empty="No sections" />
        </div>
      </div>
    </div>
  );
}
