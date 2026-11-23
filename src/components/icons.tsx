/* eslint-disable @next/next/no-img-element -- fixed-size static icons; next/image adds nothing here */
// Central icon set — the school's own illustrated icons (public/icons/*.png,
// transparent, 128×128), cut from the approved icon sheets. This is the ONLY
// place icons are referenced: every page imports these names, so swapping an
// icon means replacing its PNG.

export type IconProps = { className?: string; size?: number; strokeWidth?: number; active?: boolean };
export type IconComponent = React.ComponentType<IconProps>;

// One outline set, drawn inline: 24 box, 1.5 stroke, the colour of the text around it.
const PATHS: Record<string, string> = {
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  transport: '<rect x="4" y="3" width="16" height="13" rx="2.5"/><path d="M4 10h16M8 16v2.5M16 16v2.5"/><circle cx="8" cy="13" r=".6"/><circle cx="16" cy="13" r=".6"/>',
  "bus-riders": '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.700 6 6M16 5.200a3.200 3.200 0 0 1 0 5.600M18 14.500c1.800.9 3 2.700 3 5"/>',
  progress: '<path d="M3 3v18h18"/><path d="M7 15l4-5 3 3 5-7"/>',
  attendance: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 3h6v3H9zM9 13l2 2 4-4.500"/>',
  marks: '<path d="M4 20h4L19 9l-4-4L4 16v4zM13.500 6.500l4 4"/>',
  students: '<path d="M2.500 9.500 12 5l9.500 4.500L12 14 2.500 9.500z"/><path d="M6.500 11.500V16c1.500 1.500 3.500 2.200 5.500 2.200s4-.7 5.500-2.200v-4.500M21.500 9.500V15"/>',
  announcements: '<path d="M4 10v4h3l8 4.500v-13L7 10H4zM18.500 9a4 4 0 0 1 0 6"/>',
  calendar: '<rect x="3.500" y="5" width="17" height="16" rx="2"/><path d="M3.500 10h17M8 3v4M16 3v4"/>',
  reports: '<path d="M6 3h8l4 4v14H6V3z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>',
  leave: '<rect x="3.500" y="5" width="17" height="16" rx="2"/><path d="M3.500 10h17M8 3v4M16 3v4M9.500 14l5 4M14.500 14l-5 4"/>',
  feedback: '<path d="M4 5h16v11H9l-5 4V5z"/><path d="M8 9.500h8M8 12.500h5"/>',
  "assigned-teachers": '<circle cx="12" cy="6" r="2.500"/><circle cx="5" cy="17" r="2.500"/><circle cx="19" cy="17" r="2.500"/><path d="M12 8.500v3M12 11.500 6.500 15M12 11.500l5.500 3.500"/>',
  promotion: '<path d="M4 20V10M10 20V4M16 20v-8M3 20h18M17 7l3-3 0 0M20 4v3.500M20 4h-3.500"/>',
  "role-principal": '<circle cx="12" cy="9" r="5"/><path d="M9 13.500 7.500 21l4.500-2.500L16.500 21 15 13.500"/>',
  "role-teacher": '<rect x="3" y="4" width="18" height="12" rx="1.500"/><path d="M8 20h8M12 16v4M7 9h6M7 12h4"/>',
  "role-parent": '<circle cx="8" cy="7" r="3"/><circle cx="17" cy="10" r="2.200"/><path d="M2.500 20c0-3 2.500-5.500 5.500-5.500s5.500 2.500 5.500 5.500M14.500 20c0-2 1.300-3.800 3-4.300 2 .2 3.500 2 3.500 4.300"/>',
  "role-student": '<circle cx="12" cy="8" r="3.500"/><path d="M5 20.500c0-3.900 3.100-7 7-7s7 3.100 7 7"/>',
  "role-office": '<rect x="4" y="3" width="16" height="18" rx="1.500"/><path d="M8 7h3M13 7h3M8 11h3M13 11h3M8 15h3M13 15h3M10 21v-3h4v3"/>',
  "role-conductor": '<rect x="4" y="3" width="16" height="13" rx="2.500"/><path d="M4 10h16M8 16v2.500M16 16v2.500"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  signout: '<path d="M10 4H5v16h5M14 8l4 4-4 4M18 12H9"/>',
  language: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.500 2.500 3.800 5.500 3.800 9s-1.300 6.500-3.800 9c-2.500-2.500-3.800-5.500-3.800-9S9.500 5.500 12 3z"/>',
  search: '<circle cx="11" cy="11" r="6.500"/><path d="M16 16l4.500 4.500"/>',
  add: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="M5 12.500l4.500 4.500L19 7.500"/>',
  alert: '<path d="M12 4 2.500 20h19L12 4z"/><path d="M12 10v4.500M12 17.200v.1"/>',
  "arrow-right": '<path d="M5 12h14M13 6l6 6-6 6"/>',
  "trend-up": '<path d="M7 17 17 7M9 7h8v8"/>',
  "trend-down": '<path d="M7 7l10 10M17 9v8H9"/>',
  "chart-line": '<path d="M3 3v18h18"/><path d="M7 15l4-5 3 3 5-7"/>',
  "chart-bar": '<path d="M3 3v18h18M8 17v-6M13 17V8M18 17v-9"/>',
  notebook: '<path d="M6 3h12a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H6V3z"/><path d="M6 3v18M3.500 7.500H6M3.500 12H6M3.500 16.500H6M10 8h5M10 12h5"/>',
  print: '<path d="M7 8V3h10v5M7 17H4.500V9h15v8H17"/><rect x="7" y="14" width="10" height="7"/>',
  excel: '<rect x="3.500" y="4" width="17" height="16" rx="1.500"/><path d="M3.500 9.500h17M3.500 14.500h17M9.500 4v16"/>',
};

// The school's own icon set (public/icons/set): an outline drawing for every
// icon, and a filled colour drawing shown when the thing it stands for is selected.
const SET = new Set(["dashboard", "transport", "bus-riders", "progress", "attendance", "marks", "students", "announcements", "calendar", "reports", "leave", "feedback",
  "assigned-teachers", "promotion", "fees", "library", "homework", "admissions", "staff-hr", "manage", "role-principal", "role-teacher", "role-parent", "role-student",
  "role-office", "role-conductor", "search", "add", "check", "alert", "close", "signout", "language", "print", "excel", "arrow-right"]);

function make(name: string, file: string): IconComponent {
  function Icon({ className, size = 18, active }: IconProps) {
    if (SET.has(file)) {
      if (active) {
        return (
          // eslint-disable-next-line @next/next/no-img-element -- small fixed-size icon
          <img src={`/icons/set/${file}-fill.png`} width={size} height={size} alt="" aria-hidden draggable={false} className={className}
            style={{ width: size, height: size, objectFit: "contain", flexShrink: 0 }} />
        );
      }
      // The outline is used as a mask, so it takes the colour of the text around it.
      const url = `url(/icons/set/${file}.png)`;
      return (
        <span aria-hidden className={className}
          style={{ width: size, height: size, flexShrink: 0, display: "inline-block", backgroundColor: "currentColor",
            WebkitMaskImage: url, maskImage: url, WebkitMaskSize: "contain", maskSize: "contain", WebkitMaskRepeat: "no-repeat", maskRepeat: "no-repeat", WebkitMaskPosition: "center", maskPosition: "center" }} />
      );
    }
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"
        aria-hidden className={className} style={{ flexShrink: 0 }} dangerouslySetInnerHTML={{ __html: PATHS[file] ?? PATHS.dashboard }} />
    );
  }
  Icon.displayName = name;
  return Icon;
}

// ── Side menu ────────────────────────────────────────────────────────────────
export const DashboardIcon = make("DashboardIcon", "dashboard");
export const BusIcon = make("BusIcon", "transport");
export const BusRidersIcon = make("BusRidersIcon", "bus-riders");
export const ProgressIcon = make("ProgressIcon", "progress");
export const AttendanceIcon = make("AttendanceIcon", "attendance");
export const MarksIcon = make("MarksIcon", "marks");
export const StudentsIcon = make("StudentsIcon", "students");
export const AnnounceIcon = make("AnnounceIcon", "announcements");
export const CalendarIcon = make("CalendarIcon", "calendar");
export const ReportIcon = make("ReportIcon", "reports");
export const LeaveIcon = make("LeaveIcon", "leave");
export const FeedbackIcon = make("FeedbackIcon", "feedback");
export const AllotmentIcon = make("AllotmentIcon", "assigned-teachers");
export const PromotionIcon = make("PromotionIcon", "promotion");

// ── Sign-in roles ────────────────────────────────────────────────────────────
export const RolePrincipalIcon = make("RolePrincipalIcon", "role-principal");
export const RoleTeacherIcon = make("RoleTeacherIcon", "role-teacher");
export const RoleParentIcon = make("RoleParentIcon", "role-parent");
export const RoleStudentIcon = make("RoleStudentIcon", "role-student");
export const RoleOfficeIcon = make("RoleOfficeIcon", "role-office");
export const RoleConductorIcon = make("RoleConductorIcon", "role-conductor");
export const AwardIcon = RolePrincipalIcon;

// ── Buttons and small UI ─────────────────────────────────────────────────────
export const MenuIcon = make("MenuIcon", "menu");
export const CloseIcon = make("CloseIcon", "close");
export const LogoutIcon = make("LogoutIcon", "signout");
export const LanguageIcon = make("LanguageIcon", "language");
export const SearchIcon = make("SearchIcon", "search");
export const PlusIcon = make("PlusIcon", "add");
export const CheckIcon = make("CheckIcon", "check");
export const AlertIcon = make("AlertIcon", "alert");
export const ArrowRightIcon = make("ArrowRightIcon", "arrow-right");
export const ArrowUpRightIcon = make("ArrowUpRightIcon", "trend-up");
export const ArrowDownRightIcon = make("ArrowDownRightIcon", "trend-down");
export const ChartLineIcon = make("ChartLineIcon", "chart-line");
export const ViewsIcon = make("ViewsIcon", "chart-bar");
export const NotebookIcon = make("NotebookIcon", "homework");
export const FeesIcon = make("FeesIcon", "fees");
export const LibraryIcon = make("LibraryIcon", "library");
export const HomeworkIcon = make("HomeworkIcon", "homework");
export const AdmissionsIcon = make("AdmissionsIcon", "admissions");
export const StaffHrIcon = make("StaffHrIcon", "staff-hr");
export const ManageIcon = make("ManageIcon", "manage");
export const PrintIcon = make("PrintIcon", "print");
export const ExcelIcon = make("ExcelIcon", "excel");
