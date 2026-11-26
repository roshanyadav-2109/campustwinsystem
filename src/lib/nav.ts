import {
  DashboardIcon, ProgressIcon, AttendanceIcon, MarksIcon, StudentsIcon,
  AnnounceIcon, CalendarIcon, ReportIcon, LeaveIcon, AllotmentIcon,
  PromotionIcon, RoleStudentIcon, RoleTeacherIcon, ExcelIcon, NotebookIcon,
  BusIcon, BusRidersIcon, FeesIcon, LibraryIcon, HomeworkIcon, AdmissionsIcon, StaffHrIcon, ManageIcon,
  type IconComponent,
} from "@/components/icons";

export type NavRole = "student" | "guardian" | "subject_teacher" | "class_teacher" | "principal" | "office" | "transport";

// Paid modules an institution can switch on or off in the registry. Core tabs
// carry no module and are always available.
export type GateModule = "twin" | "fees" | "library" | "homework" | "admissions" | "hr" | "transport";

export type NavItem = {
  href: string;
  icon: IconComponent;
  labelKey: string;
  roles: NavRole[];
  module?: GateModule;
};

const ALL: NavRole[] = ["student", "guardian", "subject_teacher", "class_teacher", "principal", "office"];

export const NAV: NavItem[] = [
  { href: "/dashboard", icon: DashboardIcon, labelKey: "nav.dashboard", roles: ALL },
  { href: "/dashboard/transport", icon: BusIcon, labelKey: "nav.transport", roles: [...ALL, "transport"], module: "transport" },
  { href: "/dashboard/transport/riders", icon: BusRidersIcon, labelKey: "nav.transportRiders", roles: ["principal", "office"], module: "transport" },
  { href: "/dashboard/transport/setup", icon: BusIcon, labelKey: "nav.transportSetup", roles: ["principal", "office"], module: "transport" },
  { href: "/dashboard/progress", icon: ProgressIcon, labelKey: "nav.myProgress", roles: ["student"] },
  { href: "/dashboard/progress", icon: ProgressIcon, labelKey: "nav.childProgress", roles: ["guardian"] },
  { href: "/dashboard/progress", icon: ProgressIcon, labelKey: "nav.progress", roles: ["subject_teacher", "class_teacher", "principal"] },
  { href: "/dashboard/attendance", icon: AttendanceIcon, labelKey: "nav.attendance", roles: ALL },
  { href: "/dashboard/schedule", icon: CalendarIcon, labelKey: "nav.schedule", roles: ALL },
  { href: "/dashboard/marks", icon: MarksIcon, labelKey: "nav.marks", roles: ["subject_teacher", "class_teacher", "office"] },
  { href: "/dashboard/students", icon: StudentsIcon, labelKey: "nav.students", roles: ["class_teacher", "principal", "office"] },
  { href: "/dashboard/announcements", icon: AnnounceIcon, labelKey: "nav.announcements", roles: ALL },
  { href: "/dashboard/calendar", icon: CalendarIcon, labelKey: "nav.calendar", roles: ALL },
  { href: "/dashboard/reports", icon: ReportIcon, labelKey: "nav.reports", roles: ["student", "guardian", "class_teacher", "principal", "office"] },
  { href: "/dashboard/fees", icon: FeesIcon, labelKey: "nav.fees", roles: ["student", "guardian", "principal", "office"], module: "fees" },
  { href: "/dashboard/library", icon: LibraryIcon, labelKey: "nav.library", roles: ["student", "subject_teacher", "class_teacher", "principal", "office"], module: "library" },
  { href: "/dashboard/homework", icon: HomeworkIcon, labelKey: "nav.homework", roles: ["student", "guardian", "subject_teacher", "class_teacher", "principal"], module: "homework" },
  { href: "/dashboard/admissions", icon: AdmissionsIcon, labelKey: "nav.admissions", roles: ["principal", "office"], module: "admissions" },
  { href: "/dashboard/hr", icon: StaffHrIcon, labelKey: "nav.hr", roles: ["subject_teacher", "class_teacher", "principal", "office"], module: "hr" },
  { href: "/dashboard/leave", icon: LeaveIcon, labelKey: "nav.leave", roles: ["student", "guardian", "class_teacher"] },
  { href: "/dashboard/allotments", icon: AllotmentIcon, labelKey: "nav.allotments", roles: ["principal", "office"] },
  { href: "/dashboard/promotion", icon: PromotionIcon, labelKey: "nav.promotion", roles: ["office", "principal", "class_teacher"] },
  { href: "/dashboard/manage", icon: ManageIcon, labelKey: "nav.manage", roles: ["office"] },
  { href: "/dashboard/admin", icon: ReportIcon, labelKey: "nav.schoolAdmin", roles: ["office", "principal"] },
  { href: "/dashboard/details", icon: RoleStudentIcon, labelKey: "nav.details", roles: ["student"] },
];

// NOTE: the AI "Twin" tab is intentionally NOT in the nav yet — its page lives on
// an un-merged branch. Re-add the /dashboard/twin entry (and "twin" to GateModule
// + the console module toggles) when the Twin feature ships, so it never shows a
// broken 404 tab in the meantime.

// A paid module counts as on only when the institution's registry switches it on.
// Core tabs (no `module`) are always on. `enabled` is the school.modules map.
export function moduleOn(module: GateModule | undefined, enabled: Record<string, boolean> | undefined): boolean {
  if (!module) return true;
  return !!enabled?.[module];
}

export function navFor(role: NavRole, enabled?: Record<string, boolean>): NavItem[] {
  const seen = new Set<string>();
  return NAV
    .filter((i) => i.roles.includes(role))
    .filter((i) => moduleOn(i.module, enabled))
    .filter((i) => {
      if (seen.has(i.href)) return false;
      seen.add(i.href);
      return true;
    });
}
