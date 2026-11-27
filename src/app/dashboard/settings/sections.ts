import { openableRoutes } from "@/core/routes";
import { ROUTES } from "@/editions/registry";
import type { Session } from "@/lib/session";

// The Settings sections this person may open here, in registry order.
export function settingsSections(session: Session) {
  return openableRoutes(ROUTES, session.navRole, session.school.modules, session.school.edition, session.accessTypes)
    .filter((r) => r.group === "settings" && r.href !== "/dashboard/settings");
}
