// Prints, for every role and module combination, the pages that role may open.
// Run before and after a navigation change; the sets must not shrink.
// npx -y tsx scripts/arch/access-snapshot.tsx > out.json
import { roleCanOpenForSnapshot, allHrefs } from "./access-shim";
const ROLES = ["student", "guardian", "subject_teacher", "class_teacher", "principal", "office", "transport"] as const;
const MODS = ["fees", "library", "homework", "admissions", "hr", "transport"];
const combos: Record<string, boolean>[] = [Object.fromEntries(MODS.map((m) => [m, true])), Object.fromEntries(MODS.map((m) => [m, false]))];
const out: Record<string, string[]> = {};
for (const r of ROLES) for (const [i, mods] of combos.entries()) {
  out[`${r}:${i === 0 ? "all-modules" : "no-modules"}`] = allHrefs().filter((h) => roleCanOpenForSnapshot(r, h, mods)).sort();
}
console.log(JSON.stringify(out, null, 1));
