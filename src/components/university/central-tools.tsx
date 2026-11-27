"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { campusSections, copyCatalogue, transferStudent } from "@/app/dashboard/university/actions";

type Campus = { id: number; name: string };
export type ExamRow = { campus_id: number; campus: string; exams_this_year: number; results_published: number; malpractice_open: number; scripts_pending: number; revaluations_open: number; supplementary_waiting: number };
export type TransferRow = { id: number; done_at: string; carried: number; not_carried: string | null; from_school: number; to_school: number; to_student: { full_name: string; admission_no: string } | null };

export function CentralTools({ campuses, exams, transfers }: { campuses: Campus[]; exams: ExamRow[]; transfers: TransferRow[] }) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const [cFrom, setCFrom] = useState(campuses[0]?.id ?? 0);
  const [cTo, setCTo] = useState(campuses[1]?.id ?? 0);
  const [tFrom, setTFrom] = useState(campuses[0]?.id ?? 0);
  const [tTo, setTTo] = useState(campuses[1]?.id ?? 0);
  const [adm, setAdm] = useState("");
  const [note, setNote] = useState("");
  const [secs, setSecs] = useState<{ id: number; label: string }[]>([]);
  const [sec, setSec] = useState(0);
  const name = (id: number) => campuses.find((c) => c.id === id)?.name ?? "";
  const show = (r: { ok: boolean; message?: string; error?: string }) => setMsg(r.ok ? { ok: true, text: r.message ?? "Done." } : { ok: false, text: r.error ?? "Failed." });
  const loadSecs = (to: number) => start(async () => { const s = await campusSections(to); setSecs(s); setSec(s[0]?.id ?? 0); });
  const opts = campuses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>);
  return (
    <div className="mt-6 space-y-4">
      {msg && <p role={msg.ok ? "status" : "alert"} className={`text-[13px] font-medium ${msg.ok ? "text-up" : "text-down"}`}>{msg.text}</p>}
      <Card>
        <CardHeader title="Exam cell across campuses" />
        <CardBody className="overflow-x-auto p-0">
          <table className="w-full text-[13px]"><thead><tr className="text-left text-ink-500">
            {["Campus", "Exams this year", "Results published", "Malpractice open", "Scripts not decoded", "Revaluations open", "Supplementary waiting"].map((h, i) => <th key={h} className={`px-4 py-2 font-medium ${i ? "text-right" : ""}`}>{h}</th>)}</tr></thead>
            <tbody>{exams.map((e) => (
              <tr key={e.campus_id} className="border-t border-hair"><td className="px-4 py-2">{e.campus}</td>
                {[e.exams_this_year, e.results_published, e.malpractice_open, e.scripts_pending, e.revaluations_open, e.supplementary_waiting].map((v, i) => <td key={i} className={`tabular px-4 py-2 text-right ${i >= 2 && v > 0 ? "font-semibold text-down" : ""}`}>{v}</td>)}</tr>))}</tbody></table>
        </CardBody>
      </Card>
      {campuses.length > 1 && <Card>
        <CardHeader title="Transfer a student between campuses" />
        <CardBody className="space-y-2 text-[13px]">
          <p className="text-ink-700">Grades and CGPA carry over where the new campus has the same course code and semester. Parents and the student keep their logins. Fees due must be cleared first.</p>
          <div className="flex flex-wrap items-end gap-2">
            <label>From<Select aria-label="Transfer from campus" className="mt-1" value={tFrom} onChange={(e) => setTFrom(Number(e.target.value))}>{opts}</Select></label>
            <label>Admission number<Input aria-label="Admission number" className="mt-1 w-40" value={adm} onChange={(e) => setAdm(e.target.value)} /></label>
            <label>To<Select aria-label="Transfer to campus" className="mt-1" value={tTo} onChange={(e) => { const v = Number(e.target.value); setTTo(v); setSecs([]); setSec(0); }}>{opts}</Select></label>
            {secs.length ? <label>Section<Select aria-label="Section at the new campus" className="mt-1" value={sec} onChange={(e) => setSec(Number(e.target.value))}>{secs.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</Select></label>
              : <Button size="sm" variant="subtle" disabled={pending || tFrom === tTo} onClick={() => loadSecs(tTo)}>Choose section</Button>}
            <label>Reason<Input aria-label="Reason" className="mt-1 w-56" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} /></label>
            <Button size="sm" disabled={pending || !sec || tFrom === tTo} onClick={() => start(async () => { const r = await transferStudent(tFrom, adm, tTo, sec, note); show(r); if (r.ok) { setAdm(""); setNote(""); router.refresh(); } })}>Transfer</Button>
          </div>
          {transfers.length > 0 && <ul className="mt-2 space-y-1 text-ink-700">{transfers.map((t) => (
            <li key={t.id}>{t.done_at.slice(0, 10).split("-").reverse().join("/")}: {t.to_student?.full_name ?? ""} ({t.to_student?.admission_no ?? ""}), {name(t.from_school)} to {name(t.to_school)}, {t.carried} results carried{t.not_carried ? `; not carried: ${t.not_carried}` : ""}</li>))}</ul>}
        </CardBody>
      </Card>}
      {campuses.length > 1 && <Card>
        <CardHeader title="Shared catalogue" />
        <CardBody className="flex flex-wrap items-end gap-2 text-[13px]">
          <p className="w-full text-ink-700">Copy the departments, courses and programmes one campus has and another lacks (matched by code). Nothing already there is changed.</p>
          <label>From<Select aria-label="Copy from campus" className="mt-1" value={cFrom} onChange={(e) => setCFrom(Number(e.target.value))}>{opts}</Select></label>
          <label>To<Select aria-label="Copy to campus" className="mt-1" value={cTo} onChange={(e) => setCTo(Number(e.target.value))}>{opts}</Select></label>
          <Button size="sm" disabled={pending || cFrom === cTo} onClick={() => start(async () => show(await copyCatalogue(cFrom, cTo)))}>Copy</Button>
        </CardBody>
      </Card>}
    </div>
  );
}
