import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient, createCoreReader } from "@/lib/supabase";

export const ORG_COOKIE = "hr_org";

export type Org = { id: string; name: string };
export type Ctx = {
  db: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  email: string | null;
  org: Org;
  orgs: Org[];
  isAdmin: boolean;
  employeeId: number | null;
  isManager: boolean;
};

// Everything a page needs to know about who is signed in and which
// organisation they are working in. Cached for the request.
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

  const [{ data: isAdmin }, { data: employeeId }] = await Promise.all([
    db.rpc("is_admin", { p_org: org.id }),
    db.rpc("my_employee", { p_org: org.id }),
  ]);
  let isManager = false;
  if (employeeId) {
    const { count } = await db.from("employee").select("id", { count: "exact", head: true })
      .eq("org_id", org.id).eq("manager_id", employeeId).neq("status", "left");
    isManager = (count ?? 0) > 0;
  }

  return {
    db,
    userId,
    email: (claims?.claims?.email as string | undefined) ?? null,
    org,
    orgs,
    isAdmin: !!isAdmin,
    employeeId: (employeeId as number | null) ?? null,
    isManager,
  };
});

// For pages only HR admins (or managers, where allowed) may open.
export async function requireAdmin(): Promise<Ctx> {
  const ctx = await getCtx();
  if (!ctx.isAdmin) redirect("/home");
  return ctx;
}

export async function requireApprover(): Promise<Ctx> {
  const ctx = await getCtx();
  if (!ctx.isAdmin && !ctx.isManager) redirect("/home");
  return ctx;
}
