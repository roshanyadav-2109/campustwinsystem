"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { managesPeople } from "@/lib/roles";

type R = { ok: true; message?: string } | { ok: false; error: string };
const PATH = "/dashboard/settings/positions";
const clean = (e: { message: string }, f: string) => (e.message.length < 160 && !e.message.includes("violates") ? e.message : f);
async function admin() { return managesPeople(await getSession()); }
const ACCESS_TYPES = ["governing", "head", "deputy_head", "registrar", "finance_head", "student_affairs", "exams_head", "exams_deputy", "exams_staff",
  "confidential", "evaluator", "moderator", "exam_centre", "revaluation", "dean", "dept_head", "programme_coord", "faculty", "advisor", "office_staff", "service"];
const LEVELS = ["university", "campus", "faculty", "department", "programme"];

export async function addUsualTitles(): Promise<R> {
  if (!(await admin())) return { ok: false, error: "Only the office or the head can change titles." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("add_usual_titles" as never);
  if (error) return { ok: false, error: clean(error, "Could not add them.") };
  revalidatePath(PATH);
  return { ok: true, message: Number(data) ? `${data} titles added. Rename any of them.` : "Titles already exist." };
}

export async function saveTitle(input: { id?: number | null; name: string; accessType: string; scopeLevel: string; active: boolean }): Promise<R> {
  if (!(await admin())) return { ok: false, error: "Only the office or the head can change titles." };
  const name = input.name.trim();
  if (name.length < 2 || name.length > 80) return { ok: false, error: "Give the title a name." };
  if (!ACCESS_TYPES.includes(input.accessType) || !LEVELS.includes(input.scopeLevel)) return { ok: false, error: "Choose the type and where it applies." };
  const supabase = await createClient();
  const row = { name, access_type: input.accessType, scope_level: input.scopeLevel, active: input.active };
  const { error } = input.id
    ? await supabase.from("position_title" as never).update(row as never).eq("id", input.id)
    : await supabase.from("position_title" as never).insert(row as never);
  if (error) return { ok: false, error: error.message.includes("duplicate") || error.message.includes("uq_position") ? "A title with this name exists." : clean(error, "Could not save.") };
  revalidatePath(PATH);
  return { ok: true, message: "Saved." };
}

export async function saveUnit(input: { id?: number | null; code: string; name: string; kind: string }): Promise<R> {
  if (!(await admin())) return { ok: false, error: "Only the office or the head can change this." };
  const code = input.code.trim().toUpperCase(), name = input.name.trim();
  if (!/^[A-Z0-9-]{1,12}$/.test(code) || name.length < 2) return { ok: false, error: "Give a short code and a name." };
  if (!["faculty", "school", "institute", "centre"].includes(input.kind)) return { ok: false, error: "Choose the kind." };
  const supabase = await createClient();
  const row = { code, name, kind: input.kind };
  const { error } = input.id ? await supabase.from("academic_unit" as never).update(row as never).eq("id", input.id) : await supabase.from("academic_unit" as never).insert(row as never);
  if (error) return { ok: false, error: error.message.includes("duplicate") ? "This code is taken." : clean(error, "Could not save.") };
  revalidatePath(PATH);
  return { ok: true, message: "Saved." };
}

export async function setDepartmentUnit(departmentId: number, unitId: number | null): Promise<R> {
  if (!(await admin())) return { ok: false, error: "Only the office or the head can change this." };
  const supabase = await createClient();
  const { error } = await supabase.from("department" as never).update({ unit_id: unitId } as never).eq("id", departmentId);
  if (error) return { ok: false, error: "Could not save." };
  revalidatePath(PATH);
  return { ok: true, message: "Saved." };
}

export async function assignPosition(input: { staffId: number; titleId: number; unitId: number | null; departmentId: number | null; programmeId: number | null; from: string; to: string; acting: boolean }): Promise<R> {
  const DATE = /^\d{4}-\d{2}-\d{2}$/;
  if (!input.staffId || !input.titleId) return { ok: false, error: "Choose the person and the title." };
  if ((input.from && !DATE.test(input.from)) || (input.to && !DATE.test(input.to))) return { ok: false, error: "Check the dates." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("assign_position" as never, { p_staff: input.staffId, p_title: input.titleId, p_unit: input.unitId, p_department: input.departmentId,
    p_programme: input.programmeId, p_from: input.from || null, p_to: input.to || null, p_acting: input.acting } as never);
  if (error) return { ok: false, error: clean(error, "Could not assign.") };
  revalidatePath(PATH); revalidatePath("/dashboard/settings/teachers");
  return { ok: true, message: "Assigned." };
}

export async function endPosition(id: number): Promise<R> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("end_position" as never, { p_id: id, p_on: null } as never);
  if (error) return { ok: false, error: clean(error, "Could not end it.") };
  revalidatePath(PATH); revalidatePath("/dashboard/settings/teachers");
  return { ok: true, message: "Ended today." };
}
