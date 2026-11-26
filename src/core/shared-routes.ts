// Pages every edition has today. Pages that belong to one edition only are
// declared in that edition's folder (src/editions/<edition>/routes.ts).
import {
  DashboardIcon, ProgressIcon, AttendanceIcon, MarksIcon, StudentsIcon,
  AnnounceIcon, CalendarIcon, ReportIcon, LeaveIcon, AllotmentIcon,
  PromotionIcon, RoleStudentIcon, BusIcon, BusRidersIcon, FeesIcon, LibraryIcon,
  HomeworkIcon, AdmissionsIcon, StaffHrIcon, ManageIcon,
} from "@/components/icons";
import { ALL_ROLES as ALL, type RouteDef } from "@/core/routes";

export const SHARED_ROUTES: RouteDef[] = [
  { href: "/dashboard", icon: DashboardIcon, labelKey: "nav.dashboard", roles: ALL, group: "home" },
  { href: "/dashboard/transport", icon: BusIcon, labelKey: "nav.transport", roles: [...ALL, "transport"], module: "transport", group: "campus" },
  { href: "/dashboard/transport/riders", icon: BusRidersIcon, labelKey: "nav.transportRiders", roles: ["principal", "office"], module: "transport", group: "campus" },
  { href: "/dashboard/progress", icon: ProgressIcon, labelKey: "nav.myProgress", roles: ["student"], group: "academics" },
  { href: "/dashboard/progress", icon: ProgressIcon, labelKey: "nav.childProgress", roles: ["guardian"], group: "academics" },
  { href: "/dashboard/progress", icon: ProgressIcon, labelKey: "nav.progress", roles: ["subject_teacher", "class_teacher", "principal"], group: "academics" },
  { href: "/dashboard/attendance", icon: AttendanceIcon, labelKey: "nav.attendance", roles: ALL, group: "academics" },
  { href: "/dashboard/schedule", icon: CalendarIcon, labelKey: "nav.schedule", roles: ALL, group: "academics" },
  { href: "/dashboard/marks", icon: MarksIcon, labelKey: "nav.marks", roles: ["subject_teacher", "class_teacher", "office"], group: "academics" },
  { href: "/dashboard/students", icon: StudentsIcon, labelKey: "nav.students", roles: ["class_teacher", "principal", "office"], group: "students" },
  { href: "/dashboard/announcements", icon: AnnounceIcon, labelKey: "nav.announcements", roles: ALL, group: "campus" },
  { href: "/dashboard/calendar", icon: CalendarIcon, labelKey: "nav.calendar", roles: ALL, group: "campus" },
  { href: "/dashboard/reports", icon: ReportIcon, labelKey: "nav.reports", roles: ["student", "guardian", "class_teacher", "principal", "office"], group: "academics" },
  { href: "/dashboard/fees", icon: FeesIcon, labelKey: "nav.fees", roles: ["student", "guardian", "principal", "office"], module: "fees", group: "fees" },
  { href: "/dashboard/library", icon: LibraryIcon, labelKey: "nav.library", roles: ["student", "subject_teacher", "class_teacher", "principal", "office"], module: "library", group: "campus" },
  { href: "/dashboard/homework", icon: HomeworkIcon, labelKey: "nav.homework", roles: ["student", "guardian", "subject_teacher", "class_teacher", "principal"], module: "homework", group: "academics" },
  { href: "/dashboard/admissions", icon: AdmissionsIcon, labelKey: "nav.admissions", roles: ["principal", "office"], module: "admissions", group: "students" },
  { href: "/dashboard/hr", icon: StaffHrIcon, labelKey: "nav.hr", roles: ["subject_teacher", "class_teacher", "principal", "office"], module: "hr", group: "staff" },
  { href: "/dashboard/leave", icon: LeaveIcon, labelKey: "nav.leave", roles: ["student", "guardian", "class_teacher"], group: "students" },
  { href: "/dashboard/allotments", icon: AllotmentIcon, labelKey: "nav.allotments", roles: ["principal", "office"], group: "staff" },
  { href: "/dashboard/promotion", icon: PromotionIcon, labelKey: "nav.promotion", roles: ["office", "principal", "class_teacher"], group: "students" },
  { href: "/dashboard/details", icon: RoleStudentIcon, labelKey: "nav.details", roles: ["student"], group: "students" },
  // Office editing of student records, opened from Students.
  { href: "/dashboard/students/manage", labelKey: "nav.studentRecords", roles: ["office"], group: "students", menu: false },

  // Settings: one entry in the menu; its sections are listed inside Settings.
  { href: "/dashboard/settings", icon: ManageIcon, labelKey: "nav.settings", roles: ["office", "principal"], group: "settings" },
  { href: "/dashboard/settings/institution", labelKey: "settings.institution", roles: ["office"], group: "settings", menu: false },
  { href: "/dashboard/settings/classes", labelKey: "settings.classes", roles: ["office"], group: "settings", menu: false },
  { href: "/dashboard/settings/teachers", labelKey: "settings.teachers", roles: ["office"], group: "settings", menu: false },
  { href: "/dashboard/settings/exams", labelKey: "settings.exams", roles: ["office"], group: "settings", menu: false },
  { href: "/dashboard/settings/fees", labelKey: "settings.fees", roles: ["office"], module: "fees", group: "settings", menu: false },
  { href: "/dashboard/settings/transport", labelKey: "settings.transport", roles: ["principal", "office"], module: "transport", group: "settings", menu: false },
  { href: "/dashboard/settings/access", labelKey: "settings.access", roles: ["office"], group: "settings", menu: false },
  { href: "/dashboard/settings/admin", labelKey: "settings.admin", roles: ["office", "principal"], group: "settings", menu: false },

  // Opened from elsewhere, not listed in the menu.
  { href: "/dashboard/search", labelKey: "nav.search", roles: ALL, group: "home", menu: false },
  { href: "/dashboard/feedback", labelKey: "nav.feedback", roles: ["guardian", "class_teacher", "principal"], group: "home", menu: false },
];
