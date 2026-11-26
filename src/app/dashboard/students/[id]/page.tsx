import Link from "next/link";
import { notFound } from "next/navigation";
import { getSession, getCurrentYear } from "@/lib/session";
import { guardTab } from "@/lib/access";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EMPTY_IDENTITY, EMPTY_PROFILE, getStudentRecord } from "@/lib/data/student-record";
import { EditIdentityButton, EditProfileButton } from "@/components/students/student-profile-edit";
import { fmtDay } from "@/components/fees/shared";
import { CertificatesPanel, type CertRow } from "@/components/students/certificates-panel";
import { IdCardForStudent } from "@/components/students/id-cards";
import { untyped } from "@/lib/data/schedule";

// One student, everything in one place: admission, address, family,
// medical and, for the office and principal, identity and category.
const CATEGORY: Record<string, string> = { general: "General", sc: "SC", st: "ST", obc: "OBC", ews: "EWS" };

function Facts({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt className="text-[12px] text-ink-500">{k}</dt>
          <dd className="text-[14px] text-ink-900">{v === null || v === undefined || v === "" ? <span className="text-ink-500">Not recorded</span> : v}</dd>
        </div>
      ))}
    </dl>
  );
}

export default async function StudentPage({ params }: { params: Promise<{ id: string }> }) {
  const denied = await guardTab("/dashboard/students");
  if (denied) return denied;
  const { id } = await params;
  const studentId = Number(id);
  if (!Number.isInteger(studentId) || studentId <= 0) notFound();
  const [session, year] = await Promise.all([getSession(), getCurrentYear()]);
  const admin = !!session?.isAdminScope;
  const s = await getStudentRecord(studentId, year?.id ?? null, admin);
  if (!s) notFound();
  const p = s.profile ?? EMPTY_PROFILE;
  const canEdit = admin || !!session?.isClassTeacher;
  const address = [p.address_line, p.city, p.state, p.pincode].filter(Boolean).join(", ");
  let certs: CertRow[] = [];
  let hasCard = false;
  if (admin) {
    const db = await untyped();
    if (year) {
      const { count } = await db.from("id_card").select("id", { count: "exact", head: true }).eq("student_id", s.id).eq("academic_year_id", year.id).eq("status", "active");
      hasCard = (count ?? 0) > 0;
    }
    const { data } = await db.from("certificate")
      .select("id, kind, number, issued_on, source, status, file_key, cancel_reason")
      .eq("student_id", s.id).order("issued_on", { ascending: false });
    certs = ((data ?? []) as { id: number; kind: CertRow["kind"]; number: string | null; issued_on: string; source: CertRow["source"]; status: CertRow["status"]; file_key: string | null; cancel_reason: string | null }[])
      .map((c) => ({ id: c.id, kind: c.kind, number: c.number, issuedOn: c.issued_on, source: c.source, status: c.status, hasFile: !!c.file_key, cancelReason: c.cancel_reason }));
  }

  return (
    <div>
      <PageHeader
        title={s.fullName}
        description={[s.classLabel && `Class ${s.classLabel}`, s.rollNo && `Roll ${s.rollNo}`, `Admission no. ${s.admissionNo}`].filter(Boolean).join(" · ")}
        actions={canEdit ? <EditProfileButton studentId={s.id} profile={p} /> : undefined}
      />
      {s.status !== "active" && (
        <p className="mb-4 rounded-sm border border-hair bg-panel px-3 py-2 text-[14px] text-ink-900">
          Left the school{s.leftOn ? ` on ${fmtDay(s.leftOn)}` : ""}{s.exitRemark ? `: ${s.exitRemark}` : ""}.
        </p>
      )}
      <div className="grid items-start gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader title="Admission and personal" />
          <CardBody className="pt-1">
            <Facts rows={[
              ["Date of birth", s.dob ? fmtDay(s.dob) : null], ["Gender", s.gender ? s.gender[0].toUpperCase() + s.gender.slice(1) : null],
              ["Date of admission", p.admission_date ? fmtDay(p.admission_date) : null], ["Class at admission", p.admitted_class],
              ["Previous school", p.previous_school], ["Place of birth", p.place_of_birth],
              ["Nationality", p.nationality], ["Mother tongue", p.mother_tongue],
              ["Blood group", p.blood_group], ["House", p.house],
            ]} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Family" />
          <CardBody className="space-y-4 pt-1">
            {s.guardians.length === 0 ? <p className="text-[14px] text-ink-500">No parent or guardian linked yet.</p> : (
              <ul className="space-y-2">{s.guardians.map((g, i) => (
                <li key={i} className="text-[14px] text-ink-900"><span className="font-medium">{g.name}</span>{g.relation ? ` (${g.relation})` : ""}
                  <span className="block text-[13px] text-ink-500">{[g.phone, g.email].filter(Boolean).join(" · ") || "No contact recorded"}</span></li>
              ))}</ul>
            )}
            {s.siblings.length > 0 && (
              <div>
                <div className="mb-1 text-[12px] text-ink-500">Brothers and sisters in the school</div>
                <ul className="flex flex-wrap gap-2">{s.siblings.map((b) => (
                  <li key={b.id}><Link href={`/dashboard/students/${b.id}`} className="rounded-sm border border-hair px-2 py-1 text-[13px] text-[#0F6CBD] hover:bg-panel">{b.name}{b.classLabel ? `, ${b.classLabel}` : ""}</Link></li>
                ))}</ul>
              </div>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Address and contact" />
          <CardBody className="pt-1">
            <Facts rows={[["Address", address || null], ["Student phone", s.phone], ["Student email", s.email]]} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Medical and emergency" />
          <CardBody className="pt-1">
            <Facts rows={[["Allergies", p.allergies], ["Medical notes", p.medical_notes], ["Emergency contact", p.emergency_name], ["Emergency phone", p.emergency_phone]]} />
          </CardBody>
        </Card>
        {admin && (
          <div className="xl:col-span-2">
            <div className="grid items-start gap-5 lg:grid-cols-[1fr_340px]">
              <CertificatesPanel studentId={s.id} rows={certs} canUpload={session?.staffRole === "office"} />
              {session?.staffRole === "office" && s.status === "active" && <IdCardForStudent studentId={s.id} name={s.fullName} hasCard={hasCard} />}
            </div>
          </div>
        )}
        {admin && (() => {
          const idn = s.identity ?? EMPTY_IDENTITY;
          return (
            <Card>
              <CardHeader title="Identity and category" action={<EditIdentityButton studentId={s.id} identity={idn} />} />
              <CardBody className="pt-1">
                <Facts rows={[
                  ["APAAR ID", idn.apaar_id], ["PEN (UDISE+)", idn.pen],
                  ["Aadhaar", idn.aadhaar_last4 ? `•••• •••• ${idn.aadhaar_last4}` : null], ["Category", idn.category ? CATEGORY[idn.category] : null],
                  ["Religion", idn.religion], ["Below poverty line", idn.bpl ? "Yes" : "No"],
                  ["Special needs", idn.special_needs ? (idn.special_needs_note || "Yes") : "No"],
                ]} />
                <p className="mt-3 text-[12px] text-ink-500">Seen only by the office and the principal.</p>
              </CardBody>
            </Card>
          );
        })()}
      </div>
    </div>
  );
}
