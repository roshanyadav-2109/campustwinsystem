import { VoucherList } from "@/components/voucher-pages";

export const metadata = { title: "Payments" };

export default function Page({ searchParams }: { searchParams: Promise<{ status?: string; q?: string; page?: string; show?: string }> }) {
  return <VoucherList kind="payment" searchParams={searchParams} />;
}
