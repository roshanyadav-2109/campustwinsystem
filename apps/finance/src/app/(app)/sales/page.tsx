import { VoucherList } from "@/components/voucher-pages";

export const metadata = { title: "Invoices" };

export default function Page({ searchParams }: { searchParams: Promise<{ status?: string; q?: string; page?: string; show?: string }> }) {
  return <VoucherList kind="sales_invoice" searchParams={searchParams} />;
}
