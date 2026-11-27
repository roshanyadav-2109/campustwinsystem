import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "@/lib/supabase/config";

// Public check from a QR code: a student ID card, a report card, or a recorded certificate.
// Shows only what proves it is genuine; nothing else about the student.
const KIND: Record<string, string> = { transfer: "Transfer certificate", bonafide: "Bonafide certificate", character: "Character certificate" };
export const dynamic = "force-dynamic";

type Card = { student_name: string; class_label: string | null; school_name: string; school_place: string | null; year_name: string; valid: boolean; reason: string | null };
type Report = { valid: boolean; reason: string; student_name: string; class_label: string | null; term_name: string | null; year_name: string | null; school_name: string; published_on: string };
type Admit = { valid: boolean; student_name: string; class_label: string | null; exam_name: string; school_name: string };
type Grade = { valid: boolean; student_name: string; programme: string | null; semester_no: number | null; sgpa: number | null; cgpa: number | null; school_name: string; published_on: string };
type Transcript = { valid: boolean; student_name: string; programme: string | null; cgpa: number | null; credits: number | null; school_name: string; issued_on: string };
type Cert = { kind: string; number: string | null; student_name: string; admission_no: string; issued_on: string; school_name: string; school_place: string | null; status: string };

function Facts({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="mt-5 divide-y divide-hair rounded-md border border-hair text-[14px]">
      {rows.map(([k, v]) => (
        <div key={k} className="flex gap-4 px-4 py-2.5"><dt className="w-32 shrink-0 text-ink-500">{k}</dt><dd className="text-ink-900">{v}</dd></div>
      ))}
    </dl>
  );
}

export default async function VerifyPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ok = /^[a-f0-9]{32,64}$/.test(token);
  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const [{ data: cardData }, { data: certData }, { data: repData }, { data: admData }, { data: gcData }, { data: trData }] = ok
    ? await Promise.all([anon.rpc("verify_id_card" as never, { p_token: token } as never), anon.rpc("verify_certificate" as never, { p_token: token } as never),
        anon.rpc("verify_report_card" as never, { p_token: token } as never), anon.rpc("verify_admit_card" as never, { p_token: token } as never), anon.rpc("verify_grade_card" as never, { p_token: token } as never),
        anon.rpc("verify_transcript" as never, { p_token: token } as never)])
    : [{ data: null }, { data: null }, { data: null }, { data: null }, { data: null }, { data: null }];
  const transcript = ((trData ?? []) as Transcript[])[0];
  const report = ((repData ?? []) as Report[])[0];
  const admit = ((admData ?? []) as Admit[])[0];
  const gcard = ((gcData ?? []) as Grade[])[0];
  const card = ((cardData ?? []) as Card[])[0];
  const cert = ((certData ?? []) as Cert[])[0];
  const day = (iso: string) => iso.split("-").reverse().join("/");
  const place = (n: string, p: string | null) => [n, p].filter(Boolean).join(", ");

  return (
    <main className="mx-auto max-w-lg px-6 py-16">
      <p className="text-[12px] font-medium uppercase tracking-wide text-ink-500">CampusTwin check</p>
      {card ? (
        <>
          <h1 className={`mt-2 text-[22px] font-semibold ${card.valid ? "text-up" : "text-down"}`}>{card.valid ? "Valid student ID card" : "This ID card is not valid"}</h1>
          {!card.valid && card.reason && <p className="mt-1 text-[14px] text-ink-900">{card.reason}</p>}
          <Facts rows={[["Student", card.student_name], ["Class", card.class_label ?? ""], ["Institution", place(card.school_name, card.school_place)], ["Year", card.year_name]]} />
          <p className="mt-4 text-[12px] text-ink-500">Compare the name and class with the card. If they differ, the card is not genuine.</p>
        </>
      ) : report ? (
        <>
          <h1 className={`mt-2 text-[22px] font-semibold ${report.valid ? "text-up" : "text-down"}`}>{report.valid ? "Valid report card" : "This report card is not current"}</h1>
          {!report.valid && <p className="mt-1 text-[14px] text-ink-900">{report.reason}</p>}
          <Facts rows={[["Student", report.student_name], ["Class", report.class_label ?? ""], ["Report", [report.term_name, report.year_name].filter(Boolean).join(", ")], ["Institution", report.school_name], ["Published", day(report.published_on)]]} />
          <p className="mt-4 text-[12px] text-ink-500">Marks are not shown here. Compare the printed card with the one in the parent&apos;s CampusTwin account.</p>
        </>
      ) : transcript ? (
        <>
          <h1 className={`mt-2 text-[22px] font-semibold ${transcript.valid ? "text-up" : "text-down"}`}>{transcript.valid ? "Transcript on record" : "This transcript has been withdrawn"}</h1>
          <Facts rows={[["Student", transcript.student_name], ["Programme", transcript.programme ?? ""], ["CGPA", transcript.cgpa == null ? "" : String(transcript.cgpa)], ["Credits earned", transcript.credits == null ? "" : String(transcript.credits)], ["Institution", transcript.school_name], ["Issued", day(transcript.issued_on)]]} />
          <p className="mt-4 text-[12px] text-ink-500">Compare the CGPA and credits with the printed transcript.</p>
        </>
      ) : gcard ? (
        <>
          <h1 className="mt-2 text-[22px] font-semibold text-up">Grade card on record</h1>
          <Facts rows={[["Student", gcard.student_name], ["Programme", gcard.programme ?? ""], ["Semester", gcard.semester_no ? String(gcard.semester_no) : ""], ["SGPA", gcard.sgpa == null ? "" : String(gcard.sgpa)], ["CGPA", gcard.cgpa == null ? "" : String(gcard.cgpa)], ["Institution", gcard.school_name], ["Published", day(gcard.published_on)]]} />
          <p className="mt-4 text-[12px] text-ink-500">Compare SGPA and CGPA with the printed grade card.</p>
        </>
      ) : admit ? (
        <>
          <h1 className={`mt-2 text-[22px] font-semibold ${admit.valid ? "text-up" : "text-down"}`}>{admit.valid ? "Valid admit card" : "This student is no longer enrolled"}</h1>
          <Facts rows={[["Student", admit.student_name], ["Class", admit.class_label ?? ""], ["Exam", admit.exam_name], ["Institution", admit.school_name]]} />
        </>
      ) : cert ? (
        <>
          <h1 className={`mt-2 text-[22px] font-semibold ${cert.status === "issued" ? "text-up" : "text-down"}`}>{cert.status === "issued" ? "This certificate is on record" : "This certificate has been withdrawn"}</h1>
          <Facts rows={[["Issued by", place(cert.school_name, cert.school_place)], ["Certificate", KIND[cert.kind] ?? cert.kind], ["Number", cert.number ?? "Not given"], ["Student", `${cert.student_name}, admission no. ${cert.admission_no}`], ["Date of issue", day(cert.issued_on)]]} />
        </>
      ) : (
        <>
          <h1 className="mt-2 text-[22px] font-semibold text-ink-900">Nothing found</h1>
          <p className="mt-2 text-[14px] text-ink-700">This code does not match any card or certificate. Check that the whole code was scanned, or contact the institution.</p>
        </>
      )}
    </main>
  );
}
