import Link from "next/link";
import { Icon } from "./icons";

export function ModuleNotice({ module, schoolId }: { module: string; schoolId: number }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-cx-line bg-cx-card px-4 py-2.5 text-[13px] text-cx-text-2">
      <Icon name="info" size={16} className="shrink-0 text-cx-muted" />
      <span className="flex-1">The <span className="font-medium capitalize text-cx-text">{module}</span> module is off for this institution, so its staff can&apos;t use it</span>
      <Link href={`/console/school/${schoolId}/settings`} className="text-cx-link hover:underline">Turn on in Settings</Link>
    </div>
  );
}
