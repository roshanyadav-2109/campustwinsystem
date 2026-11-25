import { NewVoucher } from "@/components/voucher-pages";

export const metadata = { title: "New" };

export default function Page({ searchParams }: { searchParams: Promise<{ party?: string }> }) {
  return <NewVoucher kind="receipt" searchParams={searchParams} />;
}
