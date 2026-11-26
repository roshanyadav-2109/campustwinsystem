// Reading the "more details" sheet: admission no plus any profile or identity
// columns. Only filled cells are used; an empty cell never clears a value.
// Shared by the browser (preview) and the server (save).

export type DetailsRow = {
  line: number;
  admissionNo: string;
  profile: Record<string, string>;
  identity: Record<string, string | boolean>;
  errors: string[];
};

type Target = { table: "profile" | "identity"; key: string; aliases: string[]; check?: (v: string) => string | null; map?: (v: string) => string | boolean };

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const BLOOD = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];
const CATEGORY: Record<string, string> = { general: "general", gen: "general", sc: "sc", st: "st", obc: "obc", ews: "ews" };
const YES = ["yes", "y", "true", "1"];

// Dates as DD/MM/YYYY (what Excel shows in India) or YYYY-MM-DD.
function isoDate(v: string): string | null {
  const t = v.trim();
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}
const digits = (v: string) => v.replace(/\D/g, "");

const TARGETS: Target[] = [
  { table: "profile", key: "admission_date", aliases: ["dateofadmission", "admissiondate", "admittedon"], check: (v) => (isoDate(v) ? null : "date of admission is not a date"), map: (v) => isoDate(v)! },
  { table: "profile", key: "admitted_class", aliases: ["classatadmission", "admittedclass", "admittedinclass"] },
  { table: "profile", key: "previous_school", aliases: ["previousschool", "lastschool", "lastschoolattended"] },
  { table: "profile", key: "mother_tongue", aliases: ["mothertongue"] },
  { table: "profile", key: "nationality", aliases: ["nationality"] },
  { table: "profile", key: "place_of_birth", aliases: ["placeofbirth", "birthplace"] },
  { table: "profile", key: "blood_group", aliases: ["bloodgroup", "blood"], check: (v) => (BLOOD.includes(v.toUpperCase().replace(/\s/g, "")) ? null : "blood group is not one of A+, A-, B+, B-, AB+, AB-, O+, O-"), map: (v) => v.toUpperCase().replace(/\s/g, "") },
  { table: "profile", key: "house", aliases: ["house"] },
  { table: "profile", key: "address_line", aliases: ["address", "addressline", "residentialaddress"] },
  { table: "profile", key: "city", aliases: ["city", "town", "cityortown"] },
  { table: "profile", key: "state", aliases: ["state"] },
  { table: "profile", key: "pincode", aliases: ["pincode", "pin", "postalcode"], check: (v) => (/^[1-9][0-9]{5}$/.test(digits(v)) ? null : "PIN code needs 6 digits"), map: digits },
  { table: "profile", key: "allergies", aliases: ["allergies", "allergy"] },
  { table: "profile", key: "medical_notes", aliases: ["medicalnotes", "medical", "medicalconditions", "healthnotes"] },
  { table: "profile", key: "emergency_name", aliases: ["emergencycontact", "emergencyname"] },
  { table: "profile", key: "emergency_phone", aliases: ["emergencyphone", "emergencynumber"], check: (v) => (/^[0-9+ -]{7,20}$/.test(v.trim()) ? null : "emergency phone is not a phone number") },
  { table: "identity", key: "apaar_id", aliases: ["apaar", "apaarid", "apaarno"], check: (v) => (digits(v).length === 12 ? null : "APAAR ID needs 12 digits"), map: digits },
  { table: "identity", key: "pen", aliases: ["pen", "udisepen", "permanenteducationno", "permanenteducationnumber"], check: (v) => (digits(v).length === 11 ? null : "PEN needs 11 digits"), map: digits },
  // Only the last four digits of Aadhaar are ever kept.
  { table: "identity", key: "aadhaar_last4", aliases: ["aadhaar", "aadhar", "aadhaarno", "aadharno", "aadhaarlast4"], check: (v) => ([4, 12].includes(digits(v).length) ? null : "Aadhaar needs 12 digits or the last 4"), map: (v) => digits(v).slice(-4) },
  { table: "identity", key: "category", aliases: ["category", "socialcategory", "caste category"].map(squash), check: (v) => (CATEGORY[squash(v)] ? null : "category is not General, SC, ST, OBC or EWS"), map: (v) => CATEGORY[squash(v)] },
  { table: "identity", key: "religion", aliases: ["religion"] },
  { table: "identity", key: "bpl", aliases: ["bpl", "belowpovertyline"], map: (v) => YES.includes(v.trim().toLowerCase()) },
  { table: "identity", key: "special_needs", aliases: ["specialneeds", "cwsn", "disability"], map: (v) => YES.includes(v.trim().toLowerCase()) },
];
const ADMISSION_ALIASES = ["admissionno", "admissionnumber", "admno", "admission", "srno", "scholarno"];

export const DETAILS_TEMPLATE = [
  "Admission no", "Date of admission", "Class at admission", "Previous school", "Mother tongue", "Nationality", "Place of birth",
  "Blood group", "House", "Address", "City", "State", "PIN code", "Allergies", "Medical notes", "Emergency contact", "Emergency phone",
  "APAAR ID", "PEN", "Aadhaar", "Category", "Religion", "BPL", "Special needs",
];

export function readDetails(table: string[][]): { rows: DetailsRow[]; problem?: string; columns: string[] } {
  const nonEmpty = table.filter((r) => r.some((c) => c.trim()));
  if (nonEmpty.length < 2) return { rows: [], columns: [], problem: "The file has no rows under the headings." };
  const header = nonEmpty[0].map(squash);
  const admCol = header.findIndex((h) => ADMISSION_ALIASES.includes(h));
  if (admCol < 0) return { rows: [], columns: [], problem: 'The file needs an "Admission no" column.' };
  const cols = TARGETS.map((t) => ({ t, i: header.findIndex((h) => t.aliases.includes(h)) })).filter((c) => c.i >= 0);
  if (!cols.length) return { rows: [], columns: [], problem: "None of the columns is one we know. Download the template to see the column names." };
  const rows = nonEmpty.slice(1).map((r, n) => {
    const row: DetailsRow = { line: n + 2, admissionNo: (r[admCol] ?? "").trim(), profile: {}, identity: {}, errors: [] };
    if (!row.admissionNo) row.errors.push("admission no is empty");
    for (const { t, i } of cols) {
      const raw = (r[i] ?? "").trim();
      if (!raw) continue;
      const err = t.check?.(raw);
      if (err) { row.errors.push(err); continue; }
      const val = t.map ? t.map(raw) : raw.replace(/\s+/g, " ").slice(0, 300);
      if (t.table === "profile") row.profile[t.key] = val as string; else row.identity[t.key] = val;
    }
    return row;
  });
  return { rows, columns: cols.map((c) => c.t.key) };
}
