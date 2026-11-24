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
  // must agree: someone from school A opening school B's portal is sent back to
  // their own portal instead of seeing A's data under B's name. A central
  // university admin may move between that university's own campuses.
  const hostSlug = slugFromHost((await headers()).get("host"));
  if (hostSlug && hostSlug !== "console" && session.school.slug && hostSlug !== session.school.slug) {
    const ownCampus = session.campuses.some((c) => c.slug === hostSlug);
    if (!ownCampus) {
      const base = process.env.NEXT_PUBLIC_BASE_DOMAIN || "campustwin.org";
      redirect(`https://${session.school.slug}.${base}/dashboard`);
    }
  }
  // A suspended institution can't use the app (company console sets this).
  if (session.school.status === "suspended") {
    const { Suspended } = await import("@/components/suspended");
    return <Suspended name={session.school.name} />;
  }
  const { t } = await getT();
  const roleLabel = t(`roles.${session.navRole}`);
  const university = session.isUniversityAdmin && session.university
    ? { name: session.university.name, activeCampusName: session.school.name }
    : null;
  return (
    <AppShell name={session.fullName} role={session.navRole as NavRole} roleLabel={roleLabel} modules={session.school.modules} brand={{ name: session.school.name, place: session.school.place, logo: session.school.logoUrl, monogram: session.school.monogram }} university={university}>
      {children}
    </AppShell>
  );
}
