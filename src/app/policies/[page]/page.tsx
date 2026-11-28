import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getBrand } from "@/lib/brand-server";
import { createAdminClient } from "@/lib/supabase/admin";

// The institution's own policy pages (what payment gateways check before approving a merchant account).
// One common text for every institution, filled with this institution's own details; served on its own site.
export const dynamic = "force-dynamic";
type D = { name: string; legal_name: string; entity_type: string | null; address: string | null; phone: string | null; email: string | null; website: string | null; gstin: string | null;
  admission_refundable: boolean; refund_days: number; hostel_rule: string | null; transport_rule: string | null; extra_terms: string | null; grievance_name: string | null; higher_ed: boolean; updated_at: string };
const PAGES = { about: "About us", contact: "Contact us", privacy: "Privacy policy", terms: "Terms and conditions", refund: "Refund and cancellation policy" } as const;
type Page = keyof typeof PAGES;

async function details(): Promise<D | null> {
  const brand = await getBrand();
  if (!brand.schoolId) return null;
  const { data } = await createAdminClient().rpc("policy_details" as never, { p_school: brand.schoolId } as never);
  return ((data ?? []) as unknown as D[])[0] ?? null;
}

export async function generateMetadata({ params }: { params: Promise<{ page: string }> }): Promise<Metadata> {
  const { page } = await params;
  const d = await details();
  const title = PAGES[page as Page];
  return title && d ? { title: `${title} | ${d.name}` } : {};
}

const P = ({ children }: { children: React.ReactNode }) => <p className="mt-3 text-[14px] leading-relaxed text-ink-700">{children}</p>;
const H = ({ children }: { children: React.ReactNode }) => <h2 className="mt-6 text-[16px] font-semibold text-ink-900">{children}</h2>;

export default async function PolicyPage({ params }: { params: Promise<{ page: string }> }) {
  const { page } = await params;
  if (!(page in PAGES)) notFound();
  const d = await details();
  if (!d) notFound();
  const who = d.legal_name !== d.name ? `${d.name} (run by ${d.legal_name})` : d.name;
  const learners = d.higher_ed ? "students" : "students and their parents or guardians";
  const contact = [d.address, d.phone && `Phone ${d.phone}`, d.email && `Email ${d.email}`].filter(Boolean).join(" · ");
  const updated = new Date(d.updated_at).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
  const body: Record<Page, React.ReactNode> = {
    about: <>
      <P>{who} is an educational institution{d.address ? ` at ${d.address}` : ""}. This website is where {learners} sign in to see attendance, timetables, results and notices, apply for admission, and pay fees and other charges to the institution.</P>
      <P>Payments made here are received by {d.legal_name} directly into its own bank account through its payment gateway. The institution does not sell goods; payments are for tuition and other fees, applications, examinations, transport, hostel and similar services of the institution.</P>
      {d.gstin && <P>GSTIN: {d.gstin}</P>}
    </>,
    contact: <>
      <P>{who}</P>
      {d.address && <P>Address: {d.address}</P>}
      {d.phone && <P>Phone: {d.phone}</P>}
      {d.email && <P>Email: {d.email}</P>}
      {d.grievance_name && <P>Grievance officer for payments and privacy: {d.grievance_name}{d.email ? `, ${d.email}` : ""}</P>}
      <P>The office answers queries on working days. For a payment, please give the receipt number or the date and amount.</P>
    </>,
    privacy: <>
      <P>This policy explains how {d.legal_name} (&quot;the institution&quot;) handles personal information on this website.</P>
      <H>What we collect</H>
      <P>Details needed to run the institution: names, contact details, admission and academic records, attendance, fees and payments, and, where given, health and other information needed for the student&apos;s care. When you pay online, the payment gateway collects your card, UPI or bank details; the institution does not see or keep them and receives only the result of the payment.</P>
      <H>How we use it</H>
      <P>To provide education and related services, keep records required by law and by boards or universities, communicate with {learners}, and take and record payments. We do not sell personal information.</P>
      <H>Who sees it</H>
      <P>Authorised staff of the institution, according to their work; the payment gateway for payments; and authorities when the law requires. Our software provider stores the data securely on the institution&apos;s behalf and does not use it for anything else.</P>
      <H>Your choices</H>
      <P>You may ask to see or correct your information, or ask a question about it, by writing to {d.email ?? "the institution's office"}{d.grievance_name ? ` (grievance officer: ${d.grievance_name})` : ""}.</P>
      <H>Security</H>
      <P>Access is by personal sign-in only, connections are encrypted, and sensitive details are stored encrypted.</P>
    </>,
    terms: <>
      <P>These terms apply to the use of this website of {who}.</P>
      <H>Use of the website</H>
      <P>Sign-in is for {learners} and staff of the institution. Keep your sign-in to yourself; you are responsible for what is done with it. Do not try to reach information that is not yours.</P>
      <H>Fees and payments</H>
      <P>The amount of each fee is set by the institution and shown on the bill. Paying online is optional; you may also pay at the office. A payment is complete when the gateway confirms it, and the receipt is then available on this website. If money is taken but no receipt appears, do not pay again; contact the office with the transaction details. Gateway or bank charges, where any apply, are shown before you pay.</P>
      <H>Refunds</H>
      <P>Refunds follow the Refund and cancellation policy on this website.</P>
      {d.extra_terms && <><H>Also</H><P>{d.extra_terms}</P></>}
      <H>Changes and law</H>
      <P>The institution may update these terms; the date below shows the latest version. These terms are governed by the laws of India.</P>
    </>,
    refund: <>
      <P>This policy covers payments made to {d.legal_name} on this website.</P>
      <H>Admission and application fees</H>
      <P>{d.admission_refundable ? "Admission and application fees are refundable on request before the course or session begins." : "Admission, registration and application fees are not refundable once paid."}</P>
      <H>Tuition and other fees</H>
      <P>A request to cancel or withdraw is made in writing to the office. Any refund due under the institution&apos;s fee rules (and the rules of the board, university or government that apply) is calculated by the office and paid to the same account or card used for the payment.</P>
      {d.hostel_rule && <><H>Hostel</H><P>{d.hostel_rule}</P></>}
      {d.transport_rule && <><H>Transport</H><P>{d.transport_rule}</P></>}
      <H>Paid twice or paid too much</H>
      <P>If the same bill is paid twice, or more than the bill is received, the extra amount is refunded in full.</P>
      <H>Failed payments</H>
      <P>If money is taken from your account but the payment fails, the gateway returns it automatically, usually within 5 to 7 working days.</P>
      <H>How long a refund takes</H>
      <P>Approved refunds are started within {d.refund_days} days and reach the original payment method in the time the bank takes after that.</P>
      <P>Questions: {d.email ?? d.phone ?? "the institution's office"}{d.grievance_name ? ` (${d.grievance_name})` : ""}.</P>
    </>,
  };
  return (
    <main className="mx-auto max-w-3xl px-5 py-10">
      <p className="text-[13px] text-ink-500">{d.name}</p>
      <h1 className="mt-1 text-[26px] font-semibold text-ink-900">{PAGES[page as Page]}</h1>
      <nav className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
        {(Object.keys(PAGES) as Page[]).map((k) => <Link key={k} href={`/policies/${k}`} className={k === page ? "font-medium text-ink-900" : "text-[#0F6CBD] hover:underline"}>{PAGES[k]}</Link>)}
      </nav>
      <article className="mt-4">{body[page as Page]}</article>
      <footer className="mt-10 border-t border-hair pt-3 text-[12px] text-ink-500">{who}{contact ? ` · ${contact}` : ""} · Last updated {updated}</footer>
    </main>
  );
}
