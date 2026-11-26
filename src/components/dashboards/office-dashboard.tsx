import { getCurrentYear, type Session } from "@/lib/session";
import { getT } from "@/i18n/server";
import { TodoPanel } from "@/components/dashboards/todo-panel";
import { getOfficeStats } from "@/lib/data/dashboard";
import { StatCard, DashHeader, AnnouncementsPanel, EventsPanel, FleetStrip, ActionButtons } from "@/components/dashboards/parts";
import { MarksIcon, AnnounceIcon, AllotmentIcon } from "@/components/icons";

// Administration overview for the office.
export async function OfficeDashboard({ session }: { session: Session }) {
  const { t } = await getT();
  const year = await getCurrentYear();
  const s = year ? await getOfficeStats(year.id) : null;

  return (
    <div>
      <DashHeader name={session.fullName} />
      <ActionButtons actions={[
        { href: "/dashboard/marks", label: s && s.draft > 0 ? t("dashboard.ctaShareMarks") : t("dashboard.ctaEnterMarks"), icon: MarksIcon },
        { href: "/dashboard/announcements", label: t("dashboard.ctaPostNotice"), icon: AnnounceIcon },
        { href: "/dashboard/allotments", label: t("dashboard.ctaAssignedTeachers"), icon: AllotmentIcon },
      ]} />
      <TodoPanel session={session} />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label={t("common.students")} value={s?.students ?? "—"} tone="gold" />
        <StatCard label={t("roles.staff")} value={s?.staff ?? "—"} />
        <StatCard label={t("nav.allotments")} value={s?.allotments ?? "—"} />
        <StatCard label={t("marks.released")} value={`${s?.released ?? 0}`} sub={`${s?.draft ?? 0} ${t("marks.draft").toLowerCase()}`} tone="up" />
      </div>


      <FleetStrip />
      <div className="grid gap-5 lg:grid-cols-2">
        <AnnouncementsPanel />
        <EventsPanel />
      </div>
    </div>
  );
}
