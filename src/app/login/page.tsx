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
  // links a payment gateway checks for on the institution's site
  return (<>
    <LoginView brand={brand} owner={owner} demo={demo} />
    {!owner && brand.schoolId && (
      <footer className="flex flex-wrap justify-center gap-x-4 gap-y-1 px-4 py-3 text-[12px] text-ink-500">
        {[["about", "About us"], ["contact", "Contact us"], ["privacy", "Privacy policy"], ["terms", "Terms and conditions"], ["refund", "Refund and cancellation"], ["delivery", "Service delivery"]].map(([k, l]) => (
          <a key={k} href={`/policies/${k}`} className="hover:underline">{l}</a>))}
      </footer>
    )}
  </>);
}
