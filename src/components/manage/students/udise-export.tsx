"use client";
import { useState, useTransition } from "react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { downloadWorkbook } from "@/lib/xlsx";
import { udiseRows, type UdiseRow } from "@/app/dashboard/students/manage/udise-actions";

const yn = (v: boolean | null) => (v == null ? "" : v ? "Yes" : "No");
const dmy = (v: string | null) => (v ? v.split("-").reverse().join("/") : "");

// UDISE+ student data: check what is missing, then download in the portal's order.
export function UdiseExport({ sections }: { sections: { id: number; label: string }[] }) {
  const [sectionId, setSectionId] = useState<number | "">("");
  const [summary, setSummary] = useState<{ total: number; missing: { name: string; cls: string; what: string[] }[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const run = (download: boolean) => start(async () => {
    setErr(null);
    const r = await udiseRows(sectionId === "" ? null : sectionId);
    if (!r.ok) { setErr(r.error); return; }
    const missing = r.rows.filter((x) => x.missing.length).map((x) => ({ name: x.student_name, cls: `${x.class_name}-${x.section_name}`, what: x.missing }));
    setSummary({ total: r.rows.length, missing });
    if (!download) return;
    const headers = ["Admission No", "Student Name", "Name as per Aadhaar", "Gender", "Date of Birth", "Class", "Section", "Roll No", "Date of Admission", "Mother's Name", "Father's Name",
      "Guardian's Name", "Mobile Number", "Email", "Address", "Pincode", "Mother Tongue", "Social Category", "Religion", "BPL", "CWSN", "CWSN Type",
      "APAAR ID", "PEN", "Aadhaar (last 4)", "Blood Group", "Previous School", "Nationality",
      "Minority Group", "AAY", "EWS / Disadvantaged", "Type of Impairment", "UDID", "Admitted under RTE", "Height (cm)", "Weight (kg)", "Medium of Instruction", "Stream",
      "Previous Year Result", "Previous Year %", "Days Attended Last Year", "Facilities Received"];
    const cap = (v: string | null) => (v ? v.charAt(0).toUpperCase() + v.slice(1).replace(/_/g, " ") : "");
    const data = r.rows.map((x: UdiseRow) => [x.admission_no, x.student_name, x.aadhaar_name ?? "", x.gender ?? "", dmy(x.dob), x.class_name, x.section_name, x.roll_no ?? "", dmy(x.admission_date),
      x.mother_name ?? "", x.father_name ?? "", x.guardian_name ?? "", x.mobile ?? "", x.email ?? "", x.address ?? "", x.pincode ?? "", x.mother_tongue ?? "",
      x.social_category ?? "", x.religion ?? "", yn(x.bpl), yn(x.cwsn), x.cwsn_note ?? "", x.apaar_id ?? "", x.pen ?? "", x.aadhaar_last4 ?? "", x.blood_group ?? "",
      x.previous_school ?? "", x.nationality ?? "", cap(x.minority), yn(x.aay), yn(x.disadvantaged), x.disability_type ?? "", x.udid_no ?? "", yn(x.rte_admission),
      x.height_cm ?? "", x.weight_kg ?? "", x.medium ?? "", cap(x.stream), cap(x.prev_result), x.prev_percent ?? "", x.prev_attendance_days ?? "",
      (x.facilities ?? []).map((f) => cap(f)).join(", ")]);
    downloadWorkbook(`UDISE+ students${sectionId === "" ? "" : ` ${sections.find((s) => s.id === sectionId)?.label ?? ""}`}`, [
      { name: "Students", headers, rows: data },
      { name: "Missing details", headers: ["Student", "Class", "Missing"], rows: missing.map((m) => [m.name, m.cls, m.what.join(", ")]) },
    ]);
  });
  return (
    <Card>
      <CardHeader title="UDISE+ student data" />
      <CardBody className="space-y-2">
        <p className="text-[13px] text-ink-700">Download the students with the fields the UDISE+ portal asks for, and a list of details still missing. Aadhaar appears only as its last four digits; last year's result and days attended come from this school's records when not entered.</p>
        <div className="flex flex-wrap items-center gap-2">
          <Select className="h-9 w-44 text-[13px]" aria-label="Section for UDISE+" value={sectionId} onChange={(e) => setSectionId(e.target.value ? Number(e.target.value) : "")}>
            <option value="">Whole school</option>{sections.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</Select>
          <Button size="sm" variant="subtle" disabled={pending} onClick={() => run(false)}>Check what is missing</Button>
          <Button size="sm" disabled={pending} onClick={() => run(true)}>{pending ? "Preparing…" : "Download Excel"}</Button>
        </div>
        {err && <p role="alert" className="text-[13px] font-medium text-down">{err}</p>}
        {summary && (
          <div className="text-[13px]">
            <p className={summary.missing.length ? "text-down" : "text-up"}>{summary.total} students; {summary.missing.length ? `${summary.missing.length} have details missing.` : "nothing is missing."}</p>
            {summary.missing.length > 0 && (
              <ul className="mt-1 max-h-48 overflow-auto rounded-sm border border-hair text-[12px]">
                {summary.missing.slice(0, 100).map((m, i) => <li key={i} className="border-b border-hair px-3 py-1 last:border-b-0">{m.name} ({m.cls}): {m.what.join(", ")}</li>)}
                {summary.missing.length > 100 && <li className="px-3 py-1 text-ink-500">and {summary.missing.length - 100} more (all are in the Excel, sheet Missing details)</li>}
              </ul>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  );
}
