import { getCtx } from "@/lib/context";
import { Shell } from "@/components/shell";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getCtx();
  return <Shell ctx={ctx}>{children}</Shell>;
}
