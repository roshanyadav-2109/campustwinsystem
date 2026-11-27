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
  { href: "/dashboard/courses", icon: MarksIcon, labelKey: "nav.courses", roles: ["office", "principal", "student"], group: "academics", editions: ["college", "university"] , types: ["dean", "dept_head", "programme_coord"] },
  { href: "/dashboard/lectures", icon: AttendanceIcon, labelKey: "nav.lectures", roles: ["subject_teacher", "class_teacher", "principal", "office", "student"], group: "academics", editions: ["college", "university"] , types: ["dean", "dept_head", "programme_coord"] },
  { href: "/dashboard/relaxations", icon: LeaveIcon, labelKey: "nav.relaxations", roles: ["subject_teacher", "class_teacher", "principal", "office"], group: "academics", editions: ["college", "university"] , types: ["dean", "dept_head", "programme_coord", "exams_head"] },
  { href: "/dashboard/results", icon: ReportIcon, labelKey: "nav.results", roles: ["class_teacher", "principal", "office", "student", "guardian"], group: "academics", editions: ["college", "university"] , types: ["dean", "dept_head", "programme_coord", "exams_head", "exams_deputy", "exams_staff"] },
  // Exam timetable and admit cards (hall tickets in colleges: registered courses only)
  { href: "/dashboard/exam-timetable", icon: CalendarIcon, labelKey: "nav.examTimetable", roles: ["subject_teacher", "class_teacher", "principal", "office", "guardian", "student"], group: "academics" , types: ["exams_head", "exams_deputy", "exams_staff"] },
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
  { href: "/dashboard/staff-attendance", icon: AttendanceIcon, labelKey: "nav.staffAttendance", roles: ["principal", "office"], group: "staff" },
  { href: "/dashboard/substitutions", icon: AllotmentIcon, labelKey: "nav.substitutions", roles: ["principal", "office"], group: "staff" },
  { href: "/dashboard/front-desk", icon: AnnounceIcon, labelKey: "nav.frontDesk", roles: ["principal", "office"], group: "campus" },
  { href: "/dashboard/front-desk", icon: AnnounceIcon, labelKey: "nav.pickupHealth", roles: ["guardian"], group: "students" },
  { href: "/dashboard/hostel", icon: ManageIcon, labelKey: "nav.hostel", roles: ["principal", "office"], module: "hostel", group: "campus" },
  { href: "/dashboard/inventory", icon: ManageIcon, labelKey: "nav.inventory", roles: ["principal", "office"], group: "campus" },
  { href: "/dashboard/gate-scan", icon: StudentsIcon, labelKey: "nav.gateScan", roles: ["principal", "office", "transport"], group: "campus" },
  { href: "/dashboard/allotments", icon: AllotmentIcon, labelKey: "nav.allotments", roles: ["principal", "office"], group: "staff" },
  { href: "/dashboard/promotion", icon: PromotionIcon, labelKey: "nav.promotion", roles: ["office", "principal", "class_teacher"], group: "students" },
  { href: "/dashboard/details", icon: RoleStudentIcon, labelKey: "nav.details", roles: ["student"], group: "students" },
  { href: "/dashboard/id-card", icon: StudentsIcon, labelKey: "nav.idCard", roles: ["student", "guardian"], group: "students" },
  // Office editing of student records, opened from Students.
  { href: "/dashboard/students/manage", labelKey: "nav.studentRecords", roles: ["office"], group: "students", menu: false },

  // Settings: one entry in the menu; its sections are listed inside Settings.
  { href: "/dashboard/settings", icon: ManageIcon, labelKey: "nav.settings", roles: ["office", "principal"], group: "settings", types: ["exams_head", "exams_deputy"] },
  { href: "/dashboard/settings/institution", labelKey: "settings.institution", roles: ["office"], group: "settings", menu: false },
  { href: "/dashboard/settings/programmes", labelKey: "settings.programmes", roles: ["office", "principal"], group: "settings", menu: false, editions: ["college", "university"] },
  { href: "/dashboard/settings/positions", labelKey: "settings.positions", roles: ["office", "principal"], group: "settings", menu: false, editions: ["college", "university"] },
  { href: "/dashboard/settings/attendance-rules", labelKey: "settings.attendanceRules", roles: ["office", "principal"], group: "settings", menu: false, editions: ["college", "university"] , types: ["exams_head"] },
  { href: "/dashboard/settings/evaluation", labelKey: "settings.evaluation", roles: ["office", "principal"], group: "settings", menu: false, editions: ["college", "university"] , types: ["exams_head", "exams_deputy"] },
  { href: "/dashboard/settings/classes", labelKey: "settings.classes", roles: ["office"], group: "settings", menu: false },
  { href: "/dashboard/settings/teachers", labelKey: "settings.teachers", roles: ["office"], group: "settings", menu: false },
  { href: "/dashboard/settings/exams", labelKey: "settings.exams", roles: ["office"], group: "settings", menu: false },
  { href: "/dashboard/settings/fees", labelKey: "settings.fees", roles: ["office"], module: "fees", group: "settings", menu: false },
  { href: "/dashboard/settings/transport", labelKey: "settings.transport", roles: ["principal", "office"], module: "transport", group: "settings", menu: false },
  { href: "/dashboard/settings/access", labelKey: "settings.access", roles: ["office"], group: "settings", menu: false },
  { href: "/dashboard/settings/payments", labelKey: "settings.payments", roles: ["office", "principal"], module: "fees", group: "settings", menu: false },
  { href: "/dashboard/settings/messages", labelKey: "settings.messages", roles: ["office", "principal"], group: "settings", menu: false },
  { href: "/dashboard/settings/admin", labelKey: "settings.admin", roles: ["office", "principal"], group: "settings", menu: false },

  // Opened from elsewhere, not listed in the menu.
  { href: "/dashboard/notifications", labelKey: "nav.notifications", roles: ALL, group: "home", menu: false },
  { href: "/dashboard/search", labelKey: "nav.search", roles: ALL, group: "home", menu: false },
  { href: "/dashboard/feedback", labelKey: "nav.feedback", roles: ["guardian", "class_teacher", "principal"], group: "home", menu: false },
];
