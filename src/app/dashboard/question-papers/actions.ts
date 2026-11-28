"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

type R = { ok: true; message: string } | { ok: false; error: string };
const PATH = "/dashboard/question-papers";
const clean = (e: { message: string; code?: string } | null, f: string) => (e && (e.code === "P0001" || (e.message.length < 160 && !/violates|function|relation|column/.test(e.message))) ? e.message : f);
async function call(name: string, args: Record<string, unknown>, ok: string, fail: string): Promise<R> {
  const supabase = await createClient();
  const { error } = await supabase.rpc(name as never, args as never);
  if (error) return { ok: false, error: clean(error, fail) };
  revalidatePath(PATH);
  return { ok: true, message: ok };
}

export const assignSetter = async (paperId: number, setter: number, moderator: number | null, release: number) =>
  call("assign_question_setter", { p_paper: paperId, p_setter: setter, p_moderator: moderator, p_release: release }, "Saved; the setter is told.", "Could not save.");
export const moderatePaper = async (qpId: number, approve: boolean, note: string) =>
  call("moderate_question_paper", { p_qp: qpId, p_approve: approve, p_note: note || null }, approve ? "Approved." : "Sent back to the setter.", "Could not save.");

// The setter's upload goes straight to private storage, into this paper's own folder.
export async function signPaperUpload(qpId: number, contentType: string, size: number): Promise<{ ok: true; key: string; uploadUrl: string } | { ok: false; error: string }> {
  const ext = contentType === "application/pdf" ? "pdf" : contentType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ? "docx" : null;
  if (!ext) return { ok: false, error: "Upload the paper as a PDF or Word (.docx) file." };
  if (size > 20 * 1024 * 1024) return { ok: false, error: "The file is over 20 MB." };
  const supabase = await createClient();
  const { data: school } = await supabase.rpc("question_paper_upload_ok" as never, { p_qp: qpId } as never);
  if (!school) return { ok: false, error: "Not allowed." };
  const { presignPrivatePut, tenantPrefixForSchool } = await import("@/lib/r2");
  const key = `${await tenantPrefixForSchool(Number(school))}/exams/question-papers/${qpId}/${crypto.randomUUID()}.${ext}`;
  return { ok: true, key, uploadUrl: await presignPrivatePut(key) };
}
export const submitPaper = async (qpId: number, key: string) => call("submit_question_paper", { p_qp: qpId, p_key: key }, "Submitted to the moderator.", "Could not submit.");

// The database decides who may open the paper now, and logs it.
export async function paperLink(qpId: number, paperId: number | null): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("question_paper_key" as never, { p_qp: qpId, p_paper: paperId } as never);
  if (error) return { ok: false, error: clean(error, "Not available.") };
  if (!data) return { ok: false, error: "Not available." };
  const { presignGet } = await import("@/lib/r2");
  return { ok: true, url: await presignGet(String(data)) };
}
export async function paperLog(qpId: number) {
  const supabase = await createClient();
  const { data } = await supabase.rpc("question_paper_log" as never, { p_qp: qpId } as never);
  return (data ?? []) as unknown as { at: string; campus: string | null; who: string }[];
}

// Central valuation (university central administration)
export async function centralValuation(sessionId: number) {
  const supabase = await createClient();
  const { data } = await supabase.rpc("central_valuation" as never, { p_session: sessionId } as never);
  return (data ?? []) as unknown as { paper_id: number; subject: string; class_name: string | null; exam_date: string; campuses: number; scripts: number; absent: number; unassigned: number; marked: number; decoded: number; evaluators: number }[];
}
export async function universityEvaluators(schoolId: number) {
  const supabase = await createClient();
  const { data } = await supabase.rpc("university_evaluators" as never, { p_school: schoolId } as never);
  return (data ?? []) as unknown as { staff_id: number; name: string; campus: string }[];
}
export async function centralAllot(paperId: number, staff: number[]): Promise<R> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("central_allot" as never, { p_paper: paperId, p_staff: staff } as never);
  if (error) return { ok: false, error: clean(error, "Could not allot.") };
  return { ok: true, message: `${Number(data ?? 0)} scripts sent to evaluators.` };
}
