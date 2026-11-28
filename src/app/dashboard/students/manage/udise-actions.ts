"use server";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";

// UDISE+ (SDMS) student data for the office and principal, page by page.
export type UdiseRow = {
  admission_no: string; student_name: string; aadhaar_name: string | null; gender: string | null; dob: string | null; class_name: string; section_name: string; roll_no: number | null;
  admission_date: string | null; mother_name: string | null; father_name: string | null; guardian_name: string | null; mobile: string | null; email: string | null;
  address: string | null; pincode: string | null; mother_tongue: string | null; social_category: string | null; religion: string | null; bpl: boolean | null;
  cwsn: boolean | null; cwsn_note: string | null; apaar_id: string | null; pen: string | null; aadhaar_last4: string | null; blood_group: string | null;
  previous_school: string | null; nationality: string | null; missing: string[];
  minority: string | null; aay: boolean | null; disadvantaged: boolean | null; disability_type: string | null; udid_no: string | null; rte_admission: boolean | null;
  height_cm: number | null; weight_kg: number | null; medium: string | null; stream: string | null; prev_result: string | null; prev_percent: number | null;
  prev_attendance_days: number | null; facilities: string[] | null;
};

export async function udiseRows(sectionId: number | null): Promise<{ ok: true; rows: UdiseRow[] } | { ok: false; error: string }> {
  const s = await getSession();
  if (!s || (s.staffRole !== "office" && s.staffRole !== "principal")) return { ok: false, error: "Only the office or the principal can export UDISE+ data." };
  const supabase = await createClient();
  const rows: UdiseRow[] = [];
  for (let from = 0; from < 20000; from += 1000) {
    const { data, error } = await supabase.rpc("udise_student_rows" as never, { p_section: sectionId } as never).range(from, from + 999);
    if (error) return { ok: false, error: "Could not read the student data." };
    const page = (data ?? []) as unknown as UdiseRow[];
    rows.push(...page);
    if (page.length < 1000) break;
    if (from + 1000 >= 20000) return { ok: false, error: "More than 20,000 students: export one section at a time." };
  }
  return { ok: true, rows };
}
