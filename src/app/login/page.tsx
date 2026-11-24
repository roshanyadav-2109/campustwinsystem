import { headers } from "next/headers";
import { getBrand, slugFromHost } from "@/lib/brand-server";
import { createAdminClient } from "@/lib/supabase/admin";
import { Suspended } from "@/components/suspended";
import { LoginView } from "./login-view";

// Public sign-in, branded from the subdomain. The console host gets a plain
// sign-in. Demo role buttons only appear on a school that owns the demo
// accounts, so a demo click can never land someone in another school.
export default async function LoginPage() {
  const owner = slugFromHost((await headers()).get("host")) === "console";
  const brand = await getBrand();
  if (brand.slug && brand.status === "suspended") return <Suspended name={brand.name} />;
  let demo = false;
  if (!owner && brand.schoolId) {
    const { count } = await createAdminClient().from("staff").select("*", { count: "exact", head: true }).eq("school_id", brand.schoolId).ilike("email", "%@kv.demo");
    demo = (count ?? 0) > 0;
  }
  return <LoginView brand={brand} owner={owner} demo={demo} />;
}
