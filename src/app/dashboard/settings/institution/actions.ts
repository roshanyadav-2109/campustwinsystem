"use server";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { refreshBrand } from "@/lib/brand-server";

export type InstitutionDetails = {
  address: string; phone: string; email: string; website: string;
  affiliation_board: string; affiliation_no: string; board_school_code: string; udise_code: string;
  signatory_name: string; signatory_title: string;
};

// The office keeps the institution's own details. Name, logo and colours stay
// with Eternity (console), since they are the institution's brand on CampusTwin.
export async function saveInstitutionDetails(input: InstitutionDetails): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await getSession();
  if (!session?.staffId || session.staffRole !== "office") return { ok: false, error: "Only the office can change the institution's details." };
  const t = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "") || null;
  const udise = (input?.udise_code ?? "").replace(/\D/g, "") || null;
  if (udise && udise.length !== 11) return { ok: false, error: "A UDISE+ code has 11 digits." };
  const email = t(input?.email, 120);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "Enter the institution's email address correctly." };
  const row = {
    address: t(input?.address, 300), phone: t(input?.phone, 40), email, website: t(input?.website, 120),
    affiliation_board: t(input?.affiliation_board, 60), affiliation_no: t(input?.affiliation_no, 40),
    board_school_code: t(input?.board_school_code, 20), udise_code: udise,
    signatory_name: t(input?.signatory_name, 80), signatory_title: t(input?.signatory_title, 60),
  };
  const { error } = await createAdminClient().from("school").update(row as never).eq("id", session.schoolId);
  if (error) return { ok: false, error: "That could not be saved. Please try again." };
  refreshBrand();
  revalidatePath("/dashboard/settings/institution");
  return { ok: true };
}
