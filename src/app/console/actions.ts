"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOwnerEmail } from "@/lib/owner";

const YEAR = { name: "2025-26", start_date: "2025-04-01", end_date: "2026-03-31" };
const DEFAULT_MODULES = { twin: false, fees: true, library: true, homework: true, admissions: true, hr: true, transport: true };

async function guard() {
  const owner = await getOwnerEmail();
  if (!owner) throw new Error("Not authorized");
  return createAdminClient();
}
const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

export async function createSchool(formData: FormData) {
  const admin = await guard();
  const name = String(formData.get("name") || "").trim();
  const slug = slugify(String(formData.get("slug") || "") || name);
  const place = String(formData.get("place") || "").trim() || null;
  if (!name || !slug) return;
  const { data: school, error } = await admin.from("school").insert({ name, slug, code: slug.toUpperCase(), place, modules: DEFAULT_MODULES }).select("id").single();
  if (error || !school) throw new Error(error?.message || "create failed");
  await admin.from("academic_year").insert({ ...YEAR, is_current: true, school_id: school.id });
  revalidatePath("/console");
}

export async function createUniversity(formData: FormData) {
  const admin = await guard();
  const name = String(formData.get("name") || "").trim();
  const slug = slugify(String(formData.get("slug") || "") || name);
  const campusLines = String(formData.get("campuses") || "").split("\n").map((l) => l.trim()).filter(Boolean);
  if (!name || !slug) return;
  const { data: uni, error } = await admin.from("university").insert({ name, slug, modules: DEFAULT_MODULES }).select("id, modules").single();
  if (error || !uni) throw new Error(error?.message || "create failed");
  for (const line of campusLines) {
    const idx = line.lastIndexOf(":");
    const cName = (idx >= 0 ? line.slice(0, idx) : line).trim();
    const cSlug = slugify(idx >= 0 ? line.slice(idx + 1) : line);
    if (!cName || !cSlug) continue;
    const { data: campus } = await admin.from("school").insert({ name: cName, slug: cSlug, code: cSlug.toUpperCase(), university_id: uni.id, modules: uni.modules }).select("id").single();
    if (campus) await admin.from("academic_year").insert({ ...YEAR, is_current: true, school_id: campus.id });
  }
  revalidatePath("/console");
}

export async function addCampus(formData: FormData) {
  const admin = await guard();
  const universityId = Number(formData.get("universityId"));
  const name = String(formData.get("name") || "").trim();
  const slug = slugify(String(formData.get("slug") || "") || name);
  if (!universityId || !name || !slug) return;
  const { data: uni } = await admin.from("university").select("modules").eq("id", universityId).single();
  const { data: campus } = await admin.from("school").insert({ name, slug, code: slug.toUpperCase(), university_id: universityId, modules: uni?.modules ?? DEFAULT_MODULES }).select("id").single();
  if (campus) await admin.from("academic_year").insert({ ...YEAR, is_current: true, school_id: campus.id });
  revalidatePath("/console");
}

export async function setSchoolStatus(formData: FormData) {
  const admin = await guard();
  const id = Number(formData.get("id"));
  const status = String(formData.get("status"));
  if (!id || !["active", "suspended"].includes(status)) return;
  await admin.from("school").update({ status }).eq("id", id);
  revalidatePath("/console");
}

export async function setUniversityStatus(formData: FormData) {
  const admin = await guard();
  const id = Number(formData.get("id"));
  const status = String(formData.get("status"));
  if (!id || !["active", "suspended"].includes(status)) return;
  await admin.from("university").update({ status }).eq("id", id);
  // Cascade to all campuses so suspension actually blocks access (enforcement is
  // per-school), and reactivation restores them.
  await admin.from("school").update({ status }).eq("university_id", id);
  revalidatePath("/console");
}

export async function toggleModule(formData: FormData) {
  const admin = await guard();
  const id = Number(formData.get("id"));
  const key = String(formData.get("key"));
  if (!id || !key) return;
  const { data } = await admin.from("school").select("modules").eq("id", id).single();
  const modules = { ...(data?.modules as Record<string, boolean> | null ?? {}) };
  modules[key] = !modules[key];
  await admin.from("school").update({ modules }).eq("id", id);
  revalidatePath("/console");
}

export async function setPlan(formData: FormData) {
  const admin = await guard();
  const id = Number(formData.get("id"));
  const plan = String(formData.get("plan") || "").trim();
  const kind = String(formData.get("kind"));
  if (!id || !plan) return;
  await admin.from(kind === "university" ? "university" : "school").update({ plan }).eq("id", id);
  revalidatePath("/console");
}

export async function updateBranding(formData: FormData) {
  const admin = await guard();
  const id = Number(formData.get("id"));
  const kind = String(formData.get("kind"));
  if (!id) return;
  const patch: Record<string, string | null> = {
    name: String(formData.get("name") || "").trim(),
    primary_color: String(formData.get("primary_color") || "").trim() || "#0F6CBD",
    logo_url: String(formData.get("logo_url") || "").trim() || null,
  };
  if (kind !== "university") patch.place = String(formData.get("place") || "").trim() || null;
  await admin.from(kind === "university" ? "university" : "school").update(patch as never).eq("id", id);
  revalidatePath("/console");
}

export async function addOwner(formData: FormData) {
  const admin = await guard();
  const email = String(formData.get("email") || "").trim().toLowerCase();
  if (!email || !email.includes("@")) return;
  await admin.from("platform_owner").insert({ email }).select().maybeSingle();
  revalidatePath("/console/owners");
}

export async function removeOwner(formData: FormData) {
  const admin = await guard();
  const self = await getOwnerEmail();
  const email = String(formData.get("email") || "").trim().toLowerCase();
  // Never let an owner remove themselves (avoids locking the console out).
  if (!email || email === self) return;
  await admin.from("platform_owner").delete().eq("email", email);
  revalidatePath("/console/owners");
}

// Make an existing account the central admin of a university (gives cross-campus
// access). The person must already have an account (a profile).
export async function assignCentralAdmin(formData: FormData): Promise<void> {
  const admin = await guard();
  const universityId = Number(formData.get("universityId"));
  const email = String(formData.get("email") || "").trim().toLowerCase();
  if (!universityId || !email) return;
  const { data: list } = await admin.auth.admin.listUsers();
  const user = list?.users?.find((u) => (u.email ?? "").toLowerCase() === email);
  if (!user) return;
  const { data: profile } = await admin.from("profile").select("id, school_id").eq("id", user.id).maybeSingle();
  if (!profile) return;
  await admin.from("profile").update({ university_id: universityId, active_campus_id: profile.school_id }).eq("id", user.id);
  revalidatePath(`/console/university/${universityId}`);
}
