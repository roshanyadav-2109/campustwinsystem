import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getSession } from "@/lib/session";
import { slugFromHost } from "@/lib/brand-server";
import { getT } from "@/i18n/server";
import { AppShell } from "@/components/app-shell";
import type { NavRole } from "@/lib/nav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  // Signed in but with no school record behind the login (or a Google email
  // the office has since changed): sign them out properly, with a reason.
  if (!session) redirect("/auth/signout?error=google_not_registered");
  // Sessions are shared across *.campustwin.org, so the address and the account
  // must agree: someone opening an institution they do not belong to is told so
  // (with links to their own) instead of seeing their data under its name. A
  // central university admin may move between that university's own campuses.
  const hostSlug = slugFromHost((await headers()).get("host"));
  if (hostSlug && hostSlug !== "console" && session.school.slug && hostSlug !== session.school.slug) {
    // The session already follows the person's membership on this website
    // (see getSession); still a mismatch means they do not belong here.
    const ownCampus = session.campuses.some((c) => c.slug === hostSlug);
    if (!ownCampus) {
      const { NotAMember } = await import("@/components/access/not-a-member");
      return <NotAMember hostSlug={hostSlug} />;
    }
  }
  // A suspended institution can't use the app (company console sets this).
  if (session.school.status === "suspended") {
    const { Suspended } = await import("@/components/suspended");
    return <Suspended name={session.school.name} />;
  }
  const { t } = await getT();
  const { createClient } = await import("@/lib/supabase/server");
  const { data: inst } = await (await createClient()).rpc("my_institutions" as never);
  const institutions = ((inst ?? []) as { slug: string; name: string; role: string; school_id: number }[])
    .map((i) => ({ name: i.name, slug: i.slug, role: i.role, current: i.slug === session.school.slug }));
  const roleLabel = t(`roles.${session.navRole}`);
  const university = session.isUniversityAdmin && session.university
    ? { name: session.university.name, activeCampusName: session.school.name }
    : null;
  return (
    <AppShell name={session.fullName} role={session.navRole as NavRole} roleLabel={roleLabel} modules={session.school.modules} edition={session.school.edition} institutions={institutions} brand={{ name: session.school.name, place: session.school.place, logo: session.school.logoUrl, monogram: session.school.monogram }} university={university}>
      {children}
    </AppShell>
  );
}
