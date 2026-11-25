// Money in Indian style, dates shown Indian style, India time throughout.
const IST = "Asia/Kolkata";

export function todayIST(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: IST, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export function inr(v: number | string | null | undefined): string {
  return Number(v ?? 0).toLocaleString("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function inrShort(v: number | string | null | undefined): string {
  const n = Number(v ?? 0);
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2).replace(/\.00$/, "")} crore`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(2).replace(/\.00$/, "")} lakh`;
  return `₹${n.toLocaleString("en-IN")}`;
}

export function fmtDate(day: string | null | undefined): string {
  if (!day) return "";
  return new Date(day.length === 10 ? day + "T00:00:00Z" : day).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: day.length === 10 ? "UTC" : IST });
}

export function fmtWhen(ts: string): string {
  return new Date(ts).toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true, timeZone: IST });
}

// Indian financial year (April to March) containing a date.
export function fyOf(day: string): { label: string; start: string; end: string } {
  const y = Number(day.slice(0, 4)), m = Number(day.slice(5, 7));
  const s = m >= 4 ? y : y - 1;
  return { label: `${s}-${String((s + 1) % 100).padStart(2, "0")}`, start: `${s}-04-01`, end: `${s + 1}-03-31` };
}

// Amount in words, Indian system, for receipts: "Five thousand rupees only".
export function rupeesInWords(amount: number): string {
  const ones = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
  const tens = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
  const two = (n: number) => (n < 20 ? ones[n] : `${tens[Math.floor(n / 10)]}${n % 10 ? "-" + ones[n % 10] : ""}`);
  const three = (n: number) => (n >= 100 ? `${ones[Math.floor(n / 100)]} hundred${n % 100 ? " " + two(n % 100) : ""}` : two(n));
  const words = (n: number): string => {
    if (n === 0) return "zero";
    const parts: string[] = [];
    const crore = Math.floor(n / 1e7); n %= 1e7;
    const lakh = Math.floor(n / 1e5); n %= 1e5;
    const thousand = Math.floor(n / 1e3); n %= 1e3;
    if (crore) parts.push(`${words(crore)} crore`);
    if (lakh) parts.push(`${two(lakh)} lakh`);
    if (thousand) parts.push(`${two(thousand)} thousand`);
    if (n) parts.push(three(n));
    return parts.join(" ");
  };
  const rupees = Math.floor(amount), paise = Math.round((amount - rupees) * 100);
  const text = `${words(rupees)} rupees${paise ? ` and ${two(paise)} paise` : ""} only`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export const MODE_LABEL: Record<string, string> = {
  cash: "Cash", cheque: "Cheque", bank_transfer: "Bank transfer", upi: "UPI", card: "Card", other: "Other",
};
export const CITIZEN_LABEL: Record<string, string> = { indian: "Indian resident", nri: "NRI (Indian citizen)", foreign: "Foreign citizen" };
export const FUND_LABEL: Record<string, string> = { corpus: "Corpus", specific: "Specific purpose", general: "General" };

// Database errors arrive as text; show the readable part, never internals.
export function friendly(message: string | undefined | null): string {
  if (!message) return "Something went wrong. Please try again.";
  if (/member_org_email/.test(message)) return "An alumnus with this email is already listed.";
  if (/row-level security|permission denied/.test(message)) return "You do not have permission to do this.";
  if (/linkedin_url/.test(message)) return "The LinkedIn link should start with https://www.linkedin.com/";
  if (/apply_url/.test(message)) return "The application link should start with https:// or mailto:";
  if (/online_url/.test(message)) return "The online link should start with https://";
  if (/donor_pan|_pan_check|pan_check/.test(message)) return "A PAN has 10 characters, like ABCDE1234F.";
  if (/violates check constraint/.test(message)) return "Some details are not valid. Please check and try again.";
  return message.length < 200 ? message : "Something went wrong. Please try again.";
}
