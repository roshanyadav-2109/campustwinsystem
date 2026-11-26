"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";

// Settings → Programmes and courses (colleges and universities, office).
type R = { ok: true; message?: string } | { ok: false; error: string };
const PATH = "/dashboard/settings/programmes";
const office = async () => (await getSession())?.staffRole === "office";
const msg = (e: { message: string } | null, f: string) => (e ? (e.message.includes("duplicate") ? "That code is already used." : e.message.length < 120 && !e.message.includes("violates") ? e.message : f) : f);

export async function addDepartment(code: string, name: string): Promise<R> {
  if (!(await office())) return { ok: false, error: "Only the office can change programmes." };
  if (!code.trim() || !name.trim()) return { ok: false, error: "Give a code and a name." };
  const supabase = await createClient();
  const { error } = await supabase.from("department" as never).insert({ code: code.trim().toUpperCase().slice(0, 12), name: name.trim().slice(0, 80) } as never);
  if (error) return { ok: false, error: msg(error, "Could not add.") };
  revalidatePath(PATH); return { ok: true, message: "Department added." };
}

export async function addProgramme(input: { departmentId: number | null; code: string; name: string; level: string; regulation: string; years: string; semesters: string; credits: string }): Promise<R> {
  if (!(await office())) return { ok: false, error: "Only the office can change programmes." };
  if (!input.code.trim() || !input.name.trim() || !/^\d$/.test(input.years) || !/^\d{1,2}$/.test(input.semesters)) return { ok: false, error: "Give code, name, years and semesters." };
  const supabase = await createClient();
  const { error } = await supabase.from("programme" as never).insert({ department_id: input.departmentId, code: input.code.trim().toUpperCase().slice(0, 16), name: input.name.trim().slice(0, 100),
    level: ["diploma", "ug", "pg", "phd"].includes(input.level) ? input.level : "ug", regulation: input.regulation.trim().slice(0, 20) || "R2024",
    years: Number(input.years), semesters: Number(input.semesters), total_credits: input.credits ? Number(input.credits) : null } as never);
  if (error) return { ok: false, error: msg(error, "Could not add.") };
  revalidatePath(PATH); return { ok: true, message: "Programme added." };
}

export async function addCourse(input: { programmeId: number; semester: string; code: string; name: string; kind: string; l: string; t: string; p: string; credits: string; group: string }): Promise<R> {
  if (!(await office())) return { ok: false, error: "Only the office can change programmes." };
  if (!input.code.trim() || !input.name.trim() || !/^\d{1,2}(\.\d)?$/.test(input.credits) || !/^\d{1,2}$/.test(input.semester)) return { ok: false, error: "Give code, name, credits and semester." };
  const supabase = await createClient();
  const { data: prog } = await supabase.from("programme" as never).select("department_id").eq("id", input.programmeId).maybeSingle();
  const { data: c, error } = await supabase.from("course" as never).insert({ department_id: (prog as { department_id: number | null } | null)?.department_id ?? null,
    code: input.code.trim().toUpperCase().slice(0, 16), name: input.name.trim().slice(0, 120), kind: input.kind,
    lecture: Number(input.l) || 0, tutorial: Number(input.t) || 0, practical: Number(input.p) || 0, credits: Number(input.credits) } as never).select("id").single();
  if (error || !c) return { ok: false, error: msg(error, "Could not add the course.") };
  const { error: e2 } = await supabase.from("programme_course" as never).insert({ programme_id: input.programmeId, course_id: (c as { id: number }).id, semester_no: Number(input.semester), elective_group: input.group.trim().slice(0, 30) || null } as never);
  if (e2) return { ok: false, error: msg(e2, "Could not place the course.") };
  revalidatePath(PATH); return { ok: true, message: "Course added." };
}

export async function removeFromProgramme(id: number): Promise<R> {
  if (!(await office())) return { ok: false, error: "Only the office can change programmes." };
  const supabase = await createClient();
  const { error } = await supabase.from("programme_course" as never).delete().eq("id", id);
  if (error) return { ok: false, error: "Could not remove." };
  revalidatePath(PATH); return { ok: true, message: "Removed." };
}
