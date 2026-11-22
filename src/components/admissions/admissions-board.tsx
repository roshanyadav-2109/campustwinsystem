"use client";
import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty";
import { Input, Select } from "@/components/ui/field";
import { StatusPill, type Status } from "@/components/ui/status";
import { ExcelIcon, PlusIcon, SearchIcon } from "@/components/icons";
import { cn } from "@/lib/utils";
import { downloadXlsx } from "@/lib/xlsx";
import { Dialog } from "@/components/students/student-form";
import { useNavigate } from "@/components/nav-progress";
import { EnquiryForm } from "@/components/admissions/enquiry-form";
import { EnquiryDetail } from "@/components/admissions/enquiry-detail";
import {
  SOURCES, SOURCE_LABEL, STATUSES, STATUS_LABEL, fmtDate, todayIso,
  type ClassRef, type Enquiry, type EnquiryStatus, type Followup, type SourceReportRow, type StaffRef,
} from "@/components/admissions/shared";

const STATUS_TONE: Record<EnquiryStatus, Status> = {
  new: "watch",
  contacted: "flat",
  visit_scheduled: "flat",
  applied: "flat",
  admitted: "up",
  not_interested: "down",
};

const stageOn = "border-[#0F6CBD] bg-[#EBF3FC]";
const stageOff = "border-hair bg-surface hover:border-[#B4D6FA]";

const pct = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : "—");

// The admissions desk: pipeline, follow-ups due, the list with filters, and a
// small report by source. The office adds and updates; the principal reads.
export function AdmissionsBoard({
  rows, total, counts, due, report, classes, staff, yearName, canEdit, detail,
}: {
  rows: Enquiry[];
  total: number;
  counts: Record<EnquiryStatus, number>;
  due: Enquiry[];
  report: SourceReportRow[];
  classes: ClassRef[];
  staff: StaffRef[];
  yearName: string;
  canEdit: boolean;
  detail: { enquiry: Enquiry; followups: Followup[] } | null;
}) {
  const router = useRouter();
  const navigate = useNavigate();
  const pathname = usePathname();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [adding, setAdding] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const status = params.get("status") ?? "";
  const classId = params.get("class") ?? "";
  const source = params.get("source") ?? "";
  const filtered = Boolean(status || classId || source || params.get("q"));
  const today = todayIso();

  function push(patch: Record<string, string>) {
    const next = new URLSearchParams(params.toString());
    for (const [k, val] of Object.entries(patch)) { if (val) next.set(k, val); else next.delete(k); }
    const qs = next.toString();
    navigate(qs ? `${pathname}?${qs}` : pathname);
  }

  function exportExcel() {
    downloadXlsx(
      `Admission enquiries ${yearName}`,
      ["Child", "Date of birth", "Class sought", "Parent or guardian", "Phone", "Email", "Address", "Previous school", "Source", "Status", "Assigned to", "Next follow-up", "Received on"],
      rows.map((r) => [
        r.childName, r.dateOfBirth ? fmtDate(r.dateOfBirth) : "", r.className, r.guardianName, r.phone, r.email ?? "", r.address ?? "",
        r.previousSchool ?? "", SOURCE_LABEL[r.source], STATUS_LABEL[r.status], r.assignedName ?? "",
        r.nextFollowUp ? fmtDate(r.nextFollowUp) : "", fmtDate(r.createdAt),
      ]),
      "Enquiries",
    );
  }

  const reportTotal = report.reduce((n, r) => n + r.total, 0);
  const reportAdmitted = report.reduce((n, r) => n + r.admitted, 0);

  return (
    <div className="space-y-5">
      {note && (
        <div role="status" className="rounded-md border border-hair bg-up-soft px-4 py-2.5 text-[13px] font-medium text-up">{note}</div>
      )}

      {/* Pipeline: one box per stage. Clicking a stage filters the list. */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7" role="group" aria-label="Enquiries by status">
        <button type="button" onClick={() => push({ status: "" })} aria-pressed={!status}
          className={cn("rounded-md border px-3 py-2.5 text-left transition-colors", !status ? stageOn : stageOff)}>
          <div className="text-[20px] font-semibold tabular text-ink-900">{total}</div>
          <div className="text-[13px] text-ink-700">All enquiries</div>
        </button>
        {STATUSES.map((s) => (
          <button key={s} type="button" onClick={() => push({ status: status === s ? "" : s })} aria-pressed={status === s}
            className={cn("rounded-md border px-3 py-2.5 text-left transition-colors", status === s ? stageOn : stageOff)}>
            <div className="text-[20px] font-semibold tabular text-ink-900">{counts[s]}</div>
            <div className="text-[13px] text-ink-700">{STATUS_LABEL[s]}</div>
          </button>
        ))}
      </div>

      <Card>
        <CardHeader
          title="Follow-ups due"
          action={<span className="text-[13px] text-ink-900 tabular">{due.length} due today or earlier</span>}
        />
        <CardBody className="py-2">
          {due.length === 0 ? (
            <p className="py-2 text-[14px] text-ink-500">No follow-ups are due.</p>
          ) : (
            <ul className="divide-y divide-hair">
              {due.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2">
                  <button type="button" onClick={() => push({ id: String(r.id) })}
                    className="text-left text-[14px] font-medium text-[#0F6CBD] hover:underline">
                    {r.childName}
                  </button>
                  <span className="text-[13px] text-ink-700">{r.className}</span>
                  <span className="text-[13px] text-ink-700">{r.guardianName} · <span className="tabular">{r.phone}</span></span>
                  <span className="text-[13px] text-ink-500">{r.assignedName ?? "Not assigned"}</span>
                  <span className={cn("ml-auto text-[13px] tabular", r.nextFollowUp! < today ? "font-semibold text-down" : "text-ink-900")}>
                    {r.nextFollowUp! < today ? `Was due ${fmtDate(r.nextFollowUp)}` : "Due today"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <div className="flex flex-wrap items-end gap-3">
        <form className="min-w-[220px] flex-1" onSubmit={(e) => { e.preventDefault(); push({ q: q.trim() }); }}>
          <label className="t-label mb-1 block" htmlFor="adm-q">Search</label>
          <div className="flex gap-2">
            <Input id="adm-q" value={q} maxLength={80} placeholder="Child, parent or phone" onChange={(e) => setQ(e.target.value)} />
            <Button type="submit" variant="subtle" aria-label="Search"><SearchIcon size={16} /></Button>
          </div>
        </form>
        <div className="min-w-[150px]">
          <label className="t-label mb-1 block" htmlFor="adm-status">Status</label>
          <Select id="adm-status" value={status} onChange={(e) => push({ status: e.target.value, q: q.trim() })}>
            <option value="">All statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </Select>
        </div>
        <div className="min-w-[130px]">
          <label className="t-label mb-1 block" htmlFor="adm-class">Class</label>
          <Select id="adm-class" value={classId} onChange={(e) => push({ class: e.target.value, q: q.trim() })}>
            <option value="">All classes</option>
            {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </div>
        <div className="min-w-[140px]">
          <label className="t-label mb-1 block" htmlFor="adm-source">Source</label>
          <Select id="adm-source" value={source} onChange={(e) => push({ source: e.target.value, q: q.trim() })}>
            <option value="">All sources</option>
            {SOURCES.map((s) => <option key={s} value={s}>{SOURCE_LABEL[s]}</option>)}
          </Select>
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button variant="subtle" onClick={exportExcel} disabled={rows.length === 0}><ExcelIcon size={18} />Download Excel</Button>
          {canEdit && (
            <Button onClick={() => { setNote(null); setAdding(true); }}><PlusIcon size={16} />Add enquiry</Button>
          )}
        </div>
      </div>

      <Card>
        <CardHeader
          title={`Enquiries · ${yearName}`}
          action={
            <span className="text-[13px] text-ink-900 tabular">
              {filtered ? `${rows.length} of ${total}` : `${total} ${total === 1 ? "enquiry" : "enquiries"}`}
            </span>
          }
        />
        <CardBody className="overflow-x-auto">
          {rows.length === 0 ? (
            <EmptyState
              art={filtered ? "no-results" : "nothing-yet"}
              title={filtered ? "No enquiries match" : "No enquiries yet"}
              hint={filtered ? "Try a different search, or clear the filters." : canEdit ? "Use Add enquiry to record a walk-in or a phone call. Online applications appear here on their own." : "Enquiries recorded by the office appear here."}
            />
          ) : (
            <table className="w-full min-w-[980px] text-[14px]">
              <thead>
                <tr className="text-left text-[13px] text-ink-700">
                  <th className="py-2 pr-3 font-semibold">Child</th>
                  <th className="py-2 pr-3 font-semibold">Class sought</th>
                  <th className="py-2 pr-3 font-semibold">Parent or guardian</th>
                  <th className="py-2 pr-3 font-semibold">Phone</th>
                  <th className="py-2 pr-3 font-semibold">Source</th>
                  <th className="py-2 pr-3 font-semibold">Status</th>
                  <th className="py-2 pr-3 font-semibold">Assigned to</th>
                  <th className="py-2 pr-3 font-semibold">Next follow-up</th>
                  <th className="py-2 font-semibold">Received on</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-panel">
                    <td className="py-2 pr-3">
                      <button type="button" onClick={() => push({ id: String(r.id) })}
                        className="text-left font-medium text-[#0F6CBD] hover:underline">
                        {r.childName}
                      </button>
                    </td>
                    <td className="py-2 pr-3 text-ink-900">{r.className}</td>
                    <td className="py-2 pr-3 text-ink-900">{r.guardianName}</td>
                    <td className="py-2 pr-3 tabular text-ink-900">{r.phone}</td>
                    <td className="py-2 pr-3 text-ink-900">{SOURCE_LABEL[r.source]}</td>
                    <td className="py-2 pr-3"><StatusPill status={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</StatusPill></td>
                    <td className="py-2 pr-3 text-ink-900">{r.assignedName ?? "—"}</td>
                    <td className="py-2 pr-3 tabular text-ink-900">{fmtDate(r.nextFollowUp)}</td>
                    <td className="py-2 tabular text-ink-900">{fmtDate(r.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader eyebrow="Source and conversion" title={`All enquiries · ${yearName}`} />
        <CardBody className="overflow-x-auto">
          <table className="w-full max-w-xl text-[14px]">
            <thead>
              <tr className="text-left text-[13px] text-ink-700">
                <th className="py-2 pr-3 font-semibold">Source</th>
                <th className="py-2 pr-3 text-right font-semibold">Enquiries</th>
                <th className="py-2 pr-3 text-right font-semibold">Admitted</th>
                <th className="py-2 text-right font-semibold">Conversion</th>
              </tr>
            </thead>
            <tbody>
              {report.map((r) => (
                <tr key={r.source}>
                  <td className="py-1.5 pr-3 text-ink-900">{SOURCE_LABEL[r.source]}</td>
                  <td className="py-1.5 pr-3 text-right tabular text-ink-900">{r.total}</td>
                  <td className="py-1.5 pr-3 text-right tabular text-ink-900">{r.admitted}</td>
                  <td className="py-1.5 text-right tabular text-ink-900">{pct(r.admitted, r.total)}</td>
                </tr>
              ))}
              <tr className="border-t border-hair font-semibold">
                <td className="py-2 pr-3 text-ink-900">Total</td>
                <td className="py-2 pr-3 text-right tabular text-ink-900">{reportTotal}</td>
                <td className="py-2 pr-3 text-right tabular text-ink-900">{reportAdmitted}</td>
                <td className="py-2 text-right tabular text-ink-900">{pct(reportAdmitted, reportTotal)}</td>
              </tr>
            </tbody>
          </table>
        </CardBody>
      </Card>

      {adding && canEdit && (
        <Dialog title="Add enquiry" onClose={() => setAdding(false)}>
          <EnquiryForm
            classes={classes}
            staff={staff}
            onCancel={() => setAdding(false)}
            onDone={() => { setAdding(false); setNote("Enquiry added."); router.refresh(); }}
          />
        </Dialog>
      )}

      {detail && !adding && (
        <Dialog title={detail.enquiry.childName} onClose={() => push({ id: "" })}>
          <EnquiryDetail
            key={detail.enquiry.id}
            enquiry={detail.enquiry}
            followups={detail.followups}
            staff={staff}
            canEdit={canEdit}
            onSaved={() => router.refresh()}
          />
        </Dialog>
      )}
    </div>
  );
}
