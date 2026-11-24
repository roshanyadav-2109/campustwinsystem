import { createAdminClient } from "@/lib/supabase/admin";
import { Shell } from "@/components/console/shell";
import { Crumbs } from "@/components/console/crumbs";
import { PlatformPanel } from "@/components/console/platform-panel";

export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const admin = createAdminClient();
  const [{ data: unis }, { data: schools }] = await Promise.all([
    admin.from("university").select("id, name, status").order("name"),
    admin.from("school").select("id, name, status").is("university_id", null).order("name"),
  ]);
  return (
    <Shell
      panel={
        <PlatformPanel
          universities={(unis ?? []).map((u) => ({ href: `/console/university/${u.id}`, name: u.name, status: u.status ?? "active" }))}
          schools={(schools ?? []).map((s) => ({ href: `/console/school/${s.id}`, name: s.name, status: s.status }))}
        />
      }
      crumbs={<Crumbs trail={[{ label: "Console", href: "/console" }]} base="/console" zones={{ institutions: "Institutions", new: "New institution", owners: "Team" }} />}
    >
      {children}
    </Shell>
  );
}
