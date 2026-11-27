import { guardTab } from "@/lib/access";
import { getSession } from "@/lib/session";
import { PageHeader } from "@/components/ui/page-header";
import { createClient } from "@/lib/supabase/server";
import { Transcripts, type Issued } from "@/components/courses/transcripts";

// Transcripts: the consolidated record of every semester, with a QR check anyone can scan.
export default async function TranscriptsPage() {
  const denied = await guardTab("/dashboard/transcripts");
  if (denied) return denied;
  const session = await getSession();
  if (!session) return null;
  const supabase = await createClient();
  const [{ data }, { data: coe }, { data: reg }] = await Promise.all([
    supabase.from("transcript_issue" as never).select("id, issued_at, revoked_at, cgpa, student:student_id(full_name, admission_no)").order("issued_at", { ascending: false }).limit(50),
    supabase.rpc("signatory" as never, { p_type: "exams_head" } as never), supabase.rpc("signatory" as never, { p_type: "registrar" } as never)]);
  const signers = [((coe ?? []) as unknown as { title: string }[])[0]?.title ?? "Controller of Examinations", ((reg ?? []) as unknown as { title: string }[])[0]?.title ?? "Registrar"];
  return (
    <div className="space-y-4">
      <PageHeader title="Transcripts" description="Issue a student's transcript: every semester's counted grades, SGPA and CGPA, with a QR code that proves it is genuine." />
      <Transcripts issued={(data ?? []) as unknown as Issued[]} signers={signers} verifyBase={`https://verify.${process.env.NEXT_PUBLIC_BASE_DOMAIN || "campustwin.org"}/verify/`} />
    </div>
  );
}
