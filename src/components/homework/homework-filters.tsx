"use client";
import { usePathname, useSearchParams } from "next/navigation";
import { Select } from "@/components/ui/field";
import { useNavigate } from "@/components/nav-progress";

type Opt = { id: number; label: string };

// Filter bar for the homework list: class (principal only), section, subject.
// Each choice goes into the address so the list can be shared and reloaded.
export function HomeworkFilters({
  classes, sections, subjects, classId, sectionId, subjectId,
}: {
  classes?: Opt[];
  sections: Opt[];
  subjects: Opt[];
  classId?: number | null;
  sectionId: number | null;
  subjectId: number | null;
}) {
  const navigate = useNavigate();
  const pathname = usePathname();
  const params = useSearchParams();

  function update(patch: Record<string, string>) {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    next.delete("open");
    // A different class has its own sections; a different section its own subjects.
    if ("class" in patch) next.delete("section");
    if ("section" in patch && !classes) next.delete("subject");
    const qs = next.toString();
    navigate(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <div className="mb-5 flex flex-wrap items-end gap-3 rounded-md border border-hair bg-surface p-3 shadow-[var(--shadow-card)]">
      {classes && (
        <div className="min-w-[130px] flex-1">
          <label className="t-label mb-1 block" htmlFor="hw-f-class">Class</label>
          <Select id="hw-f-class" value={classId ?? ""} onChange={(e) => update({ class: e.target.value })}>
            <option value="">All classes</option>
            {classes.map((c) => (<option key={c.id} value={c.id}>{c.label}</option>))}
          </Select>
        </div>
      )}
      <div className="min-w-[150px] flex-1">
        <label className="t-label mb-1 block" htmlFor="hw-f-section">Section</label>
        <Select id="hw-f-section" value={sectionId ?? ""} onChange={(e) => update({ section: e.target.value })}>
          <option value="">All sections</option>
          {sections.map((s) => (<option key={s.id} value={s.id}>{s.label}</option>))}
        </Select>
      </div>
      <div className="min-w-[150px] flex-1">
        <label className="t-label mb-1 block" htmlFor="hw-f-subject">Subject</label>
        <Select id="hw-f-subject" value={subjectId ?? ""} onChange={(e) => update({ subject: e.target.value })}>
          <option value="">All subjects</option>
          {subjects.map((s) => (<option key={s.id} value={s.id}>{s.label}</option>))}
        </Select>
      </div>
    </div>
  );
}
