// School certificates: what a school's transfer, bonafide and character
// certificates say. The transfer certificate follows the board format the
// school chose: CBSE (Examination Bye-Laws, Annexure I, 23 items) or a state
// board school leaving certificate (General Register number, PEN, mother
// tongue, religion and caste, place of birth, academic progress).
import type { CertificateContent } from "@/core/certificates";
import type { CertificateFacts } from "@/lib/data/certificate-facts";

export type TcInputs = {
  lastExam: string; failed: string; promotion: string; ncc: string; games: string;
  conduct: string; applicationDate: string; reason: string; remarks: string; progress: string;
};
export type LetterInputs = { purpose: string; conduct: string; remarks: string };

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const ORD = ["", "First", "Second", "Third", "Fourth", "Fifth", "Sixth", "Seventh", "Eighth", "Ninth", "Tenth", "Eleventh", "Twelfth"];

function words(n: number): string {
  if (n < 20) return ONES[n];
  if (n < 100) return `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ""}`;
  if (n < 1000) return `${ONES[Math.floor(n / 100)]} Hundred${n % 100 ? ` ${words(n % 100)}` : ""}`;
  return `${words(Math.floor(n / 1000))} Thousand${n % 1000 ? ` ${words(n % 1000)}` : ""}`;
}
const ordinalDay = (d: number) => (d <= 12 ? ORD[d] : d === 20 ? "Twentieth" : d === 30 ? "Thirtieth" : `${words(d).replace(/One$/, "First").replace(/Two$/, "Second").replace(/Three$/, "Third").replace(/Four$/, "Fourth").replace(/Five$/, "Fifth").replace(/Six$/, "Sixth").replace(/Seven$/, "Seventh").replace(/Eight$/, "Eighth").replace(/Nine$/, "Ninth").replace(/een$/, "eenth")}`);
export const dateFig = (iso: string | null) => (iso ? iso.split("-").reverse().join("/") : "");
export const dateWords = (iso: string | null) => {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return `${ordinalDay(d)} ${MONTHS[m - 1]} ${words(y)}`;
};
const classWords = (level: number | null) => (level && level >= 1 && level <= 12 ? ORD[level] : "");
const CATEGORY: Record<string, string> = { general: "No", sc: "Scheduled Caste", st: "Scheduled Tribe", obc: "OBC", ews: "No (EWS)" };
const monthYear = (ym: string | null) => (ym ? `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}` : "");

function header(f: CertificateFacts, withUdise: boolean): [string, string][] {
  const h: [string, string][] = [];
  if (f.school.address) h.push(["School", [f.school.name, f.school.address].join(", ")]);
  if (f.school.affiliationNo) h.push(["Affiliation no.", f.school.affiliationNo]);
  if (f.school.schoolCode) h.push(["School code", f.school.schoolCode]);
  if (withUdise && f.school.udise) h.push(["UDISE+ code", f.school.udise]);
  h.push(["Admission no.", f.student.admissionNo]);
  return h;
}
const signer = (f: CertificateFacts) => `${f.school.signatoryTitle || "Principal"}${f.school.signatoryName ? ` (${f.school.signatoryName})` : ""}`;

/** Problems that stop a transfer certificate, and warnings to confirm. */
export function tcChecks(f: CertificateFacts): { blockers: string[]; warnings: string[] } {
  const blockers: string[] = [], warnings: string[] = [];
  if (f.student.status === "active") blockers.push("Mark the student as left in Student records first. A transfer certificate is issued when a student leaves.");
  if (f.duesPending > 0) warnings.push(`Fees of Rs. ${f.duesPending.toLocaleString("en-IN")} are still pending. The board expects dues to be cleared before a TC is issued.`);
  if (!f.mother && !f.father) warnings.push("No parent is recorded for this student.");
  if (!f.student.dob) warnings.push("The date of birth is not recorded.");
  if (!f.school.affiliationNo && f.school.tcFormat === "cbse") warnings.push("The school's affiliation number is not set (Settings, Institution profile).");
  return { blockers, warnings };
}

export function transferCertificate(f: CertificateFacts, x: TcInputs, issuedOn: string): CertificateContent {
  const lc = f.lastClass;
  if (f.school.tcFormat === "state") {
    return {
      title: "School Leaving Certificate",
      header: [...header(f, true), ["General Register no.", f.student.admissionNo], ...(f.identity.pen ? [["PEN", f.identity.pen] as [string, string]] : [])],
      rows: [
        ["Name of the pupil", f.student.name],
        ["Mother's name", f.mother ?? ""],
        ["Father's / guardian's name", f.father ?? ""],
        ["Nationality", f.profile.nationality || "Indian"],
        ["Mother tongue", f.profile.motherTongue ?? ""],
        ["Religion and caste", [f.identity.religion, f.identity.category ? CATEGORY[f.identity.category] : null].filter(Boolean).join(", ")],
        ["Place of birth", f.profile.placeOfBirth ?? ""],
        ["Date of birth (figures)", dateFig(f.student.dob)],
        ["Date of birth (words)", dateWords(f.student.dob)],
        ["School last attended", f.profile.previousSchool ?? ""],
        ["Date of admission", dateFig(f.profile.admissionDate)],
        ["Class at admission", f.profile.admittedClass ?? ""],
        ["Academic progress", x.progress],
        ["Conduct", x.conduct],
        ["Date of leaving", dateFig(f.student.leftOn)],
        ["Class at the time of leaving", lc?.name ?? ""],
        ["Reason for leaving", x.reason],
        ["Remarks", x.remarks],
      ],
      paragraphs: [],
      signatures: ["Class teacher", "Clerk", signer(f)],
      footnote: "No alteration or correction shall be made by anyone in this certificate.",
    };
  }
  return {
    title: "Transfer Certificate",
    header: header(f, false),
    rows: [
      ["1. Name of pupil", f.student.name],
      ["2. Mother's name", f.mother ?? ""],
      ["3. Father's / guardian's name", f.father ?? ""],
      ["4. Date of birth according to the Admission and Withdrawal Register (in figures)", dateFig(f.student.dob)],
      ["    (in words)", dateWords(f.student.dob)],
      ["5. Nationality", f.profile.nationality || "Indian"],
      ["6. Whether the candidate belongs to Scheduled Caste, Scheduled Tribe or OBC", f.identity.category ? CATEGORY[f.identity.category] : ""],
      ["7. Date of first admission in the school with class", [dateFig(f.profile.admissionDate), f.profile.admittedClass].filter(Boolean).join(", class ")],
      ["8. Class in which the pupil last studied (in figures)", lc?.name ?? ""],
      ["    (in words)", classWords(lc?.level ?? null)],
      ["9. School / Board annual examination last taken with result", x.lastExam],
      ["10. Whether failed, if so once / twice in the same class", x.failed],
      ["11. Subjects studied", f.subjects.join(", ")],
      ["12. Whether qualified for promotion to the higher class; if so, to which class", x.promotion],
      ["13. Month up to which the pupil has paid school dues", monthYear(f.feesPaidUpTo)],
      ["14. Any fee concession availed of; if so, the nature of such concession", f.concessions.length ? f.concessions.join(", ") : "No"],
      ["15. Total number of working days in the academic session", f.workingDays ? String(f.workingDays) : ""],
      ["16. Total number of working days the pupil was present", f.workingDays ? String(f.daysPresent) : ""],
      ["17. Whether NCC cadet / Boy Scout / Girl Guide (details)", x.ncc],
      ["18. Games played or extra-curricular activities (achievement level)", x.games],
      ["19. General conduct", x.conduct],
      ["20. Date of application for certificate", dateFig(x.applicationDate)],
      ["21. Date of issue of certificate", dateFig(issuedOn)],
      ["22. Reasons for leaving the school", x.reason],
      ["23. Any other remarks", x.remarks],
    ],
    paragraphs: [],
    signatures: ["Class teacher", "Checked by (name and designation)", signer(f)],
  };
}

export function bonafideCertificate(f: CertificateFacts, x: LetterInputs): CertificateContent {
  const lc = f.lastClass;
  const ward = f.student.gender === "female" ? "daughter" : f.student.gender === "male" ? "son" : "child";
  const parents = [f.father, f.mother].filter(Boolean).join(" and ");
  return {
    title: "Bonafide Certificate",
    header: header(f, false),
    rows: [],
    paragraphs: [
      `This is to certify that ${f.student.name}${parents ? `, ${ward} of ${parents},` : ""} is a bonafide student of this school, studying in class ${lc?.name ?? ""}${lc?.section ? `-${lc.section}` : ""} in the academic year ${lc?.yearName ?? ""}.`,
      `${f.student.dob ? `Date of birth as per school records: ${dateFig(f.student.dob)} (${dateWords(f.student.dob)}).` : ""}`,
      x.purpose ? `This certificate is issued on request for ${x.purpose}.` : "This certificate is issued on request.",
      ...(x.remarks ? [x.remarks] : []),
    ].filter(Boolean),
    signatures: [signer(f)],
  };
}

export function characterCertificate(f: CertificateFacts, x: LetterInputs): CertificateContent {
  const lc = f.lastClass;
  const left = f.student.status !== "active";
  return {
    title: "Character Certificate",
    header: header(f, false),
    rows: [],
    paragraphs: [
      `This is to certify that ${f.student.name} ${left ? "was" : "is"} a student of this school${f.profile.admissionDate ? ` from ${dateFig(f.profile.admissionDate)}` : ""}${left && f.student.leftOn ? ` to ${dateFig(f.student.leftOn)}` : ""}${lc?.name ? `, ${left ? "last studying" : "studying"} in class ${lc.name}` : ""}.`,
      `To the best of our knowledge, ${f.student.gender === "female" ? "her" : f.student.gender === "male" ? "his" : "the student's"} conduct and character ${left ? "were" : "are"} ${x.conduct || "good"}.`,
      ...(x.purpose ? [`Issued on request for ${x.purpose}.`] : []),
      ...(x.remarks ? [x.remarks] : []),
    ],
    signatures: [signer(f)],
  };
}
