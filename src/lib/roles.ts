// Access from positions (colleges and universities). The database applies the
// same rules (app.is_exams, app.can_publish_results); these only shape the screens.
import type { Session } from "@/lib/session";

export const EXAM_TYPES = ["exams_head", "exams_deputy", "exams_staff"];

/** The exam cell: exam timetable, hall tickets, results preview. The office counts too. */
export function isExams(s: Session | null | undefined): boolean {
  return !!s && (isOffice(s) || s.isHead || s.accessTypes.some((t) => EXAM_TYPES.includes(t)));
}

/** Office work: the office record or a registrar position (kept when a head position also applies). */
export function isOffice(s: Session | null | undefined): boolean {
  return !!s && (s.staffRole === "office" || s.baseStaffRole === "office" || s.accessTypes.includes("registrar"));
}

/** Fees and payments: the office, or a finance head (who has no other office powers). */
export function isFinance(s: Session | null | undefined): boolean {
  return isOffice(s) || (!!s && s.accessTypes.includes("finance_head"));
}

/** Roles and positions, logins and access: the office or the head, not a deputy head. */
export function managesPeople(s: Session | null | undefined): boolean {
  return !!s && (s.staffRole === "office" || s.staffRole === "principal") && !s.deputyOnly;
}

/** Exam cell leads: evaluation schemes and exam rules. */
export function isExamsLead(s: Session | null | undefined): boolean {
  return !!s && (isOffice(s) || s.isHead || s.accessTypes.includes("exams_head") || s.accessTypes.includes("exams_deputy"));
}

/** Who sets the attendance lock and holds: administration or the examinations head. */
export function setsAttendanceRules(s: Session | null | undefined): boolean {
  return !!s && (s.staffRole === "office" || s.staffRole === "principal" || s.accessTypes.includes("exams_head"));
}

export const SCOPED_TYPES = ["dean", "dept_head", "programme_coord"];

/** Head of Department, Dean or Programme Coordinator: their own department, faculty or programme. */
export function isScopedLead(s: Session | null | undefined): boolean {
  return !!s && s.accessTypes.some((t) => SCOPED_TYPES.includes(t));
}
