import Link from "next/link";
import { getSession, getCurrentYear } from "@/lib/session";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { getStaffScope, getSectionStudents } from "@/lib/data/scope";
import { getMyChildren } from "@/lib/data/analytics";
import { getNames, getStudentSection } from "@/lib/data/schedule";
import {
  listHomework, getHomework, getSubmissionCounts, getSectionSizes, getHomeworkSubmissions, getStudentSubmissions,
  schoolTodayISO, type HomeworkRow,
} from "@/lib/data/homework";
import { HomeworkFilters } from "@/components/homework/homework-filters";
import { HomeworkForm, HomeworkOwnerActions, type FormSection } from "@/components/homework/homework-form";
import { SubmissionRoster, type RosterEntry } from "@/components/homework/submission-roster";
import { StudentHomeworkCard, type StudentHomeworkItem } from "@/components/homework/student-homework";
import { OutLink, fmtDay, fmtMarks } from "@/components/homework/shared";
import { numParam } from "@/lib/utils";
import { guardTab } from "@/lib/access";

type SP = Promise<Record<string, string | string[] | undefined>>;
const BASE = "/dashboard/homework";
const TITLE = "Homework";

const notSetUp = (
  <div>
    <PageHeader title={TITLE} />
    <EmptyState art="coming-soon" title="Homework is not set up yet" hint="The office needs to finish setting up this page. Please check again later." />
  </div>
);

export default async function HomeworkPage({ searchParams }: { searchParams: SP }) {
  const denied = await guardTab(BASE);
  if (denied) return denied;
  const sp = await searchParams;
  const session = (await getSession())!;
  const year = await getCurrentYear();
  const today = schoolTodayISO();

  // ---- Student / guardian: what is due and what is done ----
  if (session.role === "student" || session.role === "guardian") {
    let studentId = session.studentId;
    let children: { id: number; full_name: string; admission_no: string }[] = [];
    if (session.role === "guardian") {
      children = await getMyChildren();
      const asked = numParam(sp.child);
      studentId = children.find((c) => c.id === asked)?.id ?? children[0]?.id ?? null;
    }
    if (!studentId || !year) return (<div><PageHeader title={TITLE} /><EmptyState title="Nothing to show yet" /></div>);

    const switcher = session.role === "guardian" && children.length > 1 && (
      <div className="seg mb-5 flex flex-wrap gap-2">
        {children.map((c) => (
          <Link prefetch={false} key={c.id} href={`${BASE}?child=${c.id}`} className={`rounded-sm border px-3 py-1.5 text-[13px] font-medium ${c.id === studentId ? "border-[#0F6CBD] bg-[#EBF3FC] text-[#0F6CBD] font-semibold" : "border-hair bg-surface text-ink-700 hover:border-[#B4D6FA] hover:bg-[#F5F9FE]"}`}>{c.full_name}</Link>
        ))}
      </div>
    );

    const section = await getStudentSection(studentId, year.id);
    if (!section) {
      return (<div><PageHeader title={TITLE} />{switcher}<EmptyState title="No class this year" hint="Homework appears here once the student is placed in a class." /></div>);
    }

    const list = await listHomework({ yearId: year.id, sectionIds: [section.id] });
    if (list.missing) return notSetUp;
    const [subs, names] = await Promise.all([
      getStudentSubmissions(studentId, list.rows.map((h) => h.id)),
      getNames({ subjectIds: list.rows.map((h) => h.subject_id), staffIds: list.rows.map((h) => h.created_by) }),
    ]);

    const items: StudentHomeworkItem[] = list.rows.map((h) => {
      const s = subs.get(h.id) ?? null;
      return {
        id: h.id,
        subject: names.subject.get(h.subject_id) ?? "Subject",
        title: h.title,
        instructions: h.instructions,
        dueDate: h.due_date,
        teacher: names.staffName.get(h.created_by) ?? null,
        linkUrl: h.link_url,
        maxMarks: h.max_marks,
        overdue: !s && h.due_date < today,
        submission: s && {
          note: s.note, link_url: s.link_url, submitted_at: s.submitted_at, is_late: s.is_late,
          marks: s.marks, remark: s.remark, checked_at: s.checked_at,
        },
      };
    });
    // To do: soonest due first (overdue therefore on top). Done: latest first.
    const todo = items.filter((i) => !i.submission).sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.id - b.id);
    const done = items.filter((i) => i.submission).sort((a, b) => b.submission!.submitted_at.localeCompare(a.submission!.submitted_at));

    return (
      <div>
        <PageHeader title={TITLE} description={section.label ? `Class ${section.label}` : undefined} />
        {switcher}
        {!items.length ? (
          <EmptyState title="No homework yet" hint="Homework set by your teachers will appear here." />
        ) : (
          <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
            <section aria-labelledby="hw-todo">
              <h2 id="hw-todo" className="mb-3 text-[15px] font-semibold text-ink-900">To do <span className="font-normal tabular text-ink-500">{todo.length}</span></h2>
              {todo.length ? (
                <ul className="space-y-3">{todo.map((i) => (<StudentHomeworkCard key={i.id} item={i} studentId={studentId!} />))}</ul>
              ) : (
                <p className="rounded-md border border-hair bg-surface px-4 py-6 text-center text-[14px] text-ink-500">All homework is done.</p>
              )}
            </section>
            <section aria-labelledby="hw-done">
              <h2 id="hw-done" className="mb-3 text-[15px] font-semibold text-ink-900">Done <span className="font-normal tabular text-ink-500">{done.length}</span></h2>
              {done.length ? (
                <ul className="space-y-3">{done.map((i) => (<StudentHomeworkCard key={i.id} item={i} studentId={studentId!} />))}</ul>
              ) : (
                <p className="rounded-md border border-hair bg-surface px-4 py-6 text-center text-[14px] text-ink-500">Nothing marked as done yet.</p>
              )}
            </section>
          </div>
        )}
      </div>
    );
  }

  // ---- Staff ----
  if (!session.staffId) return (<div><PageHeader title={TITLE} /><EmptyState title="Nothing to show yet" /></div>);
  const scope = await getStaffScope();
  const yearId = scope.currentYearId ?? year?.id ?? null;
  const isAdmin = scope.isAdmin; // principal / office: read only
  if (!yearId || !scope.sections.length) {
    return (
      <div>
        <PageHeader title={TITLE} />
        <EmptyState art="no-sections" title="No classes to show" hint={isAdmin ? "Classes and sections have not been set up for this year." : "You have not been allotted a class or subject this year. Ask the office to add your allotment."} />
      </div>
    );
  }

  const sectionLabel = new Map(scope.sectionMeta.map((m) => [m.id, m.label]));
  const metaById = new Map(scope.sectionMeta.map((m) => [m.id, m]));
  const mayCheck = (h: HomeworkRow) => {
    if (isAdmin) return false;
    const m = metaById.get(h.section_id);
    return !!m && (m.isClassTeacher || m.subjects.some((s) => s.id === h.subject_id));
  };

  // Filters, kept in the address.
  const classId = isAdmin ? (scope.classes.find((c) => c.id === numParam(sp.class))?.id ?? null) : null;
  const sectionPool = classId ? scope.sectionMeta.filter((m) => m.classId === classId) : scope.sectionMeta;
  const sectionId = sectionPool.find((m) => m.id === numParam(sp.section))?.id ?? null;
  const subjectPool = isAdmin
    ? (classId ? (scope.subjectsByClass[classId] ?? scope.subjects) : scope.subjects)
    : (sectionId ? (metaById.get(sectionId)?.subjects ?? []) : scope.subjects);
  const subjectId = subjectPool.find((s) => s.id === numParam(sp.subject))?.id ?? null;

  const filterQs = new URLSearchParams();
  if (classId) filterQs.set("class", String(classId));
  if (sectionId) filterQs.set("section", String(sectionId));
  if (subjectId) filterQs.set("subject", String(subjectId));
  const listHref = filterQs.toString() ? `${BASE}?${filterQs.toString()}` : BASE;
  const openHref = (id: number) => { const q = new URLSearchParams(filterQs); q.set("open", String(id)); return `${BASE}?${q.toString()}`; };

  // ---- One homework: the section's roll with each student's status ----
  const openId = numParam(sp.open);
  if (openId) {
    const hw = await getHomework(openId);
    if (!hw) {
      return (
        <div>
          <PageHeader title={TITLE} />
          <EmptyState art="not-found" title="This homework is not available" hint="It may have been deleted, or it belongs to a class you do not teach.">
            <Link prefetch={false} href={listHref} className="text-[14px] font-medium text-[#0F6CBD] hover:underline">Back to homework</Link>
          </EmptyState>
        </div>
      );
    }
    const [roster, subs, names] = await Promise.all([
      getSectionStudents(hw.section_id, hw.academic_year_id),
      getHomeworkSubmissions(hw.id),
      getNames({ subjectIds: [hw.subject_id], staffIds: [hw.created_by], sectionIds: [hw.section_id] }),
    ]);
    const subByStudent = new Map(subs.map((s) => [s.student_id, s]));
    const entries: RosterEntry[] = roster.map((r) => {
      const s = subByStudent.get(r.id) ?? null;
      return {
        studentId: r.id, name: r.name, roll: r.roll,
        submission: s && {
          id: s.id, note: s.note, link_url: s.link_url, submitted_at: s.submitted_at, is_late: s.is_late,
          marks: s.marks, remark: s.remark, checked_at: s.checked_at,
        },
      };
    });
    const submitted = entries.filter((e) => e.submission).length;
    const checkedCount = entries.filter((e) => e.submission?.checked_at).length;
    const canCheck = mayCheck(hw);
    const isMine = !isAdmin && hw.created_by === session.staffId;
    const where = `${names.section.get(hw.section_id) ?? sectionLabel.get(hw.section_id) ?? "Class"} · ${names.subject.get(hw.subject_id) ?? "Subject"}`;

    return (
      <div>
        <Link prefetch={false} href={listHref} className="mb-3 inline-block text-[13px] font-medium text-[#0F6CBD] hover:underline">Back to homework</Link>
        <PageHeader eyebrow={where} title={hw.title}
          actions={isMine ? <HomeworkOwnerActions hw={hw} afterDeleteHref={listHref} /> : undefined} />
        <div className="grid gap-5 lg:grid-cols-[1fr_300px] lg:items-start">
          <Card>
            <CardHeader title="Students" action={<span className="text-[13px] tabular text-ink-500">{submitted} of {entries.length} submitted, {checkedCount} checked</span>} />
            {entries.length ? (
              <SubmissionRoster key={hw.id} entries={entries} maxMarks={hw.max_marks} canCheck={canCheck} />
            ) : (
              <CardBody><p className="text-[14px] text-ink-500">No students are on the roll of this section.</p></CardBody>
            )}
            {canCheck && entries.length > 0 && (
              <p className="border-t border-hair px-4 py-2.5 text-[12px] text-ink-500">Marks and remarks can be entered once a student has marked the homework as done.</p>
            )}
          </Card>
          <Card>
            <CardHeader title="Details" />
            <CardBody className="space-y-3">
              <Detail label="Due date" value={`${fmtDay(hw.due_date)}${hw.due_date < today ? " (passed)" : ""}`} />
              <Detail label="Set by" value={names.staffName.get(hw.created_by) ?? "Teacher"} />
              <Detail label="Maximum marks" value={hw.max_marks !== null ? fmtMarks(hw.max_marks) : "Not marked"} />
              {hw.instructions && (
                <div>
                  <div className="t-label mb-1">Instructions</div>
                  <p className="whitespace-pre-line break-words text-[14px] leading-relaxed text-ink-700">{hw.instructions}</p>
                </div>
              )}
              <OutLink href={hw.link_url}>Open worksheet</OutLink>
            </CardBody>
          </Card>
        </div>
      </div>
    );
  }

  // ---- The list ----
  const sectionIds = sectionId
    ? [sectionId]
    : classId
      ? sectionPool.map((m) => m.id)
      : isAdmin ? undefined : scope.sectionMeta.map((m) => m.id);
  const list = await listHomework({ yearId, sectionIds, subjectId });
  if (list.missing) return notSetUp;
  const rows = list.rows;
  const [counts, sizes, names] = await Promise.all([
    getSubmissionCounts(rows.map((h) => h.id)),
    getSectionSizes(yearId),
    getNames({ subjectIds: rows.map((h) => h.subject_id), staffIds: rows.map((h) => h.created_by) }),
  ]);

  const filters = (
    <HomeworkFilters
      classes={isAdmin ? scope.classes.map((c) => ({ id: c.id, label: c.name })) : undefined}
      sections={sectionPool.map((m) => ({ id: m.id, label: m.label }))}
      subjects={subjectPool.map((s) => ({ id: s.id, label: s.name }))}
      classId={classId} sectionId={sectionId} subjectId={subjectId}
    />
  );

  const feed = rows.length ? (
    <Card>
      <ul className="divide-y divide-hair">
        {rows.map((h) => {
          const c = counts.get(h.id) ?? { submitted: 0, checked: 0 };
          const total = sizes.get(h.section_id);
          const mine = !isAdmin && h.created_by === session.staffId;
          return (
            <li key={h.id} className="px-4 py-3">
              <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                <div className="min-w-0">
                  <div className="t-label">{sectionLabel.get(h.section_id) ?? "Class"} · {names.subject.get(h.subject_id) ?? "Subject"}</div>
                  <Link prefetch={false} href={openHref(h.id)} className="mt-0.5 block text-[15px] font-semibold text-[#0F6CBD] hover:underline">{h.title}</Link>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[13px] text-ink-700">
                    <span className="tabular">Due {fmtDay(h.due_date)}</span>
                    <span className="tabular">{c.submitted} of {total ?? "-"} submitted</span>
                    {c.submitted > 0 && <span className="tabular text-ink-500">{c.checked} checked</span>}
                    {!mine && <span className="text-ink-500">Set by {names.staffName.get(h.created_by) ?? "Teacher"}</span>}
                  </div>
                </div>
                {mine && <HomeworkOwnerActions hw={h} />}
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  ) : (
    <Card>
      <EmptyState title="No homework yet"
        hint={isAdmin ? "Homework set by teachers will appear here." : "Use the form to set homework for one of your classes."} />
    </Card>
  );

  if (isAdmin) {
    return (
      <div>
        <PageHeader title={TITLE} description="Homework set across the school this year, with how many students have submitted." />
        {filters}
        {feed}
      </div>
    );
  }

  const formSections: FormSection[] = scope.sectionMeta
    .filter((m) => m.subjects.length > 0)
    .map((m) => ({ id: m.id, label: m.label, subjects: m.subjects.map((s) => ({ id: s.id, name: s.name })) }));

  return (
    <div>
      <PageHeader title={TITLE} description="Set homework for your classes and check what students hand in." />
      {filters}
      <div className="grid gap-5 lg:grid-cols-[1fr_360px] lg:items-start">
        {feed}
        {formSections.length > 0 && (
          <HomeworkForm key={`${sectionId ?? 0}-${subjectId ?? 0}`} sections={formSections}
            defaultSectionId={sectionId} defaultSubjectId={subjectId} today={today} />
        )}
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="t-label mb-0.5">{label}</div>
      <div className="text-[14px] text-ink-900">{value}</div>
    </div>
  );
}
