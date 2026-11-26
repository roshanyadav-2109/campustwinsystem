import { guardTab } from "@/lib/access";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { InstitutionForm } from "@/components/settings/institution-form";

const COLS = "name, address, phone, email, website, affiliation_board, affiliation_no, board_school_code, udise_code, signatory_name, signatory_title";

export default async function InstitutionPage() {
  const denied = await guardTab("/dashboard/settings/institution");
  if (denied) return denied;
  const session = (await getSession())!;
  const supabase = await createClient();
  const { data } = await supabase.from("school").select(COLS as never).eq("id", session.schoolId).maybeSingle();
  const r = (data ?? {}) as Record<string, string | null>;
  const v = (k: string) => r[k] ?? "";
  return (
    <div>
      <PageHeader title="Institution profile" description="Printed on certificates, letters and receipts." />
      <InstitutionForm name={v("name")} higherEd={session.school.higherEd} initial={{
        address: v("address"), phone: v("phone"), email: v("email"), website: v("website"),
        affiliation_board: v("affiliation_board"), affiliation_no: v("affiliation_no"), board_school_code: v("board_school_code"),
        udise_code: v("udise_code"), signatory_name: v("signatory_name"), signatory_title: v("signatory_title"),
      }} />
    </div>
  );
}
