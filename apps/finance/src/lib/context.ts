import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient, createCoreReader } from "@/lib/supabase";

export const ORG_COOKIE = "fin_org";

export type Org = { id: string; name: string };
export type Role = "admin" | "accountant" | "viewer";
export type Ctx = {
  db: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  email: string | null;
  org: Org;
  orgs: Org[];
  role: Role;
  canWrite: boolean;
  isAdmin: boolean;
  setUp: boolean;
};

// Who is signed in, which organisation's books are open, and what they may do.
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
  const r = (role as Role | null) ?? "viewer";
  return {
    db, userId, email: (claims?.claims?.email as string | undefined) ?? null, org, orgs,
    role: r, canWrite: r === "admin" || r === "accountant", isAdmin: r === "admin", setUp: (count ?? 0) > 0,
  };
});

// Pages that need the books set up; admins are sent to set them up, others told to wait.
export async function requireBooks(): Promise<Ctx> {
  const ctx = await getCtx();
  if (!ctx.setUp) redirect("/setup");
  return ctx;
}

export async function requireWriter(): Promise<Ctx> {
  const ctx = await requireBooks();
  if (!ctx.canWrite) redirect("/home");
  return ctx;
}

export async function requireAdmin(): Promise<Ctx> {
  const ctx = await requireBooks();
  if (!ctx.isAdmin) redirect("/home");
  return ctx;
}
