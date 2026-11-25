import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient, createCoreReader } from "@/lib/supabase";

export const ORG_COOKIE = "desk_org";

export type Org = { id: string; name: string };
export type Ctx = {
  db: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  email: string | null;
  org: Org;
  orgs: Org[];
  role: "admin" | "agent";
  isAdmin: boolean;
  setUp: boolean;
};

// Who is signed in, which organisation's help desk is open, and their role.
export const getCtx = cache(async (): Promise<Ctx> => {
  const db = await createClient();
  const { data: claims } = await db.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (!userId) redirect("/login");

  const { data: orgIds } = await db.rpc("my_orgs");
  const ids = (orgIds ?? []) as unknown as string[];
  if (!ids.length) redirect("/no-access");
  const { data: rows } = await createCoreReader().from("organisation").select("id, name").in("id", ids).order("name");
  const orgs: Org[] = (rows ?? []).map((r) => ({ id: r.id, name: r.name }));
  if (!orgs.length) redirect("/no-access");

  const chosen = (await cookies()).get(ORG_COOKIE)?.value;
  const org = orgs.find((o) => o.id === chosen) ?? orgs[0];
  const [{ data: role }, { count }] = await Promise.all([
    db.rpc("role", { p_org: org.id }),
    db.from("settings").select("org_id", { count: "exact", head: true }).eq("org_id", org.id),
  ]);
  const r = (role as "admin" | "agent" | null) ?? "agent";
  return { db, userId, email: (claims?.claims?.email as string | undefined) ?? null, org, orgs, role: r, isAdmin: r === "admin", setUp: (count ?? 0) > 0 };
});

export async function requireSetUp(): Promise<Ctx> {
  const ctx = await getCtx();
  if (!ctx.setUp) redirect("/home");
  return ctx;
}

export async function requireAdmin(): Promise<Ctx> {
  const ctx = await requireSetUp();
  if (!ctx.isAdmin) redirect("/home");
  return ctx;
}
