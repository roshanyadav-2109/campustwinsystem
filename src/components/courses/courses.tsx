"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { registerCore, chooseCourse, dropCourse, approveAll } from "@/app/dashboard/courses/actions";

export type ElectiveRow = { id: number; programme: string; semester: number; group: string; seats: number | null; code: string; name: string; used: number };
export type PendingRow = { id: number; student: string; adm: string; course: string };
export type MyCourse = { id: number; group: string | null; seats: number | null; used: number; status: string | null; code: string; name: string; kind: string; credits: number };

function useAct() {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const run = (fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) => start(async () => {
    const r = await fn(); setMsg(r.ok ? { ok: true, text: r.message ?? "Done." } : { ok: false, text: r.error ?? "Failed." }); if (r.ok) router.refresh();
  });
  return { msg, pending, run };
}
function Msg({ m }: { m: { ok: boolean; text: string } | null }) {
  if (!m) return null;
  return <span role={m.ok ? "status" : "alert"} className={`text-[13px] font-medium ${m.ok ? "text-up" : "text-down"}`}>{m.text}</span>;
}

export function CourseOffice({ semesterId, electives, pending: waiting, canEdit, canApprove = canEdit }: { semesterId: number; electives: ElectiveRow[]; pending: PendingRow[]; canEdit: boolean; canApprove?: boolean }) {
  const { msg, pending, run } = useAct();
  return (
    <div className="space-y-4">
      {canEdit && (
        <Card>
          <CardHeader title="Core courses" action={<Msg m={msg} />} />
          <CardBody className="flex flex-wrap items-center gap-3">
            <p className="text-[13px] text-ink-700">Register every student for the core courses of their semester. Running it again only adds what is missing.</p>
            <Button disabled={pending} onClick={() => run(() => registerCore(semesterId))}>Register core courses</Button>
          </CardBody>
        </Card>
      )}
      <Card>
        <CardHeader title="Electives" />
        <CardBody className="p-0">
          {electives.length === 0 ? <p className="px-4 py-3 text-[13px] text-ink-500">No electives yet. Add courses with a choice group in Settings, Programmes and courses.</p> : (
            <table className="w-full text-[13px]"><thead className="bg-[#fafafa] text-left text-ink-500"><tr><th className="px-4 py-2 font-medium">Programme</th><th className="px-4 py-2 font-medium">Sem</th><th className="px-4 py-2 font-medium">Choice group</th><th className="px-4 py-2 font-medium">Course</th><th className="px-4 py-2 text-right font-medium">Taken</th></tr></thead>
              <tbody>{electives.map((e) => (
                <tr key={e.id} className="border-t border-hair"><td className="px-4 py-1.5">{e.programme}</td><td className="px-4 py-1.5">{e.semester}</td><td className="px-4 py-1.5">{e.group}</td><td className="px-4 py-1.5">{e.code} {e.name}</td>
                  <td className={`px-4 py-1.5 text-right tabular ${e.seats != null && e.used >= e.seats ? "text-down" : ""}`}>{e.used}{e.seats != null ? ` / ${e.seats}` : ""}</td></tr>))}
              </tbody></table>
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title={`Waiting for approval (${waiting.length})`} action={canApprove && waiting.length > 0 ? <Button size="sm" disabled={pending} onClick={() => run(() => approveAll(semesterId, waiting.map((w) => w.id)))}>Approve all</Button> : undefined} />
        <CardBody className="p-0">
          {waiting.length === 0 ? <p className="px-4 py-3 text-[13px] text-ink-500">Nothing waiting.</p> : (
            <ul>{waiting.slice(0, 200).map((w) => <li key={w.id} className="border-b border-hair px-4 py-1.5 text-[13px] last:border-b-0">{w.student} <span className="text-ink-500">{w.adm}</span>: {w.course}</li>)}</ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

export function MyCourses({ semesterId, studentId, courses }: { semesterId: number; studentId: number; courses: MyCourse[] }) {
  const { msg, pending, run } = useAct();
  const core = courses.filter((c) => !c.group);
  const groups = [...new Set(courses.filter((c) => c.group).map((c) => c.group!))];
  const credits = courses.filter((c) => c.status).reduce((n, c) => n + Number(c.credits), 0);
  return (
    <div className="space-y-4">
      <p className="text-[13px] text-ink-700">{credits} credits registered. <Msg m={msg} /></p>
      <Card>
        <CardHeader title="Core courses" />
        <CardBody className="p-0">
          <table className="w-full text-[13px]"><tbody>{core.map((c) => (
            <tr key={c.id} className="border-t border-hair first:border-t-0"><td className="px-4 py-1.5 font-medium">{c.code}</td><td className="px-4 py-1.5">{c.name}</td><td className="px-4 py-1.5 text-right tabular">{Number(c.credits)} cr</td>
              <td className="px-4 py-1.5">{c.status === "approved" ? <span className="text-up">Registered</span> : c.status ? "Waiting for approval" : <span className="text-ink-500">Not yet registered by the office</span>}</td></tr>))}
          </tbody></table>
        </CardBody>
      </Card>
      {groups.map((g) => (
        <Card key={g}>
          <CardHeader title={`Choose one: ${g}`} />
          <CardBody className="p-0">
            <ul>{courses.filter((c) => c.group === g).map((c) => {
              const full = c.seats != null && c.used >= c.seats && !c.status;
              return (
                <li key={c.id} className="flex flex-wrap items-center gap-3 border-b border-hair px-4 py-2 text-[13px] last:border-b-0">
                  <span className="w-20 font-medium">{c.code}</span><span className="flex-1">{c.name} · {Number(c.credits)} credits</span>
                  <span className="text-ink-500">{c.seats != null ? `${Math.max(c.seats - c.used, 0)} seats left` : ""}</span>
                  {c.status ? <>
                    <span className="text-up">{c.status === "approved" ? "Registered" : "Chosen, waiting for approval"}</span>
                    <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => dropCourse(semesterId, studentId, c.id))}>Drop</Button></>
                    : <Button size="sm" disabled={pending || full} onClick={() => run(() => chooseCourse(semesterId, studentId, c.id))}>{full ? "Full" : "Choose"}</Button>}
                </li>
              );
            })}</ul>
          </CardBody>
        </Card>
      ))}
    </div>
  );
}
