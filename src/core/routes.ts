// The route registry: every dashboard page, who may open it, which module and
// editions it belongs to, where it sits in the menu, and whether it shows in
// the menu at all. The side menu AND the page guard both read this list, so a
// page leaving the menu (for example into Settings) never locks it by accident.
import type { IconComponent } from "@/components/icons";
import type { Edition } from "@/core/edition";

export type NavRole = "student" | "guardian" | "subject_teacher" | "class_teacher" | "principal" | "office" | "transport";

// Paid modules an institution can switch on or off. Pages with no module are
// always available.
export type GateModule = "twin" | "fees" | "library" | "homework" | "admissions" | "hr" | "transport";

/** The seven fixed places of the menu, the same for every edition. */
export type NavGroup = "home" | "academics" | "students" | "fees" | "campus" | "staff" | "settings";
export const NAV_GROUPS: NavGroup[] = ["home", "academics", "students", "fees", "campus", "staff", "settings"];

export type RouteDef = {
  href: string;
  labelKey: string;
  icon?: IconComponent;
  roles: NavRole[];
  module?: GateModule;
  /** Editions the page exists in; absent = every edition. */
  editions?: Edition[];
  group: NavGroup;
  /** false = may be opened, but not listed in the side menu. */
  menu?: boolean;
};

export const ALL_ROLES: NavRole[] = ["student", "guardian", "subject_teacher", "class_teacher", "principal", "office"];

export function moduleOn(module: GateModule | undefined, enabled: Record<string, boolean> | undefined): boolean {
  if (!module) return true;
  return !!enabled?.[module];
}

export function editionOn(route: RouteDef, edition: Edition | undefined): boolean {
  return !route.editions || !edition || route.editions.includes(edition);
}

/** Pages this role may open here (menu or not). */
export function openableRoutes(routes: RouteDef[], role: NavRole, enabled?: Record<string, boolean>, edition?: Edition): RouteDef[] {
  return routes.filter((r) => r.roles.includes(role) && moduleOn(r.module, enabled) && editionOn(r, edition));
}

/** The side menu: openable pages that are listed, one entry per address. */
export function menuRoutes(routes: RouteDef[], role: NavRole, enabled?: Record<string, boolean>, edition?: Edition): RouteDef[] {
  const seen = new Set<string>();
  return openableRoutes(routes, role, enabled, edition)
    .filter((r) => r.menu !== false)
    .filter((r) => (seen.has(r.href) ? false : (seen.add(r.href), true)));
}
