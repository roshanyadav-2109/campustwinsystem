"use client";
import { useState, useTransition } from "react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Select } from "@/components/ui/field";
import { positionHistory } from "@/app/dashboard/settings/positions/actions";

const dmy = (d: string | null) => (d ? d.split("-").reverse().join("/") : "");

// One person's positions over time (for service records and NAAC).
export function PositionHistory({ staff }: { staff: { id: number; name: string }[] }) {
  const [who, setWho] = useState(0);
  const [rows, setRows] = useState<Awaited<ReturnType<typeof positionHistory>>>([]);
  const [pending, start] = useTransition();
  return (
    <Card>
      <CardHeader title="Position history" />
      <CardBody className="space-y-2 text-[13px]">
        <Select aria-label="Person for position history" className="h-9 w-72" value={who} disabled={pending} onChange={(e) => { const id = Number(e.target.value); setWho(id); start(async () => setRows(id ? await positionHistory(id) : [])); }}>
          <option value={0}>Choose a person</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
        {who > 0 && (rows.length === 0 ? <p className="text-ink-500">No positions on record.</p> : (
          <ul className="space-y-1">{rows.map((r) => (
            <li key={r.id}><b>{r.title?.name ?? "Position"}</b>{r.acting ? " (acting)" : ""}{[r.programme?.name, r.department?.name, r.unit?.name].filter(Boolean).length ? `, ${[r.programme?.name, r.department?.name, r.unit?.name].filter(Boolean).join(", ")}` : ""}
              <span className="text-ink-500"> from {dmy(r.starts_on)}{r.ends_on ? ` to ${dmy(r.ends_on)}` : ", current"}</span></li>))}</ul>))}
      </CardBody>
    </Card>
  );
}
