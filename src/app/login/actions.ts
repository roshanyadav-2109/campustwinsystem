"use server";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { DEMO_ACCOUNTS } from "@/lib/demo";
import { slugFromHost } from "@/lib/host-slug";
import { createAdminClient } from "@/lib/supabase/admin";

// Demo role sign-in, done on the server: the browser only names the demo role;
// the password stays a deployment secret (DEMO_PASSWORD), never in the page or
// the code. Only a demo account of the institution whose site this is.
export async function demoSignIn(email: string): Promise<{ ok: true } | { ok: false }> {
  const account = DEMO_ACCOUNTS.find((a) => a.email === email);
  const password = process.env.DEMO_PASSWORD;
  if (!account || !password) return { ok: false };
  const slug = slugFromHost((await headers()).get("host"));
  if (!slug) return { ok: false };
  const admin = createAdminClient();
  const { data: school } = await admin.from("school").select("id").eq("slug", slug).maybeSingle();
  const { count } = school
    ? await admin.from("staff").select("id", { count: "exact", head: true }).eq("school_id", school.id).ilike("email", "%@kv.demo")
    : { count: 0 };
  if (!count) return { ok: false };
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email: account.email, password });
  return error ? { ok: false } : { ok: true };
}
