import { getSession } from "@/lib/session";
import { canOpen, type NavRole } from "@/lib/nav";
import type { Edition } from "@/core/edition";
import { EmptyState } from "@/components/ui/empty";

// May this person open the tab at `href`? The same rule as their side menu, so
// typing or sharing an address can't open a page their role doesn't have — and
// a module the institution has switched off is closed to everyone there.
// (What a page then shows is still limited by the database's row rules.)
// Both the menu and this guard read the route registry, which also lists pages
// that are opened from elsewhere and not shown in the menu.
export function roleCanOpen(role: NavRole, href: string, modules: Record<string, boolean> | undefined, edition: Edition): boolean {
  return canOpen(role, href, modules, edition);
}

// Called at the top of every dashboard page: returns the "no access" screen to
// show instead, or null when the person may see the page.
export async function guardTab(href: string): Promise<React.ReactNode | null> {
  const session = await getSession();
  if (session && roleCanOpen(session.navRole, href, session.school.modules, session.school.edition)) return null;
  return (
    <EmptyState
      art="no-results"
      title="You don't have access to this page"
      hint="This link is for a different role. Ask the person who shared it, or use the menu to find your own pages."
    />
  );
}
