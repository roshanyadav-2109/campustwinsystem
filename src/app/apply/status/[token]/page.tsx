import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "@/lib/supabase/config";
import { ApplicantStatus, type StatusRow } from "@/components/admissions/applicant-status";

export const dynamic = "force-dynamic";

// The family's private page for one application: where it stands, the offer to accept, the fee to pay.
export default async function ApplicationStatusPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const valid = /^[a-f0-9]{32}$/.test(token);
  const { data } = valid ? await createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } }).rpc("applicant_status" as never, { p_token: token } as never) : { data: null };
  const row = ((data ?? []) as unknown as StatusRow[])[0];
  return (
    <main className="mx-auto w-full max-w-xl px-5 py-10">
      {row ? <ApplicantStatus row={row} token={token} /> : <p className="text-[15px] text-ink-900">This link is not valid. Please check it, or contact the school office.</p>}
    </main>
  );
}
