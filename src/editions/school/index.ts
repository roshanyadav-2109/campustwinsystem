// The school edition. Everything that exists only for this kind of institution
// lives in this folder. It may import from src/core and shared UI, never from
// another edition folder (scripts/arch/check-boundaries.mjs enforces this).
import type { RouteDef } from "@/core/routes";
import type { EditionWords } from "@/core/words";

export const routes: RouteDef[] = [];

export const words: EditionWords = {
  group: "Section",
  groupParent: "Class",
  period: "Term",
  leadTeacher: "Class teacher",
  teacher: "Teacher",
  reportCard: "Report card",
  mainUser: "Parent",
};
