import "server-only";
import type { Ctx } from "@/lib/context";

// Agents of the organisation by login id, shown by the part of their email
// before the @ (their name is not stored).
export async function agentMap(db: Ctx["db"], org: string) {
  const { data } = await db.rpc("agents", { p_org: org });
  const list = (data ?? []) as { user_id: string; email: string; role: string }[];
  const label = (e: string) => e.split("@")[0].replace(/[._-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const unique = new Map<string, { id: string; name: string; email: string }>();
  for (const a of list) if (!unique.has(a.user_id)) unique.set(a.user_id, { id: a.user_id, name: label(a.email), email: a.email });
  return { list: [...unique.values()].sort((a, b) => a.name.localeCompare(b.name)), names: new Map([...unique.values()].map((a) => [a.id, a.name])) };
}
