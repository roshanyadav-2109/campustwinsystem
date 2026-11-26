"use client";
import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { downloadXlsx } from "@/lib/xlsx";
import { addHostel, addRoom, allocate, moveOut, addItem, moveStock } from "@/app/dashboard/hostel/actions";
import { findStudents } from "@/app/dashboard/front-desk/actions";

export type HostelView = { id: number; name: string; kind: string; warden: string | null; rooms: { id: number; name: string; beds: number; beds_taken: { id: number; bed: number; name: string; adm: string }[] }[] };
export type ItemRow = { id: number; name: string; category: string | null; unit: string; min_stock: number; stock: number };
export type MoveRow = { id: number; kind: string; qty: number; person: string | null; note: string | null; at: string; item: { name: string; unit: string } | null };

function useAct() {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const run = (fn: () => Promise<{ ok: boolean; message?: string; error?: string }>, after?: () => void) => start(async () => {
    const r = await fn(); setMsg(r.ok ? { ok: true, text: r.message ?? "Done." } : { ok: false, text: r.error ?? "Failed." }); if (r.ok) { after?.(); router.refresh(); }
  });
  return { msg, pending, run };
}
function Msg({ m }: { m: { ok: boolean; text: string } | null }) {
  if (!m) return null;
  return <span role={m.ok ? "status" : "alert"} className={`text-[12px] font-medium ${m.ok ? "text-up" : "text-down"}`}>{m.text}</span>;
}

function Bed({ roomId, bed, taken, canEdit }: { roomId: number; bed: number; taken?: { id: number; name: string; adm: string }; canEdit: boolean }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<{ id: number; name: string; admission_no: string }[]>([]);
  const [open, setOpen] = useState(false);
  const [, startS] = useTransition();
  const { msg, pending, run } = useAct();
  return (
    <div className={`rounded-sm border p-2 text-[12px] ${taken ? "border-[#0F6CBD]/40 bg-[#EBF3FC]" : "border-hair bg-white"}`}>
      <p className="font-semibold text-ink-900">Bed {bed}</p>
      {taken ? (
        <>
          <p className="truncate">{taken.name}</p><p className="text-ink-500">{taken.adm}</p>
          {canEdit && <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => moveOut(taken.id))}>Move out</Button>}
        </>
      ) : canEdit ? (
        open ? (
          <div className="relative mt-1">
            <Input className="h-7 text-[12px]" aria-label={`Student for bed ${bed}`} placeholder="Name or adm. no." value={q} onChange={(e) => { const v = e.target.value; setQ(v); startS(async () => setHits(await findStudents(v))); }} />
            {hits.length > 0 && <ul className="absolute z-10 mt-1 w-56 rounded-sm border border-hair bg-white shadow-sm">{hits.map((h) => (
              <li key={h.id}><button className="w-full px-2 py-1 text-left hover:bg-panel" onClick={() => run(() => allocate(roomId, bed, h.id))}>{h.name} <span className="text-ink-500">{h.admission_no}</span></button></li>))}</ul>}
          </div>
        ) : <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>Assign</Button>
      ) : <p className="text-ink-500">Free</p>}
      <Msg m={msg} />
    </div>
  );
}

export function HostelDesk({ hostels, canEdit }: { hostels: HostelView[]; canEdit: boolean }) {
  const uid = useId();
  const [h, setH] = useState({ name: "", kind: "mixed", warden: "" });
  const [room, setRoom] = useState<Record<number, { name: string; beds: string }>>({});
  const { msg, pending, run } = useAct();
  return (
    <div className="space-y-4">
      {hostels.map((x) => (
        <Card key={x.id}>
          <CardHeader title={`${x.name} (${x.kind})`} action={<span className="text-[12px] text-ink-500">{x.warden ? `Warden: ${x.warden} · ` : ""}{x.rooms.reduce((n, r) => n + r.beds_taken.length, 0)} of {x.rooms.reduce((n, r) => n + r.beds, 0)} beds taken</span>} />
          <CardBody className="space-y-3">
            {x.rooms.map((r) => (
              <div key={r.id}>
                <p className="mb-1 text-[13px] font-medium">Room {r.name}</p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-6">
                  {Array.from({ length: r.beds }, (_, i) => i + 1).map((bed) => <Bed key={bed} roomId={r.id} bed={bed} taken={r.beds_taken.find((t) => t.bed === bed)} canEdit={canEdit} />)}
                </div>
              </div>
            ))}
            {canEdit && (
              <div className="flex flex-wrap items-end gap-2 border-t border-hair pt-3">
                <Field label="Room" htmlFor={`${uid}-r${x.id}`}><Input id={`${uid}-r${x.id}`} className="w-28" value={room[x.id]?.name ?? ""} onChange={(e) => setRoom({ ...room, [x.id]: { name: e.target.value, beds: room[x.id]?.beds ?? "4" } })} /></Field>
                <Field label="Beds" htmlFor={`${uid}-b${x.id}`}><Input id={`${uid}-b${x.id}`} className="w-20" inputMode="numeric" value={room[x.id]?.beds ?? "4"} onChange={(e) => setRoom({ ...room, [x.id]: { name: room[x.id]?.name ?? "", beds: e.target.value } })} /></Field>
                <Button size="sm" disabled={pending} onClick={() => run(() => addRoom(x.id, room[x.id]?.name ?? "", room[x.id]?.beds ?? "4"), () => setRoom({ ...room, [x.id]: { name: "", beds: "4" } }))}>Add room</Button>
              </div>
            )}
          </CardBody>
        </Card>
      ))}
      {canEdit && (
        <Card>
          <CardHeader title="Add a hostel" action={<Msg m={msg} />} />
          <CardBody className="flex flex-wrap items-end gap-2">
            <Field label="Name" htmlFor={`${uid}-n`}><Input id={`${uid}-n`} value={h.name} onChange={(e) => setH({ ...h, name: e.target.value })} /></Field>
            <Field label="For" htmlFor={`${uid}-k`}><Select id={`${uid}-k`} value={h.kind} onChange={(e) => setH({ ...h, kind: e.target.value })}><option value="boys">Boys</option><option value="girls">Girls</option><option value="mixed">Mixed</option></Select></Field>
            <Field label="Warden" htmlFor={`${uid}-w`}><Input id={`${uid}-w`} value={h.warden} onChange={(e) => setH({ ...h, warden: e.target.value })} /></Field>
            <Button disabled={pending} onClick={() => run(() => addHostel(h.name, h.kind, h.warden), () => setH({ name: "", kind: "mixed", warden: "" }))}>Add hostel</Button>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

export function InventoryDesk({ items, moves, canEdit }: { items: ItemRow[]; moves: MoveRow[]; canEdit: boolean }) {
  const uid = useId();
  const [it, setIt] = useState({ name: "", category: "", unit: "piece", min: "0" });
  const [mv, setMv] = useState({ item: items[0]?.id ?? 0, kind: "issued", qty: "", person: "", note: "" });
  const { msg, pending, run } = useAct();
  const low = items.filter((i) => Number(i.stock) <= Number(i.min_stock) && Number(i.min_stock) > 0);
  return (
    <div className="space-y-4">
      {low.length > 0 && <p className="rounded-sm border border-down/30 bg-[#fdf2f4] px-3 py-2 text-[13px] text-down">Running low: {low.map((i) => `${i.name} (${Number(i.stock)} ${i.unit})`).join(", ")}</p>}
      {canEdit && (
        <Card>
          <CardHeader title="Record a movement" action={<Msg m={msg} />} />
          <CardBody className="flex flex-wrap items-end gap-2">
            <Field label="Item" htmlFor={`${uid}-i`}><Select id={`${uid}-i`} value={mv.item} onChange={(e) => setMv({ ...mv, item: Number(e.target.value) })}>{items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</Select></Field>
            <Field label="What" htmlFor={`${uid}-k`}><Select id={`${uid}-k`} value={mv.kind} onChange={(e) => setMv({ ...mv, kind: e.target.value })}><option value="received">Received</option><option value="issued">Issued</option><option value="returned">Returned</option><option value="adjusted">Correction (+/-)</option></Select></Field>
            <Field label="How many" htmlFor={`${uid}-q`}><Input id={`${uid}-q`} className="w-24" inputMode="decimal" value={mv.qty} onChange={(e) => setMv({ ...mv, qty: e.target.value })} /></Field>
            <Field label="To / from" htmlFor={`${uid}-p`}><Input id={`${uid}-p`} value={mv.person} onChange={(e) => setMv({ ...mv, person: e.target.value })} /></Field>
            <Field label="Note" htmlFor={`${uid}-n`}><Input id={`${uid}-n`} value={mv.note} onChange={(e) => setMv({ ...mv, note: e.target.value })} /></Field>
            <Button disabled={pending || !mv.item} onClick={() => run(() => moveStock(mv.item, mv.kind, mv.qty, mv.person, mv.note), () => setMv({ ...mv, qty: "", person: "", note: "" }))}>Save</Button>
          </CardBody>
        </Card>
      )}
      <Card>
        <CardHeader title={`Items (${items.length})`} action={<Button size="sm" variant="subtle" onClick={() => downloadXlsx("Inventory", ["Item", "Category", "Stock", "Unit", "Minimum"], items.map((i) => [i.name, i.category ?? "", Number(i.stock), i.unit, Number(i.min_stock)]), "Stock")}>Download Excel</Button>} />
        <CardBody className="p-0">
          <table className="w-full text-[13px]"><tbody>{items.map((i) => (
            <tr key={i.id} className="border-t border-hair first:border-t-0"><td className="px-4 py-1.5 font-medium">{i.name}</td><td className="px-4 py-1.5 text-ink-700">{i.category}</td>
              <td className={`px-4 py-1.5 text-right tabular ${Number(i.stock) <= Number(i.min_stock) && Number(i.min_stock) > 0 ? "text-down" : ""}`}>{Number(i.stock)} {i.unit}</td><td className="px-4 py-1.5 text-ink-500">min {Number(i.min_stock)}</td></tr>))}
          </tbody></table>
          {canEdit && (
            <div className="flex flex-wrap items-end gap-2 border-t border-hair px-4 py-3">
              <Field label="New item" htmlFor={`${uid}-in`}><Input id={`${uid}-in`} value={it.name} onChange={(e) => setIt({ ...it, name: e.target.value })} /></Field>
              <Field label="Category" htmlFor={`${uid}-ic`}><Input id={`${uid}-ic`} value={it.category} onChange={(e) => setIt({ ...it, category: e.target.value })} /></Field>
              <Field label="Unit" htmlFor={`${uid}-iu`}><Input id={`${uid}-iu`} className="w-24" value={it.unit} onChange={(e) => setIt({ ...it, unit: e.target.value })} /></Field>
              <Field label="Warn below" htmlFor={`${uid}-im`}><Input id={`${uid}-im`} className="w-20" inputMode="numeric" value={it.min} onChange={(e) => setIt({ ...it, min: e.target.value })} /></Field>
              <Button size="sm" disabled={pending} onClick={() => run(() => addItem(it.name, it.category, it.unit, it.min), () => setIt({ name: "", category: "", unit: "piece", min: "0" }))}>Add item</Button>
            </div>
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Recent movements" />
        <CardBody className="p-0">
          <table className="w-full text-[13px]"><tbody>{moves.map((m) => (
            <tr key={m.id} className="border-t border-hair first:border-t-0"><td className="px-4 py-1.5 tabular">{new Date(m.at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
              <td className="px-4 py-1.5">{m.item?.name}</td><td className="px-4 py-1.5">{m.kind}</td><td className="px-4 py-1.5 text-right tabular">{Number(m.qty)} {m.item?.unit}</td><td className="px-4 py-1.5 text-ink-700">{m.person}</td><td className="px-4 py-1.5 text-ink-500">{m.note}</td></tr>))}
          </tbody></table>
        </CardBody>
      </Card>
    </div>
  );
}
