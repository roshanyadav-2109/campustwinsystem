"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOwnerEmail } from "@/lib/owner";
import { refreshBrand } from "@/lib/brand-server";

// The Indian academic year runs April to March: from April it is this year to
// next year, before April it is last year to this year.
function currentAcademicYear(today = new Date()) {
  const y = today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1;
  return { name: `${y}-${String((y + 1) % 100).padStart(2, "0")}`, start_date: `${y}-04-01`, end_date: `${y + 1}-03-31` };
}
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
  await admin.from("academic_year").insert({ ...currentAcademicYear(), is_current: true, school_id: school.id });
  refreshBrand();
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
    if (campus) await admin.from("academic_year").insert({ ...currentAcademicYear(), is_current: true, school_id: campus.id });
  }
  refreshBrand();
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
  if (campus) await admin.from("academic_year").insert({ ...currentAcademicYear(), is_current: true, school_id: campus.id });
  refreshBrand();
  revalidatePath("/console");
}

export async function setSchoolStatus(formData: FormData) {
  const admin = await guard();
  const id = Number(formData.get("id"));
  const status = String(formData.get("status"));
  if (!id || !["active", "suspended"].includes(status)) return;
  await admin.from("school").update({ status }).eq("id", id);
  refreshBrand();
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
  refreshBrand();
  revalidatePath("/console");
}

// Switching a module for one institution records an exception on top of its
// plan (the database recomputes modules = plan + exceptions). Matching the plan
// again drops the exception.
export async function toggleModule(formData: FormData) {
  const admin = await guard();
  const id = Number(formData.get("id"));
  const key = String(formData.get("key"));
  const kind = String(formData.get("kind") || "school") === "university" ? "university" : "school";
  if (!id || !key) return;
  const { data } = await admin.from(kind).select("modules, module_overrides, plan").eq("id", id).single();
  const current = !!(data?.modules as Record<string, boolean> | null)?.[key];
  const { data: planMods } = await admin.rpc("plan_modules" as never, { p_plan: data?.plan ?? "" } as never);
  const inPlan = !!(planMods as Record<string, boolean> | null)?.[key];
  const overrides = { ...((data?.module_overrides as Record<string, boolean> | null) ?? {}) };
  const want = !current;
  if (want === inPlan) delete overrides[key]; else overrides[key] = want;
  await admin.from(kind).update({ module_overrides: overrides }).eq("id", id);
  refreshBrand();
  revalidatePath("/console");
}

// Back to exactly what the plan includes.
export async function resetModules(formData: FormData) {
  const admin = await guard();
  const id = Number(formData.get("id"));
  const kind = String(formData.get("kind") || "school") === "university" ? "university" : "school";
  if (!id) return;
  await admin.from(kind).update({ module_overrides: {} }).eq("id", id);
  refreshBrand();
  revalidatePath("/console");
}

// Moving an institution to another plan switches its modules at once (and a
// university's campuses follow it).
export async function setPlan(formData: FormData) {
  const admin = await guard();
  const id = Number(formData.get("id"));
  const plan = String(formData.get("plan") || "").trim();
  const kind = String(formData.get("kind"));
  if (!id || !plan) return;
  const { data: exists } = await admin.schema("core" as never).from("plan" as never).select("code").eq("product_code", "campustwin").eq("code", plan).maybeSingle();
  if (!exists) return;
  await admin.from(kind === "university" ? "university" : "school").update({ plan }).eq("id", id);
  refreshBrand();
  revalidatePath("/console");
}

// ------------------------------------------------------------------ plans
const PLAN_MODULES = ["fees", "library", "homework", "admissions", "hr", "transport"] as const;
export type PlanResult = { ok: boolean; message: string } | null;

// Create or change a CampusTwin plan. Changing which modules it includes
// updates every institution on the plan immediately (database trigger).
export async function savePlan(_prev: PlanResult, formData: FormData): Promise<PlanResult> {
  const admin = await guard();
  const id = String(formData.get("planId") || "");
  const name = String(formData.get("name") || "").replace(/\s+/g, " ").trim().slice(0, 40);
  const code = (String(formData.get("code") || "") || name).toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30);
  const rupees = Number(formData.get("price") || 0);
  if (!name) return { ok: false, message: "Give the plan a name." };
  if (!/^[a-z][a-z0-9_-]{1,40}$/.test(code)) return { ok: false, message: "The plan code should start with a letter, like premium." };
  if (!Number.isFinite(rupees) || rupees < 0) return { ok: false, message: "The price should be a number of rupees." };
  const modules: Record<string, boolean> = { twin: false };
  for (const m of PLAN_MODULES) modules[m] = formData.get(`m_${m}`) === "on";
  const core = admin.schema("core" as never);
  if (id) {
    const { data: cur } = await core.from("plan" as never).select("features").eq("id", id).single();
    const features = { ...((cur as { features?: Record<string, unknown> } | null)?.features ?? {}), modules, unit: "student" };
    const { error } = await core.from("plan" as never).update({ name, price_paise: Math.round(rupees * 100), features, active: formData.get("active") === "on" } as never).eq("id", id);
    if (error) return { ok: false, message: "The plan could not be saved." };
  } else {
    const { error } = await core.from("plan" as never).insert({ product_code: "campustwin", code, name, price_paise: Math.round(rupees * 100), period: "year", features: { modules, unit: "student" }, active: true } as never);
    if (error) return { ok: false, message: error.code === "23505" ? `A plan with the code ${code} already exists.` : "The plan could not be added." };
  }
  refreshBrand();
  revalidatePath("/console");
  return { ok: true, message: id ? `${name} saved. Every institution on it now has these modules.` : `${name} added.` };
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
  refreshBrand();
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

// Give a school its first leader login (principal or office) without any
// script: the person then signs in with Google using this email.
export type LoginResult = { ok: boolean; message: string } | null;
export async function grantSchoolLogin(_prev: LoginResult, formData: FormData): Promise<LoginResult> {
  const admin = await guard();
  const schoolId = Number(formData.get("schoolId"));
  const name = String(formData.get("name") || "").replace(/\s+/g, " ").trim();
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const role = String(formData.get("role") || "");
  if (!schoolId) return { ok: false, message: "School not found." };
  if (!name) return { ok: false, message: "Type the person's full name." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, message: "Type a proper email address, like name@gmail.com." };
  if (!["principal", "office"].includes(role)) return { ok: false, message: "Choose Principal or School office." };
  const exact = email.replace(/[\\%_]/g, (c) => `\\${c}`);
  // An email can open only one record anywhere, or sign-in would be ambiguous.
  const [st, gu, su] = await Promise.all([
    admin.from("staff").select("full_name, school_id").ilike("email", exact).limit(1),
    admin.from("guardian").select("full_name, school_id").ilike("email", exact).limit(1),
    admin.from("student").select("full_name, school_id").ilike("email", exact).limit(1),
  ]);
  const taken = st.data?.[0] ?? gu.data?.[0] ?? su.data?.[0];
  if (taken) return { ok: false, message: `${email} already signs in as ${taken.full_name}${taken.school_id === schoolId ? " at this school" : " at another school"}. Use a different email.` };
  const { error } = await admin.from("staff").insert({ school_id: schoolId, full_name: name, email, role: role as never });
  if (error) return { ok: false, message: "Could not save. Please try again." };
  revalidatePath(`/console/school/${schoolId}/access`);
  return { ok: true, message: `${name} can now sign in with Google as ${email}.` };
}

// ------------------------------------------------------------------ upgrade requests
// Approving moves the school (or, for a campus, its university) to the
// requested plan; the database then switches the modules.
export async function decidePlanRequest(formData: FormData) {
  const admin = await guard();
  const id = Number(formData.get("id"));
  const decision = String(formData.get("decision")) === "approve" ? "approved" : "declined";
  if (!id) return;
  const { data: req } = await admin.from("plan_request" as never).select("id, school_id, requested_plan, status").eq("id", id).maybeSingle();
  const r = req as { id: number; school_id: number; requested_plan: string; status: string } | null;
  if (!r || r.status !== "pending") return;
  if (decision === "approved") {
    const { data: s } = await admin.from("school").select("university_id").eq("id", r.school_id).single();
    if (s?.university_id) await admin.from("university").update({ plan: r.requested_plan }).eq("id", s.university_id);
    else await admin.from("school").update({ plan: r.requested_plan }).eq("id", r.school_id);
  }
  await admin.from("plan_request" as never).update({ status: decision, decided_at: new Date().toISOString() } as never).eq("id", id);
  refreshBrand();
  revalidatePath("/console");
}
