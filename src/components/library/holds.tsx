"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { holdBook, cancelHold, collectHold, findBooks, saveLink, removeLink } from "@/app/dashboard/library/hold-actions";

type Msg = { ok: boolean; text: string } | null;
const Note = ({ m }: { m: Msg }) => (m ? <p role={m.ok ? "status" : "alert"} className={`text-[13px] font-medium ${m.ok ? "text-up" : "text-down"}`}>{m.text}</p> : null);
export type HoldRow = { id: number; status: string; created_at: string; ready_at: string | null; book: { title: string; author: string } | null; student?: { full_name: string } | null };
export type LinkRow = { id: number; kind: string; title: string; url: string; note: string | null };
const KIND: Record<string, string> = { ebook: "E-books", journal: "Journals", video: "Lecture videos", lab: "Virtual labs", database: "Databases", other: "Other links" };
const STATUS: Record<string, string> = { waiting: "Waiting for a copy", ready: "Ready: collect within 3 days", collected: "Collected", cancelled: "Cancelled" };

// The student: find a book that is out and reserve it; the reservations.
export function MyHolds({ holds }: { holds: HoldRow[] }) {
  const [q, setQ] = useState("");
  const [found, setFound] = useState<{ id: number; title: string; author: string; free: number }[] | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <div className="space-y-4 text-[13px]">
      <Note m={msg} />
      <Card><CardHeader title="Reserve a book that is out" /><CardBody className="space-y-2">
        <div className="flex gap-2"><Input className="h-8 w-72" aria-label="Book title or author" placeholder="Title or author" value={q} onChange={(e) => setQ(e.target.value)} />
          <Button size="sm" disabled={pending || q.trim().length < 2} onClick={() => start(async () => setFound(await findBooks(q)))}>Find</Button></div>
        {found && (found.length === 0 ? <p className="text-ink-500">No books found.</p> : <ul className="space-y-1">{found.map((b) => (
          <li key={b.id} className="flex items-center gap-2"><span><b>{b.title}</b> <span className="text-ink-500">{b.author}</span></span>
            {b.free > 0 ? <span className="text-up">{b.free} on the shelf</span> : <Button size="sm" variant="subtle" disabled={pending} onClick={() => start(async () => { const r = await holdBook(b.id); setMsg(r.ok ? { ok: true, text: r.message ?? "" } : { ok: false, text: r.error }); router.refresh(); })}>Reserve</Button>}</li>))}</ul>)}
      </CardBody></Card>
      <Card><CardHeader title="My reservations" /><CardBody className="p-0">{holds.length === 0 ? <p className="px-4 py-3 text-ink-500">No reservations.</p> : (
        <table className="w-full"><tbody>{holds.map((h) => (
          <tr key={h.id} className="border-t border-hair first:border-t-0"><td className="px-4 py-1.5"><b>{h.book?.title}</b> <span className="text-ink-500">{h.book?.author}</span></td>
            <td className={`px-2 py-1.5 ${h.status === "ready" ? "font-medium text-up" : ""}`}>{STATUS[h.status]}</td>
            <td className="px-4 py-1.5 text-right">{["waiting", "ready"].includes(h.status) && <button type="button" className="text-[12px] text-ink-500 hover:text-down" onClick={() => start(async () => { const r = await cancelHold(h.id); setMsg(r.ok ? { ok: true, text: "Cancelled." } : { ok: false, text: r.error }); router.refresh(); })}>cancel</button>}</td></tr>))}</tbody></table>)}
      </CardBody></Card>
    </div>
  );
}

// The library desk: reservations waiting and ready.
export function HoldsDesk({ holds }: { holds: HoldRow[] }) {
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Card><CardHeader title="Reservations" /><CardBody className="space-y-1.5 text-[13px]">
      <Note m={msg} />
      {holds.length === 0 ? <p className="text-ink-500">No reservations.</p> : holds.map((h) => (
        <div key={h.id} className="flex flex-wrap items-center gap-2"><b>{h.book?.title}</b><span className="text-ink-500">for {h.student?.full_name}</span>
          <span className={h.status === "ready" ? "text-up" : "text-ink-700"}>{STATUS[h.status]}</span>
          {h.status === "ready" && <Button size="sm" disabled={pending} onClick={() => start(async () => { const r = await collectHold(h.id); setMsg(r.ok ? { ok: true, text: "Marked collected; issue the book as usual." } : { ok: false, text: r.error }); router.refresh(); })}>Collected</Button>}
          <button type="button" className="text-[12px] text-ink-500 hover:text-down" onClick={() => start(async () => { const r = await cancelHold(h.id); setMsg(r.ok ? { ok: true, text: "Cancelled." } : { ok: false, text: r.error }); router.refresh(); })}>cancel</button></div>))}
    </CardBody></Card>
  );
}

// The digital library: links grouped by kind; the library adds and removes them.
export function DigitalLibrary({ links, canEdit }: { links: LinkRow[]; canEdit: boolean }) {
  const [f, setF] = useState({ kind: "ebook", title: "", url: "", note: "" });
  const [msg, setMsg] = useState<Msg>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const groups = Object.keys(KIND).filter((k) => links.some((l) => l.kind === k));
  return (
    <div className="space-y-4 text-[13px]">
      <Note m={msg} />
      {groups.length === 0 && <p className="text-ink-500">No digital resources yet.</p>}
      {groups.map((k) => (
        <Card key={k}><CardHeader title={KIND[k]} /><CardBody className="space-y-1">{links.filter((l) => l.kind === k).map((l) => (
          <p key={l.id} className="flex items-center gap-2"><a href={l.url} target="_blank" rel="noopener noreferrer" className="font-medium text-[#0F6CBD] hover:underline">{l.title}</a>{l.note && <span className="text-ink-500">{l.note}</span>}
            {canEdit && <button type="button" className="text-[12px] text-ink-500 hover:text-down" onClick={() => start(async () => { const r = await removeLink(l.id); setMsg(r.ok ? { ok: true, text: "Removed." } : { ok: false, text: r.error }); router.refresh(); })}>remove</button>}</p>))}</CardBody></Card>))}
      {canEdit && <Card><CardHeader title="Add a resource" /><CardBody className="flex flex-wrap items-end gap-2">
        <Select className="h-8 w-40" aria-label="Kind of resource" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{Object.entries(KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
        <Input className="h-8 w-56" aria-label="Resource title" placeholder="Title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        <Input className="h-8 w-72" aria-label="Resource link" placeholder="https://…" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} />
        <Input className="h-8 w-56" aria-label="Resource note" placeholder="Note (e.g. log in with your college email)" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
        <Button size="sm" disabled={pending || !f.title.trim() || !f.url.trim()} onClick={() => start(async () => { const r = await saveLink(f.kind, f.title, f.url, f.note); setMsg(r.ok ? { ok: true, text: "Added." } : { ok: false, text: r.error }); if (r.ok) { setF({ ...f, title: "", url: "", note: "" }); router.refresh(); } })}>Add</Button>
      </CardBody></Card>}
    </div>
  );
}
