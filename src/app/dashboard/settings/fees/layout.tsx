import { guardTab } from "@/lib/access";
import { PageHeader } from "@/components/ui/page-header";
import { SubTabs } from "@/components/settings/sub-tabs";

const BASE = "/dashboard/settings/fees";

// Fee settings: what is charged, when, who pays less, and what happens when
// a bill is late. Collecting money stays on the Fees page.
export default async function FeeSettingsLayout({ children }: { children: React.ReactNode }) {
  const denied = await guardTab(BASE);
  if (denied) return denied;
  return (
    <div>
      <PageHeader title="Fees" description="Set once a year. Daily collection is on the Fees page." />
      <SubTabs label="Fee settings" items={[
        { href: BASE, label: "Fee structure" },
        { href: `${BASE}/instalments`, label: "Instalments" },
        { href: `${BASE}/concessions`, label: "Concessions" },
        { href: `${BASE}/late-fee`, label: "Late fee" },
      ]} />
      {children}
    </div>
  );
}
