import { getSession, getCurrentYear } from "@/lib/session";
import { guardTab } from "@/lib/access";
import { EmptyState } from "@/components/ui/empty";
import { numParam, strParam } from "@/lib/utils";
import {
  filterEnquiries, followUpsDue, getAdmissionStaff, getClassList, getEnquiries, getFollowups, sourceReport, statusCounts,
} from "@/lib/data/admissions";
import { isSource, isStatus } from "@/components/admissions/shared";
import { AdmissionsBoard } from "@/components/admissions/admissions-board";

type SP = Promise<Record<string, string | string[] | undefined>>;

// Admissions and enquiries (office and principal). The office enters and
// updates enquiries; the principal reads. Filters live in the address bar.
export default async function AdmissionsPage({ searchParams }: { searchParams: SP }) {
  const denied = await guardTab("/dashboard/admissions");
  if (denied) return denied;
  const session = (await getSession())!;
  // The menu decides who sees the tab; the data is for principal and office only.
  if (!session.isAdminScope) {
    return <EmptyState art="no-access" title="You don't have access to this page" hint="Admissions are handled by the school office." />;
  }

  const sp = await searchParams;
  const year = await getCurrentYear();
  if (!year) {
    return <EmptyState art="nothing-yet" title="No school year is set up yet" hint="Once the current school year is added, enquiries can be recorded here." />;
  }

  const [classes, staff] = await Promise.all([getClassList(), getAdmissionStaff()]);
  const loaded = await getEnquiries(year.id, classes, staff);
  if (loaded.missing) {
    return <EmptyState art="coming-soon" title="Admissions are not set up yet" hint="This page will work once the admissions tables have been added to the database." />;
  }
  const all = loaded.rows;

  const statusParam = strParam(sp.status);
  const sourceParam = strParam(sp.source);
  const classParam = numParam(sp.class);
  const filter = {
    status: isStatus(statusParam) ? statusParam : null,
    source: isSource(sourceParam) ? sourceParam : null,
    classId: classParam && classes.some((c) => c.id === classParam) ? classParam : null,
    q: (strParam(sp.q) ?? "").slice(0, 80),
  };
  const rows = filterEnquiries(all, filter);

  const openId = numParam(sp.id);
  const openEnquiry = openId ? all.find((r) => r.id === openId) ?? null : null;
  const followups = openEnquiry ? await getFollowups(openEnquiry.id) : [];

  return (
    <AdmissionsBoard
      rows={rows}
      total={all.length}
      counts={statusCounts(all)}
      due={followUpsDue(all)}
      report={sourceReport(all)}
      classes={classes}
      staff={staff}
      yearName={year.name}
      canEdit={session.staffRole === "office"}
      detail={openEnquiry ? { enquiry: openEnquiry, followups } : null}
    />
  );
}
