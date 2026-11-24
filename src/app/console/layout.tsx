import { redirect } from "next/navigation";
import { getOwnerEmail } from "@/lib/owner";
import { TopBar, ConsoleFooter } from "@/components/console/topbar";

// Owner gate + the global chrome (dark top bar, footer). Each section supplies
// its own Shell underneath, so the left navigation switches to match context.
export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const owner = await getOwnerEmail();
  if (!owner) redirect("/login?next=/console");
  return (
    <div className="flex min-h-dvh flex-col bg-cx-bg text-cx-text">
      <TopBar owner={owner} />
      <div className="flex-1">{children}</div>
      <ConsoleFooter />
    </div>
  );
}
