"use client";
import { useState, useTransition } from "react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { internalMarks, importUniversityResults, setRegisterNumbers, type ImportRow } from "@/app/dashboard/returns/actions";

export type Stats = { students: number; by_gender: Record<string, number>; by_programme: { programme: string; year: number | null; students: number; female: number; sc?: number; st?: number; obc?: number; ews?: number; pwd?: number }[];
  gender_by_category?: Record<string, Record<string, number>>; outgoing?: { year: string; programme: string; appeared: number; passed: number }[];
  staff: number; staff_by_title: Record<string, number>; pass_rates: { semester: string; students: number; all_passed: number }[]; programmes: number; departments: number;
  by_category?: Record<string, number>; by_minority?: Record<string, number>; pwd?: number; by_state?: Record<string, number>;
  intake?: { programme: string; intake: number | null; admitted: number }[]; final_year?: { programme: string; appeared: number; passed: number }[];
  staff_by_gender?: Record<string, number>; staff_by_qualification?: Record<string, number>; staff_by_appointment?: Record<string, number> };
const list = (o?: Record<string, number>) => Object.entries(o ?? {}).map(([k, v]) => `${k.replace(/_/g, " ")} ${v}`).join(", ") || "-";
type Opt = { id: number; label: string };

const esc = (v: unknown) => { let s = v == null ? "" : String(v); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
function saveCsv(name: string, header: string[], rows: unknown[][]) {
  const text = "\ufeff" + [header, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a"); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
}
// a simple CSV reader: quoted fields, commas inside quotes
function parseCsv(text: string): string[][] {
  const out: string[][] = []; let row: string[] = []; let f = ""; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { f += '"'; i++; } else if (c === '"') q = false; else f += c; }
    else if (c === '"') q = true; else if (c === ",") { row.push(f); f = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(f); f = ""; if (row.some((x) => x.trim())) out.push(row); row = []; }
    else f += c;
  }
  row.push(f); if (row.some((x) => x.trim())) out.push(row);
  return out;
}

export function Returns({ stats, semesters, sections, canImport, collegeCode }: { stats: Stats | null; semesters: Opt[]; sections: Opt[]; canImport: boolean; collegeCode: string }) {
  const [sem, setSem] = useState(semesters[0]?.id ?? 0);
  const [sec, setSec] = useState(sections[0]?.id ?? 0);
  const [impSem, setImpSem] = useState(semesters[0]?.id ?? 0);
  const [impKind, setImpKind] = useState<"regular" | "supplementary">("regular");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const show = (r: { ok: boolean; message?: string; error?: string }) => setMsg(r.ok ? { ok: true, text: r.message ?? "Done." } : { ok: false, text: r.error ?? "Failed." });
  return (
    <div className="space-y-4">
      {msg && <p role={msg.ok ? "status" : "alert"} className={`text-[13px] font-medium ${msg.ok ? "text-up" : "text-down"}`}>{msg.text}</p>}
      {stats && <Card>
        <CardHeader title="Counts for NAAC and AISHE" action={<Button size="sm" variant="subtle" onClick={() => saveCsv("Enrolment by programme.csv", ["Programme", "Year", "Students", "Female", "SC", "ST", "OBC", "EWS", "PwD"], stats.by_programme.map((p) => [p.programme, p.year ?? "", p.students, p.female, p.sc ?? "", p.st ?? "", p.obc ?? "", p.ews ?? "", p.pwd ?? ""]))}>Download enrolment</Button>} />
        <CardBody className="space-y-3 text-[13px]">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[["Students", stats.students], ["Teaching staff", stats.staff], ["Programmes", stats.programmes], ["Departments", stats.departments]].map(([k, v]) => (
              <div key={String(k)} className="rounded-sm border border-hair px-3 py-2"><div className="text-ink-500">{k}</div><div className="tabular text-[18px] font-semibold">{v}</div></div>))}
          </div>
          <p className="text-ink-700">By gender: {Object.entries(stats.by_gender).map(([g, n]) => `${g} ${n}`).join(", ") || "-"}</p>
          {Object.keys(stats.staff_by_title).length > 0 && <p className="text-ink-700">Staff by position: {Object.entries(stats.staff_by_title).map(([t, n]) => `${t} ${n}`).join(", ")}</p>}
          <p className="text-ink-700">By category: {list(stats.by_category)} · Persons with disability: {stats.pwd ?? 0} · Minority: {list(stats.by_minority)}</p>
          <p className="text-ink-700">By state of residence: {list(stats.by_state)}</p>
          {stats.gender_by_category && <p className="text-ink-700">Gender by category: {Object.entries(stats.gender_by_category).map(([c, g]) => `${c.toUpperCase()} (${list(g)})`).join("; ")}</p>}
          {(stats.outgoing ?? []).length > 0 && <table className="w-full"><thead><tr className="text-left text-ink-500"><th className="py-1 font-medium">Outgoing (final semester)</th><th className="py-1 font-medium">Programme</th><th className="py-1 text-right font-medium">Appeared</th><th className="py-1 text-right font-medium">Passed</th></tr></thead>
            <tbody>{stats.outgoing!.map((o, i) => <tr key={i} className="border-t border-hair"><td className="py-1">{o.year}</td><td className="py-1">{o.programme}</td><td className="tabular py-1 text-right">{o.appeared}</td><td className="tabular py-1 text-right">{o.passed}</td></tr>)}</tbody></table>}
          <p className="text-ink-700">Teachers by gender: {list(stats.staff_by_gender)} · qualification: {list(stats.staff_by_qualification)} · appointment: {list(stats.staff_by_appointment)}</p>
          {(stats.intake ?? []).length > 0 && <table className="w-full"><thead><tr className="text-left text-ink-500"><th className="py-1 font-medium">Programme</th><th className="py-1 text-right font-medium">Sanctioned intake</th><th className="py-1 text-right font-medium">Admitted (first year)</th></tr></thead>
            <tbody>{stats.intake!.map((p) => <tr key={p.programme} className="border-t border-hair"><td className="py-1">{p.programme}</td><td className="tabular py-1 text-right">{p.intake ?? "not set"}</td><td className="tabular py-1 text-right">{p.admitted}</td></tr>)}</tbody></table>}
          {(stats.final_year ?? []).length > 0 && <table className="w-full"><thead><tr className="text-left text-ink-500"><th className="py-1 font-medium">Final year</th><th className="py-1 text-right font-medium">Appeared</th><th className="py-1 text-right font-medium">Passed</th></tr></thead>
            <tbody>{stats.final_year!.map((p) => <tr key={p.programme} className="border-t border-hair"><td className="py-1">{p.programme}</td><td className="tabular py-1 text-right">{p.appeared}</td><td className="tabular py-1 text-right">{p.passed}</td></tr>)}</tbody></table>}
          <table className="w-full"><thead><tr className="text-left text-ink-500"><th className="py-1 font-medium">Programme</th><th className="py-1 font-medium">Year</th><th className="py-1 text-right font-medium">Students</th><th className="py-1 text-right font-medium">Female</th></tr></thead>
            <tbody>{stats.by_programme.map((p, i) => <tr key={i} className="border-t border-hair"><td className="py-1">{p.programme}</td><td className="py-1">{p.year ?? "-"}</td><td className="tabular py-1 text-right">{p.students}</td><td className="tabular py-1 text-right">{p.female}</td></tr>)}</tbody></table>
          {stats.pass_rates.length > 0 && <table className="w-full"><thead><tr className="text-left text-ink-500"><th className="py-1 font-medium">Semester</th><th className="py-1 text-right font-medium">Results</th><th className="py-1 text-right font-medium">Passed everything</th></tr></thead>
            <tbody>{stats.pass_rates.map((p) => <tr key={p.semester} className="border-t border-hair"><td className="py-1 capitalize">{p.semester}</td><td className="tabular py-1 text-right">{p.students}</td><td className="tabular py-1 text-right">{p.all_passed} ({p.students ? Math.round((100 * p.all_passed) / p.students) : 0}%)</td></tr>)}</tbody></table>}
        </CardBody>
      </Card>}
      <Card>
        <CardHeader title="Internal marks for the university" />
        <CardBody className="flex flex-wrap items-end gap-2 text-[13px]">
          <label>Semester<Select className="mt-1" value={sem} onChange={(e) => setSem(Number(e.target.value))}>{semesters.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</Select></label>
          <label>Section<Select className="mt-1" value={sec} onChange={(e) => setSec(Number(e.target.value))}>{sections.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</Select></label>
          <Button size="sm" disabled={pending || !sem || !sec} onClick={() => start(async () => {
            const r = await internalMarks(sem, sec); if (!r.ok) { show(r); return; }
            if (!r.rows.length) { setMsg({ ok: false, text: "No internal marks for this section yet." }); return; }
            saveCsv(`Internal marks ${sections.find((s) => s.id === sec)?.label ?? ""}.csv`, ["College code", "Admission no.", "Student", "Course code", "Course", "Internal marks", "Out of"],
              r.rows.map((x) => [collegeCode, x.admission_no, x.student_name, x.course_code, x.course_name, x.cia ?? "AB", x.cia_max ?? ""]));
            setMsg({ ok: true, text: `Downloaded ${r.rows.length} rows.` });
          })}>Download CSV</Button>
        </CardBody>
      </Card>
      {canImport && <Card>
        <CardHeader title="Bring in the university's results" />
        <CardBody className="space-y-2 text-[13px]">
          <p className="text-ink-700">A CSV with the columns <b>register_no</b> (or <b>admission_no</b>)<b>, course_code, grade, point, passed</b>. Each row sets that course&apos;s first-attempt result for the semester (an earlier one is kept in the record of changes); SGPA and CGPA are worked out again and students are told. Grade AB means absent; WH means the university withheld the result. Supplementary results are added as a new attempt for courses not yet passed (choose the semester the course belongs to); the same file twice adds nothing.</p>
          <div className="flex flex-wrap items-end gap-2">
            <label>Semester<Select className="mt-1" value={impSem} onChange={(e) => setImpSem(Number(e.target.value))}>{semesters.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</Select></label>
            <label>Results of<Select className="mt-1" aria-label="Kind of results" value={impKind} onChange={(e) => setImpKind(e.target.value as "regular" | "supplementary")}><option value="regular">The semester exam</option><option value="supplementary">A supplementary (backlog) exam</option></Select></label>
            <input type="file" accept=".csv,text/csv" aria-label="University results file" disabled={pending} onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; if (!file) return; start(async () => {
              const rows = parseCsv(await file.text()); const head = (rows.shift() ?? []).map((h) => h.trim().toLowerCase().replace(/[^a-z]+/g, "_").replace(/^_|_$/g, ""));
              const at = (k: string) => head.indexOf(k);
              if ((at("admission_no") < 0 && at("register_no") < 0) || at("course_code") < 0 || at("grade") < 0) { setMsg({ ok: false, text: "The first row must name register_no or admission_no, course_code and grade." }); return; }
              const yes = (v: string | undefined) => v == null || v.trim() === "" ? null : /^(y|yes|p|pass|passed|true|1)$/i.test(v.trim());
              const data: ImportRow[] = rows.map((r) => ({ admission_no: at("admission_no") >= 0 ? r[at("admission_no")]?.trim() || null : null, register_no: at("register_no") >= 0 ? r[at("register_no")]?.trim() || null : null, course_code: r[at("course_code")]?.trim() ?? "", grade: r[at("grade")]?.trim() ?? "",
                point: at("point") >= 0 && r[at("point")]?.trim() ? Number(r[at("point")]) : null, passed: at("passed") >= 0 ? yes(r[at("passed")]) : null }));
              show(await importUniversityResults(impSem, data, impKind));
            }); }} />
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t border-hair pt-2">
            <span className="text-ink-700">University register numbers: a CSV with <b>admission_no, register_no</b>.</span>
            <input type="file" accept=".csv,text/csv" aria-label="Register numbers file" disabled={pending} onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; if (!file) return; start(async () => {
              const rows = parseCsv(await file.text()); const head = (rows.shift() ?? []).map((h) => h.trim().toLowerCase().replace(/[^a-z]+/g, "_").replace(/^_|_$/g, ""));
              const a = head.indexOf("admission_no"), g = head.indexOf("register_no");
              if (a < 0 || g < 0) { setMsg({ ok: false, text: "The first row must name admission_no and register_no." }); return; }
              show(await setRegisterNumbers(rows.map((r) => ({ admission_no: r[a]?.trim() ?? "", register_no: r[g]?.trim() ?? "" })).filter((r) => r.admission_no)));
            }); }} />
          </div>
        </CardBody>
      </Card>}
    </div>
  );
}
