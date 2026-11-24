import { redirect } from "next/navigation";
import { getOwnerEmail } from "@/lib/owner";

// Owner gate only. The platform rail and each institution workspace supply their
// own Shell underneath, so the left navigation can switch to match the context.
export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const owner = await getOwnerEmail();
  if (!owner) redirect("/login?next=/console");
  return <div className="min-h-dvh bg-paper text-ink-900">{children}</div>;
}
