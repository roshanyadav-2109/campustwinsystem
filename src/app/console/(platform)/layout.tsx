import { createAdminClient } from "@/lib/supabase/admin";
import { Shell } from "@/components/console/shell";
import { Crumbs } from "@/components/console/crumbs";
import { PlatformPanel } from "@/components/console/platform-panel";

export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const admin = createAdminClient();
  const [{ data: unis }, { data: schools }] = await Promise.all([
    admin.from("university").select("id, name, slug, status").order("name"),
    admin.from("school").select("id, name, slug, status, university_id").order("name"),
  ]);
  const standalone = (schools ?? []).filter((s) => !s.university_id);
  // Every portal address, for the Health section's drill-down.
  const addresses = [
    { slug: "console", name: "Console" },
    ...(unis ?? []).map((u) => ({ slug: u.slug, name: u.name })),
    ...(schools ?? []).map((s) => ({ slug: s.slug, name: s.name })),
  ];
  return (
    <Shell
      panel={
        <PlatformPanel
          universities={(unis ?? []).map((u) => ({ href: `/console/university/${u.id}`, name: u.name, status: u.status ?? "active" }))}
          schools={standalone.map((s) => ({ href: `/console/school/${s.id}`, name: s.name, status: s.status }))}
          addresses={addresses}
        />
      }
      crumbs={<Crumbs trail={[{ label: "Console", href: "/console" }]} base="/console" zones={{ institutions: "Institutions", new: "New institution", owners: "Team", health: "Health" }} />}
    >
      {children}
    </Shell>
  );
}
