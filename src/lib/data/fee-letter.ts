import { createClient } from "@/lib/supabase/server";
import { untyped } from "@/lib/data/schedule";
import { round2 } from "@/components/fees/shared";
import type { FeeLetterContent } from "@/components/fees/shared";

// The content of a fee letter for one student this year, from the school's
// fee setup: each head's yearly amount, transport, concessions, the instalment
// schedule, and what has been paid so far. Called by the office when issuing a
// letter; the result is stored with the letter so it never changes afterwards.
export async function buildFeeLetter(studentId: number, yearId: number): Promise<FeeLetterContent | null> {
  const supabase = await createClient();
  const db = await untyped();
  const [{ data: st }, { data: en }, { data: yr }, { data: gs }] = await Promise.all([
    supabase.from("student").select("full_name, admission_no, dob").eq("id", studentId).maybeSingle(),
    supabase.from("student_enrollment").select("section_id, section(name, class_id, class(name))").eq("student_id", studentId).eq("academic_year_id", yearId).neq("status", "transferred").maybeSingle(),
    supabase.from("academic_year").select("name, start_date, end_date").eq("id", yearId).single(),
    supabase.from("guardian_student").select("guardian(full_name, relation)").eq("student_id", studentId),
  ]);
  if (!st || !en) return null;
  const sec = en.section as unknown as { name: string; class_id: number; class: { name: string } | null } | null;
  if (!sec) return null;

  const [{ data: fs }, { data: ins }, { data: tr }, { data: sc }, { data: invs }] = await Promise.all([
    db.from("fee_structure").select("amount, fee_head(id, name, is_active, charge, is_tuition)").eq("academic_year_id", yearId).eq("class_id", sec.class_id),
    db.from("fee_instalment").select("name, due_date, share_pct").eq("academic_year_id", yearId).order("seq"),
    db.from("student_transport").select("route(code, name, annual_fee)").eq("student_id", studentId).eq("academic_year_id", yearId).eq("is_active", true).limit(1),
    db.from("student_concession").select("fee_concession_type(name, kind, value, head_ids, active)").eq("student_id", studentId).eq("academic_year_id", yearId).eq("status", "active"),
    db.from("fee_invoice").select("amount, paid_amount, status").eq("student_id", studentId).eq("academic_year_id", yearId).neq("status", "cancelled"),
  ]);

  type Head = { id: number; name: string; is_active: boolean; charge: "split" | "once"; is_tuition: boolean };
  const heads = ((fs ?? []) as unknown as { amount: number | string; fee_head: Head | null }[])
    .filter((r) => r.fee_head?.is_active && Number(r.amount) > 0)
    .map((r) => ({ ...r.fee_head!, amount: round2(Number(r.amount)) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const route = ((tr ?? []) as unknown as { route: { code: string; name: string; annual_fee: number | string } | null }[])[0]?.route;
  const transport = route && Number(route.annual_fee) > 0 ? { label: `Transport (${route.code} ${route.name})`, amount: round2(Number(route.annual_fee)) } : null;
  const concs = ((sc ?? []) as unknown as { fee_concession_type: { name: string; kind: "percent" | "amount"; value: number | string; head_ids: number[] | null; active: boolean } | null }[])
    .map((r) => r.fee_concession_type).filter((c): c is NonNullable<typeof c> => !!c && c.active);

  // The instalment schedule, worked out exactly as raising does: "once" heads
  // in full on the first instalment, everything else split by cumulative
  // shares, then each concession taken off that instalment's heads.
  const plan = ((ins ?? []) as { name: string; due_date: string; share_pct: number | string }[]);
  const shares = plan.length ? plan.map((p) => Number(p.share_pct)) : [100];
  const part = (amount: number, prev: number, cum: number) => round2((amount * cum) / 100) - round2((amount * prev) / 100);
  let cum = 0;
  const perInstalment = shares.map((share, i) => {
    const prev = cum; cum += share;
    const lines = heads.map((h) => ({ id: h.id, amount: h.charge === "once" ? (i === 0 ? h.amount : 0) : part(h.amount, prev, cum) }));
    const charges = lines.reduce((n, l) => n + l.amount, 0);
    const bus = transport ? part(transport.amount, prev, cum) : 0;
    const offs = concs.map((c) => {
      const base = lines.filter((l) => !c.head_ids?.length || c.head_ids.includes(l.id)).reduce((n, l) => n + l.amount, 0);
      const v = c.kind === "percent" ? round2((base * Number(c.value)) / 100) : part(Number(c.value), prev, cum);
      return { name: c.name, amount: Math.min(v, base) };
    });
    const off = offs.reduce((n, o) => n + o.amount, 0);
    return { amount: round2(Math.max(0, charges + bus - off)), offs };
  });
  const concessions = concs.map((c, k) => ({ name: c.name, amount: round2(perInstalment.reduce((n, p) => n + p.offs[k].amount, 0)) })).filter((c) => c.amount > 0);
  const total = round2(perInstalment.reduce((n, p) => n + p.amount, 0));
  const instalments = plan.map((p, i) => ({ name: p.name, dueDate: p.due_date, amount: perInstalment[i].amount }));

  const paid = round2(((invs ?? []) as { paid_amount: number | string }[]).reduce((n, r) => n + Number(r.paid_amount), 0));
  return {
    student: { name: st.full_name, admissionNo: st.admission_no, dob: st.dob ?? null, classLabel: `${sec.class?.name ?? ""}-${sec.name}` },
    parents: ((gs ?? []) as unknown as { guardian: { full_name: string; relation: string | null } | null }[])
      .map((g) => g.guardian).filter((g): g is NonNullable<typeof g> => !!g).map((g) => (g.relation ? `${g.full_name} (${g.relation})` : g.full_name)),
    year: { name: yr?.name ?? "", start: yr?.start_date ?? "", end: yr?.end_date ?? "" },
    heads: heads.map((h) => ({ name: h.name, amount: h.amount, tuition: h.is_tuition })),
    transport, concessions, total, paid, balance: round2(Math.max(0, total - paid)), instalments,
  };
}
