// The school edition. Everything that exists only for this kind of institution
// lives in this folder. It may import from src/core and shared UI, never from
// another edition folder (scripts/arch/check-boundaries.mjs enforces this).
import type { RouteDef } from "@/core/routes";
import type { EditionWords } from "@/core/words";
import { ReportIcon } from "@/components/icons";

export const routes: RouteDef[] = [
  // Report cards: the school defines its own schemes (board formats are data, not code).
  { href: "/dashboard/report-cards", icon: ReportIcon, labelKey: "nav.reportCards", roles: ["class_teacher", "principal", "office", "guardian", "student"], group: "academics" },
  { href: "/dashboard/settings/report-cards", labelKey: "settings.reportCards", roles: ["office"], group: "settings", menu: false },
];

export const words: EditionWords = {
  group: "Section",
  groupParent: "Class",
  period: "Term",
  leadTeacher: "Class teacher",
  teacher: "Teacher",
  reportCard: "Report card",
  mainUser: "Parent",
};
