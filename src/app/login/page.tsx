import { getBrand } from "@/lib/brand-server";
import { LoginView } from "./login-view";

// Public sign-in. The institution's branding is resolved from the subdomain
// (falls back to the single institution on the apex / localhost).
export default async function LoginPage() {
  const brand = await getBrand();
  return <LoginView brand={brand} />;
}
