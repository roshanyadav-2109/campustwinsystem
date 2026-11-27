// The side menu, read from the route registry (src/editions/registry.ts).
// Kept as the import path the rest of the app already uses.
import type { IconComponent } from "@/components/icons";
import type { Edition } from "@/core/edition";
import { menuRoutes, moduleOn, openableRoutes, type GateModule, type NavGroup, type NavRole, type RouteDef } from "@/core/routes";
import { ROUTES } from "@/editions/registry";

export type { GateModule, NavGroup, NavRole };
export { moduleOn };

export type NavItem = RouteDef & { icon: IconComponent };

// NOTE: the AI "Twin" tab is intentionally NOT in the registry yet: its page
// lives on an un-merged branch. Add it (and "twin" to the console module
// toggles) when the Twin feature ships.

/** Menu entries for a role here, in registry order. */
export function navFor(role: NavRole, enabled: Record<string, boolean> | undefined, edition: Edition, types: string[] = []): NavItem[] {
  return menuRoutes(ROUTES, role, enabled, edition, types).filter((r): r is NavItem => !!r.icon);
}

/** Whether a role may open a page here, listed in the menu or not. */
export function canOpen(role: NavRole, href: string, enabled: Record<string, boolean> | undefined, edition: Edition, types: string[] = []): boolean {
  return openableRoutes(ROUTES, role, enabled, edition, types).some((r) => r.href === href);
}
