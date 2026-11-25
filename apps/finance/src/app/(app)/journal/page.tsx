import { VoucherList } from "@/components/voucher-pages";

export const metadata = { title: "Journal entries" };

export default function Page({ searchParams }: { searchParams: Promise<{ status?: string; q?: string; page?: string; show?: string }> }) {
  return <VoucherList kind="journal" searchParams={searchParams} />;
}
