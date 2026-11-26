import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "@/lib/supabase/config";

// Public check of a certificate from its QR code. Shows only what proves it is
// genuine (institution, student, certificate, date, valid or cancelled).
const KIND: Record<string, string> = { transfer: "Transfer certificate", bonafide: "Bonafide certificate", character: "Character certificate" };
export const dynamic = "force-dynamic";

type Hit = { kind: string; number: string; student_name: string; admission_no: string; issued_on: string; school_name: string; school_place: string | null; status: string; copies: number; source: string };

export default async function VerifyPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data } = /^[a-f0-9]{32,64}$/.test(token) ? await anon.rpc("verify_certificate" as never, { p_token: token } as never) : { data: null };
  const c = ((data ?? []) as Hit[])[0];
  const day = (iso: string) => iso.split("-").reverse().join("/");
  const rows: [string, string][] = c ? [
    ["Issued by", [c.school_name, c.school_place].filter(Boolean).join(", ")],
    ["Certificate", KIND[c.kind] ?? c.kind],
    ["Number", `${c.number}${c.copies ? ` (${c.copies} duplicate${c.copies === 1 ? "" : "s"} printed)` : ""}`],
    ["Student", `${c.student_name}, admission no. ${c.admission_no}`],
    ["Date of issue", day(c.issued_on)],
    ...(c.source !== "issued" ? [["Recorded", "Issued by the institution before it used CampusTwin, and recorded later"] as [string, string]] : []),
  ] : [];
  return (
    <main className="mx-auto max-w-lg px-6 py-16">
      <p className="text-[12px] font-medium uppercase tracking-wide text-ink-500">CampusTwin certificate check</p>
      {!c ? (
        <>
          <h1 className="mt-2 text-[22px] font-semibold text-ink-900">No certificate found</h1>
          <p className="mt-2 text-[14px] text-ink-700">This code does not match any certificate. Check that the whole code was scanned, or contact the institution.</p>
        </>
      ) : (
        <>
          <h1 className={`mt-2 text-[22px] font-semibold ${c.status === "issued" ? "text-up" : "text-down"}`}>{c.status === "issued" ? "This certificate is genuine" : "This certificate has been cancelled"}</h1>
          <dl className="mt-5 divide-y divide-hair rounded-md border border-hair text-[14px]">
            {rows.map(([k, v]) => (
              <div key={k} className="flex gap-4 px-4 py-2.5"><dt className="w-32 shrink-0 text-ink-500">{k}</dt><dd className="text-ink-900">{v}</dd></div>
            ))}
          </dl>
          <p className="mt-4 text-[12px] text-ink-500">Compare these details with the paper. If they differ, the paper is not genuine.</p>
        </>
      )}
    </main>
  );
}
