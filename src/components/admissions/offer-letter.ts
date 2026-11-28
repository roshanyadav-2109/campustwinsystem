// The admission offer letter, as a PDF document.
import type { PdfDoc } from "@/lib/pdf";

const dmy = (iso: string | null) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "-");

export function offerLetterPdf(d: { enquiry: { child_name: string; guardian_name: string; date_of_birth: string | null; offer_no: string; offered_at: string; offer_expires_on: string;
  app_fee_amount: number | null; app_fee_paid_on: string | null; class: { name: string } | null; academic_year: { name: string } | null };
  school: { name: string; address: string | null; phone: string | null; email: string | null; signatory_name: string | null; signatory_title: string | null } | null }, statusUrl: string): PdfDoc {
  const e = d.enquiry;
  return {
    filename: `Offer letter ${e.child_name} ${e.offer_no}`, title: "Offer of admission",
    meta: [`Offer ${e.offer_no}`, `Date ${dmy(e.offered_at)}`, [d.school?.address, d.school?.phone, d.school?.email].filter(Boolean).join(" | ")],
    school: d.school?.name,
    blocks: [
      { kind: "text", lines: [`Dear ${e.guardian_name},`, "",
        `We are pleased to offer ${e.child_name} a seat in ${e.class?.name ?? "the class applied for"} for the year ${e.academic_year?.name ?? ""}.`,
        `This offer is open until ${dmy(e.offer_expires_on)}. Please accept it on the application page, or at the school office, by that date; after it the seat goes to the next child on the waiting list.`] },
      { kind: "facts", heading: "Details", items: [["Child", e.child_name], ["Date of birth", dmy(e.date_of_birth)], ["Class", e.class?.name ?? "-"], ["Year", e.academic_year?.name ?? "-"],
        ["Offer open until", dmy(e.offer_expires_on)], ["Application fee", e.app_fee_amount ? `Rs ${Number(e.app_fee_amount).toLocaleString("en-IN")}${e.app_fee_paid_on ? `, paid on ${dmy(e.app_fee_paid_on)}` : ", not yet paid"}` : "None"]] },
      { kind: "text", heading: "Please bring", lines: ["Birth certificate", "Transfer certificate from the previous school (if any)", "Last report card", "Aadhaar of the child and a parent", "Four passport-size photographs"] },
      { kind: "signatures", labels: [[d.school?.signatory_name, d.school?.signatory_title ?? "Principal"].filter(Boolean).join(", ")] },
      { kind: "qr", data: statusUrl, lines: ["Scan to see and accept this offer.", statusUrl.replace(/^https:\/\//, "")] },
    ],
  };
}
