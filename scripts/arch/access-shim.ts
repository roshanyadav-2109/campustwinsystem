// Reads the live route registry (the same functions the menu and page guard use).
import { canOpen, type NavRole } from "../../src/lib/nav";
import { ROUTES } from "../../src/editions/registry";
export const allHrefs = () => [...new Set(ROUTES.map((r) => r.href))];
export const roleCanOpenForSnapshot = (role: NavRole, href: string, mods: Record<string, boolean>) => canOpen(role, href, mods, "school");
