"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import { getMemberStatus, issueBook, searchBooksForIssue, searchMembers } from "@/app/dashboard/library/actions";
import { availabilityText, fmtDay, fmtMoney, type BookStock, type Member, type MemberStatus } from "./shared";

const rowBtn = "flex w-full items-start justify-between gap-3 border-b border-hair px-3 py-2 text-left last:border-b-0 hover:bg-[#F5F9FE]";

// Issue a book: find the member, see what they hold, pick the book, issue.
// The limit, overdue and availability rules are all checked again on the server.
export function IssueDesk() {
  const router = useRouter();
  const [memberQ, setMemberQ] = useState("");
  const [members, setMembers] = useState<Member[] | null>(null);
  const [member, setMember] = useState<Member | null>(null);
  const [status, setStatus] = useState<MemberStatus | null>(null);
  const [memberProblem, setMemberProblem] = useState<string | null>(null);

  const [bookQ, setBookQ] = useState("");
  const [books, setBooks] = useState<BookStock[] | null>(null);
  const [book, setBook] = useState<BookStock | null>(null);
  const [bookProblem, setBookProblem] = useState<string | null>(null);

  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function findMembers(e: React.FormEvent) {
    e.preventDefault();
    setMemberProblem(null);
    setDone(null);
    start(async () => {
      const res = await searchMembers(memberQ);
      if (res.ok) setMembers(res.members); else { setMembers(null); setMemberProblem(res.error); }
    });
  }

  function loadStatus(m: Member) {
    start(async () => {
      const res = await getMemberStatus(m.kind, m.id);
      if (res.ok) setStatus(res.status); else { setStatus(null); setMemberProblem(res.error); }
    });
  }

  function pickMember(m: Member) {
    setMember(m);
    setMembers(null);
    setStatus(null);
    setMemberProblem(null);
    setDone(null);
    loadStatus(m);
  }

  function clearMember() {
    setMember(null);
    setStatus(null);
    setMembers(null);
    setMemberQ("");
    setDone(null);
  }

  function findBooks(e: React.FormEvent) {
    e.preventDefault();
    setBookProblem(null);
    setDone(null);
    start(async () => {
      const res = await searchBooksForIssue(bookQ);
      if (res.ok) setBooks(res.books); else { setBooks(null); setBookProblem(res.error); }
    });
  }

  function issue() {
    if (!member || !book) return;
    setBookProblem(null);
    setDone(null);
    start(async () => {
      const res = await issueBook({ kind: member.kind, memberId: member.id, bookId: book.id }); if (res.ok) router.refresh();
      if (!res.ok) { setBookProblem(res.error); return; }
      setDone(`"${book.title}" issued to ${member.name}. Due back on ${fmtDay(res.dueOn)}.`);
      setBook(null);
      setBooks(null);
      setBookQ("");
      const again = await getMemberStatus(member.kind, member.id);
      if (again.ok) setStatus(again.status);
    });
  }

  const atLimit = !!status && status.loans.length >= status.limit;
  const blocked = !!status && (status.hasOverdue || atLimit);

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card>
        <CardHeader title="1. Member" action={member ? <Button size="sm" variant="ghost" onClick={clearMember}>Change</Button> : undefined} />
        <CardBody className="space-y-3">
          {!member && (
            <>
              <form onSubmit={findMembers} className="flex gap-2">
                <Input value={memberQ} onChange={(e) => setMemberQ(e.target.value)} maxLength={60}
                  placeholder="Student name or admission no, or staff name" aria-label="Find a member" />
                <Button type="submit" variant="subtle" disabled={pending || memberQ.trim().length < 2}>Find</Button>
              </form>
              {members && members.length === 0 && <p className="text-[13px] text-ink-500">No student or staff member matches that.</p>}
              {members && members.length > 0 && (
                <div className="rounded-sm border border-hair">
                  {members.map((m) => (
                    <button key={`${m.kind}-${m.id}`} type="button" className={rowBtn} onClick={() => pickMember(m)}>
                      <span className="min-w-0">
                        <span className="block text-[14px] font-medium text-ink-900">{m.name}</span>
                        <span className="block text-[12px] text-ink-500">{m.detail}</span>
                      </span>
                      <span className="shrink-0 text-[12px] text-ink-500">{m.kind === "student" ? "Student" : "Staff"}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          {member && (
            <div>
              <p className="text-[15px] font-semibold text-ink-900">{member.name}</p>
              <p className="text-[13px] text-ink-500">{member.kind === "student" ? "Student" : "Staff"} · {member.detail}</p>
            </div>
          )}

          {member && !status && !memberProblem && <p className="text-[13px] text-ink-500">Loading their books…</p>}

          {member && status && (
            <>
              <p className="text-[13px] text-ink-700">
                Holds <span className="font-semibold tabular text-ink-900">{status.loans.length}</span> of{" "}
                <span className="font-semibold tabular text-ink-900">{status.limit}</span> books allowed. A new book is due back in {status.loanDays} days.
              </p>
              {status.hasOverdue && <p role="alert" className="text-[13px] font-medium text-down">An overdue book must be returned before another is issued.</p>}
              {!status.hasOverdue && atLimit && <p role="alert" className="text-[13px] font-medium text-down">This member is at their limit.</p>}
              {status.loans.length > 0 && (
                <ul className="rounded-sm border border-hair">
                  {status.loans.map((l) => (
                    <li key={l.id} className="flex items-start justify-between gap-3 border-b border-hair px-3 py-2 last:border-b-0">
                      <span className="min-w-0">
                        <span className="block text-[13px] font-medium text-ink-900">{l.title}</span>
                        <span className="block text-[12px] tabular text-ink-500">{l.accession_no}</span>
                      </span>
                      <span className={cn("shrink-0 text-right text-[12px]", l.days_late > 0 ? "font-medium text-down" : "text-ink-500")}>
                        Due {fmtDay(l.due_on)}
                        {l.days_late > 0 && <span className="block">{l.days_late} {l.days_late === 1 ? "day" : "days"} late, {fmtMoney(l.fine)}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          {memberProblem && <p role="alert" className="text-[13px] font-medium text-down">{memberProblem}</p>}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="2. Book" />
        <CardBody className="space-y-3">
          {!member && <p className="text-[13px] text-ink-500">Choose a member first.</p>}

          {member && (
            <form onSubmit={findBooks} className="flex gap-2">
              <Input value={bookQ} onChange={(e) => setBookQ(e.target.value)} maxLength={60}
                placeholder="Title or accession no" aria-label="Find a book" />
              <Button type="submit" variant="subtle" disabled={pending || bookQ.trim().length < 2}>Find</Button>
            </form>
          )}

          {member && books && books.length === 0 && <p className="text-[13px] text-ink-500">No book matches that.</p>}
          {member && books && books.length > 0 && (
            <div className="rounded-sm border border-hair">
              {books.map((b) => {
                const none = b.copies_available <= 0;
                return (
                  <button key={b.id} type="button" disabled={none}
                    className={cn(rowBtn, book?.id === b.id && "bg-[#EBF3FC]", none && "cursor-not-allowed opacity-60 hover:bg-transparent")}
                    onClick={() => { setBook(b); setBookProblem(null); setDone(null); }}>
                    <span className="min-w-0">
                      <span className="block text-[14px] font-medium text-ink-900">{b.title}</span>
                      <span className="block text-[12px] text-ink-500"><span className="tabular">{b.accession_no}</span> · {b.author}</span>
                    </span>
                    <span className={cn("shrink-0 text-[12px] font-medium", none ? "text-down" : "text-up")}>{availabilityText(b)}</span>
                  </button>
                );
              })}
            </div>
          )}

          {member && book && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-sm border border-hair bg-[#fafafa] px-3 py-2">
              <p className="min-w-0 text-[13px] text-ink-900">
                Issue <span className="font-semibold">{book.title}</span> (<span className="tabular">{book.accession_no}</span>) to {member.name}
              </p>
              <Button onClick={issue} disabled={pending || blocked || !status}>{pending ? "Issuing…" : "Issue book"}</Button>
            </div>
          )}

          {bookProblem && <p role="alert" className="text-[13px] font-medium text-down">{bookProblem}</p>}
          {done && <p role="status" className="text-[13px] font-medium text-up">{done}</p>}
        </CardBody>
      </Card>
    </div>
  );
}
