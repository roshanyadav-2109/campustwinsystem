import { getBrand } from "@/lib/brand-server";
import { Suspended } from "@/components/suspended";
import { LoginView } from "./login-view";

// Public sign-in. The institution's branding is resolved from the subdomain
// (falls back to the single institution on the apex / localhost).
export default async function LoginPage() {
  const brand = await getBrand();
  // A suspended institution can't sign in.
  if (brand.slug && brand.status === "suspended") return <Suspended name={brand.name} />;
  return <LoginView brand={brand} />;
}
