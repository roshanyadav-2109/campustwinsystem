// The certificate engine shared by every edition: an issued certificate is a
// frozen piece of content (what each edition's template produced), printed with
// its number, a QR code anyone can check, and signature lines. Editions decide
// what the content says (src/editions/<edition>/certificates.ts).
import type { PdfBlock, PdfDoc } from "@/lib/pdf";

export type CertificateKind = "transfer" | "bonafide" | "character";

export type CertificateContent = {
  title: string;                       // "Transfer Certificate"
  header: [string, string][];          // affiliation no., school code ...
  rows: [string, string][];            // numbered fields (TC) or facts
  paragraphs: string[];                // body text (bonafide, character)
  signatures: string[];                // "Class teacher", "Checked by", "Principal"
  footnote?: string;                   // e.g. "No alteration shall be made ..."
};

export const KIND_LABEL: Record<CertificateKind, string> = {
  transfer: "Transfer certificate", bonafide: "Bonafide certificate", character: "Character certificate",
};

const BASE = process.env.NEXT_PUBLIC_BASE_DOMAIN || "campustwin.org";
// The apex is the marketing site; certificate checks live on the app.
export const verifyUrl = (token: string) => `https://verify.${BASE}/verify/${token}`;

/** The printable document of an issued certificate. */
export function certificatePdf(c: { number: string; issuedOn: string; token: string; duplicate: boolean; cancelled: boolean; content: CertificateContent; schoolName: string }): PdfDoc {
  const blocks: PdfBlock[] = [];
  if (c.cancelled) blocks.push({ kind: "banner", text: "CANCELLED" });
  else if (c.duplicate) blocks.push({ kind: "banner", text: "DUPLICATE" });
  if (c.content.header.length) blocks.push({ kind: "facts", items: c.content.header });
  if (c.content.rows.length) blocks.push({ kind: "table", headers: ["", ""], rows: c.content.rows.map(([k, v]) => [k, v || "-"]), widths: { 0: 98 }, compact: true });
  if (c.content.paragraphs.length) blocks.push({ kind: "text", lines: c.content.paragraphs });
  if (c.content.footnote) blocks.push({ kind: "text", lines: [c.content.footnote] });
  blocks.push({ kind: "signatures", labels: c.content.signatures });
  blocks.push({ kind: "qr", data: verifyUrl(c.token), lines: [
    `Certificate no. ${c.number}`,
    "Scan this code with a phone camera to check",
    `that the certificate is genuine (verify.${BASE}).`,
  ] });
  return {
    filename: `${c.content.title} ${c.number.replace(/\//g, "-")}`,
    title: c.content.title,
    meta: [`No. ${c.number}${c.duplicate ? " (duplicate)" : ""}`, `Date of issue: ${c.issuedOn.split("-").reverse().join("/")}`],
    school: c.schoolName,
    blocks,
  };
}
