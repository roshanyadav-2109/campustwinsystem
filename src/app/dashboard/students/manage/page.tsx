import { createClient } from "@/lib/supabase/server";
import { IdCardsForSection } from "@/components/students/id-cards";
import { CertificateBulkUpload } from "@/components/manage/students/certificate-bulk-upload";
import { CertificateRegisterUpload } from "@/components/manage/students/certificate-register-upload";
import { DetailsUpload } from "@/components/manage/students/details-upload";
import { UdiseExport } from "@/components/manage/students/udise-export";
import { PhotoBulkUpload } from "@/components/students/student-photo";
import { IncomingTransfers } from "@/components/students/incoming-transfers";
import { guardTab } from "@/lib/access";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty";
import { getCurrentYear, getSession } from "@/lib/session";
import { getStaffScope } from "@/lib/data/scope";
import { numParam, strParam } from "@/lib/utils";
import { StudentAdmin } from "@/components/manage/students/student-admin";
import { listStudents } from "./data";
import type { SectionRef } from "./rules";

type SP = Promise<Record<string, string | string[] | undefined>>;

// Manage School → Students (office only; the layout checks). This year's
// students, with search, class filter and paging in the address bar.
async function ManageStudentsPageBody({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const [year, scope, session] = await Promise.all([getCurrentYear(), getStaffScope(), getSession()]);
  if (!year) {
    return <EmptyState art="nothing-yet" title="No school year is set up yet" hint="Once the current school year is added, students can be managed here." />;
  }

  const sections: SectionRef[] = scope.sections.map((s) => ({
    id: s.id, label: `${s.class_name}-${s.name}`, className: s.class_name, sectionName: s.name, classLevel: s.class_level,
  }));
  const sectionId = numParam(sp.section);
  const page = Math.max(0, Math.floor(numParam(sp.page) ?? 0));
  const list = await listStudents({
    yearId: year.id,
    sectionId: sectionId && sections.some((s) => s.id === sectionId) ? sectionId : null,
    q: (strParam(sp.q) ?? "").trim(),
    left: strParam(sp.show) === "left",
    page,
  });

  return (
    <div className="space-y-5">
      <StudentAdmin
        rows={list.rows}
        total={list.total}
        page={list.page}
        pageSize={list.pageSize}
        sections={sections}
        yearName={year.name}
      />
      <div className="grid items-start gap-5 xl:grid-cols-2">
        <DetailsUpload />
        <IdCardsForSection sections={sections.map((x) => ({ id: x.id, label: x.label }))} />
        <CertificateBulkUpload />
        <CertificateRegisterUpload />
        <UdiseExport sections={sections.map((x) => ({ id: x.id, label: x.label }))} />
        <PhotoBulkUpload />
        {session?.school.higherEd && session.isAdminScope && <IncomingTransfers fee={((await (await createClient()).from("school").select("transfer_fee" as "id").eq("id", session.schoolId).maybeSingle()).data as unknown as { transfer_fee: number | null } | null)?.transfer_fee ?? null} />}
      </div>
    </div>
  );
}

// Guarded on its own address, so a shared link cannot open it for the wrong role.
export default async function ManageStudentsPage(props: Parameters<typeof ManageStudentsPageBody>[0]) {
  const denied = await guardTab("/dashboard/students/manage");
  if (denied) return denied;
  return (
    <div>
      <PageHeader title="Student records" description="Add, correct or upload student records." />
      {await ManageStudentsPageBody(props)}
    </div>
  );
}
