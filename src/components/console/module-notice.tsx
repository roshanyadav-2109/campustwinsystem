import Link from "next/link";

export function ModuleNotice({ module, schoolId }: { module: string; schoolId: number }) {
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[12.5px] text-amber-800">
      <span>The <b className="capitalize">{module}</b> module is turned off for this institution — staff can&apos;t use it until it&apos;s enabled.</span>
      <Link href={`/console/school/${schoolId}/settings`} className="shrink-0 rounded-md border border-amber-300 bg-white px-2.5 py-1 font-medium text-amber-800 hover:bg-amber-100">Enable in Settings</Link>
    </div>
  );
}
