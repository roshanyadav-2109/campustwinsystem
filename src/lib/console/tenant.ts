import "server-only";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";

export type Admin = ReturnType<typeof createAdminClient>;

export async function loadSchool(id: string | number) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("school")
    .select("id, name, slug, place, status, plan, modules, university_id, logo_url, primary_color")
    .eq("id", Number(id))
    .maybeSingle();
  if (!data) notFound();
  return data;
}

export async function currentYear(admin: Admin, schoolId: number) {
  const { data } = await admin
    .from("academic_year")
    .select("id, name, is_current, start_date, end_date")
    .eq("school_id", schoolId)
    .order("is_current", { ascending: false })
    .order("start_date", { ascending: false });
  return (data ?? [])[0] ?? null;
}

// Class + section lookup maps for a tenant, with the canonical "IX-C" label.
export async function sectionClassMaps(admin: Admin, schoolId: number) {
  const [{ data: classes }, { data: sections }] = await Promise.all([
    admin.from("class").select("id, name, level, stage").eq("school_id", schoolId).order("level"),
    admin.from("section").select("id, name, class_id").eq("school_id", schoolId).order("name"),
  ]);
  const classById = new Map((classes ?? []).map((c) => [c.id, c]));
  const sectionLabel = new Map((sections ?? []).map((s) => [s.id, `${classById.get(s.class_id)?.name ?? "?"}-${s.name}`]));
  return { classes: classes ?? [], sections: sections ?? [], classById, sectionLabel };
}

export async function headCount(admin: Admin, table: string, schoolId: number) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count } = await (admin.from(table as any) as any).select("*", { count: "exact", head: true }).eq("school_id", schoolId);
  return (count as number | null) ?? 0;
}

export const modulesOf = (m: unknown): Record<string, boolean> => (m as Record<string, boolean> | null) ?? {};
