"use client";
import { useEffect, useState, useTransition } from "react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { incomingTransfers, answerTransfer, setTransferFee } from "@/app/dashboard/students/[id]/photo-actions";

// At a campus of a university: students asking to move here (agree when there is a seat), and this campus's transfer fee.
export function IncomingTransfers({ fee }: { fee: number | null }) {
  const [rows, setRows] = useState<Awaited<ReturnType<typeof incomingTransfers>>>([]);
  const [note, setNote] = useState<Record<number, string>>({});
  const [feeV, setFeeV] = useState(fee == null ? "" : String(Number(fee)));
  const [msg, setMsg] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [pending, start] = useTransition();
  useEffect(() => { void incomingTransfers().then((r) => { setRows(r); setLoaded(true); }); }, []);
  if (!loaded) return null;
  return (
    <Card>
      <CardHeader title="Campus transfers" />
      <CardBody className="space-y-2 text-[13px]">
        {rows.length === 0 ? <p className="text-ink-500">No students are asking to move to this campus.</p> : rows.map((r) => (
          <div key={r.id} className="flex flex-wrap items-center gap-2 border-t border-hair pt-1"><b>{r.student_name}</b> from {r.from_campus}{r.programme ? `, ${r.programme}` : ""}{r.reason ? `: ${r.reason}` : ""}
            {r.receiving_ok === true ? <span className="text-up">agreed</span> : r.receiving_ok === false ? <span className="text-down">declined</span> : null}
            <Input className="h-8 w-48 text-[12px]" aria-label={`Note on ${r.student_name}`} placeholder="Note (seats, intake)" value={note[r.id] ?? ""} onChange={(e) => setNote({ ...note, [r.id]: e.target.value })} />
            <Button size="sm" disabled={pending} onClick={() => start(async () => { const x = await answerTransfer(r.id, true, note[r.id] ?? ""); setMsg(x.ok ? x.message : x.error); setRows(await incomingTransfers()); })}>Agree</Button>
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(async () => { const x = await answerTransfer(r.id, false, note[r.id] ?? ""); setMsg(x.ok ? x.message : x.error); setRows(await incomingTransfers()); })}>Decline</Button></div>))}
        <label className="flex items-center gap-2 border-t border-hair pt-2">Fee for leaving this campus on transfer (Rs)<Input className="h-8 w-24" aria-label="Campus transfer fee" inputMode="decimal" value={feeV} onChange={(e) => setFeeV(e.target.value)} />
          <Button size="sm" variant="subtle" disabled={pending} onClick={() => start(async () => { const x = await setTransferFee(feeV); setMsg(x.ok ? x.message : x.error); })}>Save</Button></label>
        {msg && <p className="text-[12px] text-ink-700">{msg}</p>}
      </CardBody>
    </Card>
  );
}
