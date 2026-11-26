import { getT } from "@/i18n/server";
import { EmptyState } from "@/components/ui/empty";
import { TRANSPORT_ENABLED } from "@/lib/features";

// Every transport route sits under this layout. Each page's guard already
// closes it when the school's transport module is off.
export default async function TransportLayout({ children }: { children: React.ReactNode }) {
  if (TRANSPORT_ENABLED) return children;
  const { t } = await getT();
  return (
    <EmptyState art="coming-soon-transport" title={t("transport.comingSoon")} hint={t("transport.comingSoonHint")} className="min-h-[60vh]" />
  );
}
