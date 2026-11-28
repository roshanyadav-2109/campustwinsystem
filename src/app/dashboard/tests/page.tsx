import Link from "@/components/ui/hover-link";
import { guardTab } from "@/lib/access";
import { getSession, getCurrentYear } from "@/lib/session";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { TestBuilder, TakeTest, Review, type Pair } from "@/components/tests/tests";
import { when } from "@/lib/when";
import type { TestIn } from "@/app/dashboard/tests/actions";

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

// Online tests and quizzes: teachers set them; students take them in the set time; marks follow.
export default async function TestsPage({ searchParams }: { searchParams: SP }) {
  const denied = await guardTab("/dashboard/tests");
  if (denied) return denied;
  const [session, year, sp] = await Promise.all([getSession(), getCurrentYear(), searchParams]);
  if (!session || !year) return null;
  const supabase = await createClient();

  // ---------- students ----------
  if (session.role === "student") {
    const take = Number(one(sp.take)) || 0, review = Number(one(sp.review)) || 0;
    if (take) return <div className="mx-auto max-w-3xl space-y-3"><PageHeader title="Test" /><TakeTest testId={take} /></div>;
    if (review) return <div className="mx-auto max-w-3xl space-y-3"><PageHeader title="Your answers" /><Link href="/dashboard/tests" className="text-[13px] text-[#0F6CBD] hover:underline">Back to tests</Link><Review attemptId={review} canMark={false} /></div>;
    const { data } = await supabase.rpc("my_tests" as never);
    const rows = (data ?? []) as unknown as { id: number; title: string; subject: string; opens_at: string; closes_at: string; minutes: number; attempts: number; used: number; open_attempt: number | null; best: number | null; total: number; to_mark: number; can_review: boolean }[];
    const now = Date.now();
    const { data: lastAtt } = rows.length ? await supabase.rpc("my_test_attempts" as never) : { data: [] };
    const lastOf = new Map(((lastAtt ?? []) as unknown as { test_id: number; attempt_id: number }[]).map((x) => [x.test_id, x.attempt_id]));
    return (
      <div className="space-y-4">
        <PageHeader title="Tests" description="Tests and quizzes from your teachers. The time starts when you open a test; answers are saved as you choose them." />
        <Card><CardBody className="p-0">{rows.length === 0 ? <p className="px-4 py-3 text-[13px] text-ink-500">No tests yet.</p> : (
          <table className="w-full text-[13px]"><tbody>{rows.map((t) => {
            const open = now >= new Date(t.opens_at).getTime() && now <= new Date(t.closes_at).getTime();
            const canStart = open && (t.open_attempt || t.used < t.attempts);
            return (
              <tr key={t.id} className="border-t border-hair first:border-t-0">
                <td className="px-4 py-2"><b>{t.title}</b><span className="block text-[12px] text-ink-500">{t.subject} · {t.minutes} min · {when(t.opens_at)} to {when(t.closes_at)}</span></td>
                <td className="px-2 py-2 tabular">{t.best != null ? `${Number(t.best)} / ${Number(t.total)}${t.to_mark ? " (marking)" : ""}` : ""}</td>
                <td className="px-4 py-2 text-right">{canStart ? <Link href={`?take=${t.id}`} className="font-medium text-[#0F6CBD] hover:underline">{t.open_attempt ? "Continue" : "Start"}</Link>
                  : now < new Date(t.opens_at).getTime() ? <span className="text-ink-500">opens {when(t.opens_at)}</span>
                  : lastOf.get(t.id) ? <Link href={`?review=${lastOf.get(t.id)}`} className="text-[#0F6CBD] hover:underline">{t.can_review ? "See answers" : "See score"}</Link> : <span className="text-ink-500">closed</span>}</td>
              </tr>); })}</tbody></table>)}
        </CardBody></Card>
      </div>
    );
  }

  // ---------- teachers ----------
  const q = supabase.from("teacher_allotment").select("section_id, subject_id, section:section_id(name, class:class_id(name)), subject:subject_id(name)").eq("academic_year_id", year.id).not("subject_id", "is", null);
  const { data: al } = session.isAdminScope ? await q.limit(2000) : await q.eq("staff_id", session.staffId ?? 0);
  const pairs: Pair[] = [...new Map(((al ?? []) as unknown as { section_id: number; subject_id: number; section: { name: string; class: { name: string } | null } | null; subject: { name: string } | null }[])
    .map((r) => [`${r.section_id}:${r.subject_id}`, { section_id: r.section_id, subject_id: r.subject_id, label: `${r.section?.class?.name ?? ""}-${r.section?.name ?? ""}`, subject: r.subject?.name ?? "" }])).values()];
  const edit = Number(one(sp.edit)) || 0, results = Number(one(sp.results)) || 0, attempt = Number(one(sp.attempt)) || 0;
  if (one(sp.new) || edit) {
    const { data: t } = edit ? await supabase.rpc("test_for_teacher" as never, { p_id: edit } as never) : { data: null };
    return (<div className="space-y-3"><PageHeader title={edit ? "Edit test" : "New test"} /><Link href="/dashboard/tests" className="text-[13px] text-[#0F6CBD] hover:underline">Back to tests</Link>
      <TestBuilder key={edit || "new"} pairs={pairs} initial={(t ?? null) as unknown as (TestIn & { id: number; locked: boolean; published: boolean }) | null} /></div>);
  }
  if (attempt) return (<div className="mx-auto max-w-3xl space-y-3"><PageHeader title="Answers" /><Link href={`?results=${results}`} className="text-[13px] text-[#0F6CBD] hover:underline">Back to results</Link><Review attemptId={attempt} canMark /></div>);
  if (results) {
    const { data } = await supabase.rpc("test_results" as never, { p_test: results } as never);
    const rows = (data ?? []) as unknown as { attempt_id: number; student_name: string; section: string | null; attempt_no: number; submitted_at: string | null; score: number | null; to_mark: number; total: number }[];
    return (
      <div className="space-y-3"><PageHeader title="Results" /><Link href="/dashboard/tests" className="text-[13px] text-[#0F6CBD] hover:underline">Back to tests</Link>
        <Card><CardBody className="p-0">{rows.length === 0 ? <p className="px-4 py-3 text-[13px] text-ink-500">Nobody has taken it yet.</p> : (
          <table className="w-full text-[13px]"><tbody>{rows.map((r) => (
            <tr key={r.attempt_id} className="border-t border-hair first:border-t-0">
              <td className="px-4 py-1.5 font-medium">{r.student_name}</td><td className="px-2 py-1.5 text-ink-500">{r.section}{r.attempt_no > 1 ? ` · attempt ${r.attempt_no}` : ""}</td>
              <td className="px-2 py-1.5 tabular">{r.submitted_at ? `${Number(r.score ?? 0)} / ${Number(r.total)}` : "in progress"}</td>
              <td className="px-4 py-1.5 text-right">{r.to_mark ? <Link href={`?results=${results}&attempt=${r.attempt_id}`} className="font-medium text-[#0F6CBD] hover:underline">Mark {r.to_mark} written</Link>
                : r.submitted_at ? <Link href={`?results=${results}&attempt=${r.attempt_id}`} className="text-[#0F6CBD] hover:underline">Answers</Link> : null}</td>
            </tr>))}</tbody></table>)}</CardBody></Card></div>);
  }
  const { data: mine } = await supabase.rpc("my_set_tests" as never);
  const tests = (mine ?? []) as unknown as { id: number; title: string; subject: string; sections: string; opens_at: string; closes_at: string; published: boolean; attempts: number; to_mark: number }[];
  return (
    <div className="space-y-4">
      <PageHeader title="Tests" description="Set online tests and quizzes for your sections: choices, true or false, numbers and short answers. Choices are marked at once; you mark the written answers." />
      {pairs.length > 0 && <Link href="?new=1" className="inline-block rounded-sm bg-ink-900 px-3 py-1.5 text-[13px] font-medium text-white">New test</Link>}
      <Card><CardHeader title="Your tests" /><CardBody className="p-0">{tests.length === 0 ? <p className="px-4 py-3 text-[13px] text-ink-500">No tests yet.</p> : (
        <table className="w-full text-[13px]"><tbody>{tests.map((t) => (
          <tr key={t.id} className="border-t border-hair first:border-t-0">
            <td className="px-4 py-2"><b>{t.title}</b><span className="block text-[12px] text-ink-500">{t.subject} · {t.sections} · {when(t.opens_at)} to {when(t.closes_at)}</span></td>
            <td className="px-2 py-2">{t.published ? <span className="text-up">published</span> : <span className="text-ink-500">draft</span>}</td>
            <td className="px-2 py-2 tabular">{t.attempts} submitted{t.to_mark ? `, ${t.to_mark} to mark` : ""}</td>
            <td className="px-4 py-2 text-right"><Link href={`?edit=${t.id}`} className="text-[#0F6CBD] hover:underline">Edit</Link> · <Link href={`?results=${t.id}`} className="text-[#0F6CBD] hover:underline">Results</Link></td>
          </tr>))}</tbody></table>)}</CardBody></Card>
    </div>
  );
}
