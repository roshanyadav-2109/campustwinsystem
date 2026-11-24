import { headers } from "next/headers";
import { getBrand, slugFromHost } from "@/lib/brand-server";
import { Suspended } from "@/components/suspended";
import { LoginView } from "./login-view";

// Public sign-in, branded from the subdomain. The company console host gets a
// plain owner sign-in (no school or demo logins).
export default async function LoginPage() {
  const owner = slugFromHost((await headers()).get("host")) === "console";
  const brand = await getBrand();
  if (brand.slug && brand.status === "suspended") return <Suspended name={brand.name} />;
  return <LoginView brand={brand} owner={owner} />;
}
