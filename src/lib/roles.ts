// Access from positions (colleges and universities). The database applies the
// same rules (app.is_exams, app.can_publish_results); these only shape the screens.
import type { Session } from "@/lib/session";

export const EXAM_TYPES = ["exams_head", "exams_deputy", "exams_staff"];

/** The exam cell: exam timetable, hall tickets, results preview. The office counts too. */
export function isExams(s: Session | null | undefined): boolean {
  return !!s && (s.staffRole === "office" || s.accessTypes.some((t) => EXAM_TYPES.includes(t)));
}

/** Exam cell leads: evaluation schemes and exam rules. */
export function isExamsLead(s: Session | null | undefined): boolean {
  return !!s && (s.staffRole === "office" || s.accessTypes.includes("exams_head") || s.accessTypes.includes("exams_deputy"));
}

/** Who sets the attendance lock and holds: administration or the examinations head. */
export function setsAttendanceRules(s: Session | null | undefined): boolean {
  return !!s && (s.staffRole === "office" || s.staffRole === "principal" || s.accessTypes.includes("exams_head"));
}
