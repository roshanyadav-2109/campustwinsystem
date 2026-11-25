// Money in Indian style (₹1,23,456.00), dates as plain YYYY-MM-DD shown Indian
// style, India time throughout.
const IST = "Asia/Kolkata";

export function todayIST(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: IST, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export function inr(v: number | string | null | undefined, opts: { blankZero?: boolean } = {}): string {
  const n = Number(v ?? 0);
  if (opts.blankZero && n === 0) return "";
  return n.toLocaleString("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Plain number with Indian grouping and two decimals, for tables of figures.
export function amt(v: number | string | null | undefined, blankZero = false): string {
  const n = Number(v ?? 0);
  if (blankZero && n === 0) return "";
  return n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fmtDate(day: string | null | undefined): string {
  if (!day) return "";
  return new Date(day + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

// Indian financial year (April to March) containing a date.
export function fyOf(day: string): { label: string; start: string; end: string } {
  const y = Number(day.slice(0, 4)), m = Number(day.slice(5, 7));
  const s = m >= 4 ? y : y - 1;
  return { label: `${s}-${String((s + 1) % 100).padStart(2, "0")}`, start: `${s}-04-01`, end: `${s + 1}-03-31` };
}

export const KIND_LABEL: Record<string, string> = {
  sales_invoice: "Invoice", purchase_bill: "Bill", receipt: "Receipt", payment: "Payment", journal: "Journal",
};
export const KIND_PATH: Record<string, string> = {
  sales_invoice: "/sales", purchase_bill: "/purchases", receipt: "/receipts", payment: "/payments", journal: "/journal",
};
export const ROOT_LABEL: Record<string, string> = {
  asset: "Assets", liability: "Liabilities", equity: "Equity", income: "Income", expense: "Expenses",
};
export const GST_RATES = [0, 5, 12, 18, 28] as const;

// Indian states and union territories by GST state code.
export const STATES: [string, string][] = [
  ["01", "Jammu and Kashmir"], ["02", "Himachal Pradesh"], ["03", "Punjab"], ["04", "Chandigarh"], ["05", "Uttarakhand"],
  ["06", "Haryana"], ["07", "Delhi"], ["08", "Rajasthan"], ["09", "Uttar Pradesh"], ["10", "Bihar"], ["11", "Sikkim"],
  ["12", "Arunachal Pradesh"], ["13", "Nagaland"], ["14", "Manipur"], ["15", "Mizoram"], ["16", "Tripura"], ["17", "Meghalaya"],
  ["18", "Assam"], ["19", "West Bengal"], ["20", "Jharkhand"], ["21", "Odisha"], ["22", "Chhattisgarh"], ["23", "Madhya Pradesh"],
  ["24", "Gujarat"], ["26", "Dadra and Nagar Haveli and Daman and Diu"], ["27", "Maharashtra"], ["29", "Karnataka"], ["30", "Goa"],
  ["31", "Lakshadweep"], ["32", "Kerala"], ["33", "Tamil Nadu"], ["34", "Puducherry"], ["35", "Andaman and Nicobar Islands"],
  ["36", "Telangana"], ["37", "Andhra Pradesh"], ["38", "Ladakh"],
];
export const stateName = (code: string | null | undefined) => STATES.find(([c]) => c === code)?.[1] ?? "";

// Database errors arrive as text; show the readable part, never internals.
export function friendly(message: string | undefined | null): string {
  if (!message) return "Something went wrong. Please try again.";
  if (/party_org_id_name_key/.test(message)) return "A customer or vendor with this name already exists.";
  if (/account_org_id_code_key/.test(message)) return "An account with this code already exists.";
  if (/voucher_item_voucher_id_line_no_key|journal_line_voucher_id_line_no_key/.test(message)) return "Two lines have the same number.";
  if (/allocation_voucher_id_against_id_key/.test(message)) return "The same invoice is matched twice.";
  if (/row-level security|permission denied/.test(message)) return "You do not have permission to do this.";
  if (/is still referenced|violates foreign key/.test(message)) return "This is in use and cannot be removed.";
  if (/violates check constraint/.test(message)) return "Some details are not valid. Please check and try again.";
  return message.length < 200 ? message : "Something went wrong. Please try again.";
}
