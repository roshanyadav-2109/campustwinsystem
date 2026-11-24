import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getUniversityLanding, getBrand } from "@/lib/brand-server";
import { SchoolEmblem } from "@/components/brand";

const BASE = process.env.NEXT_PUBLIC_BASE_DOMAIN || "campustwin.org";

export async function generateMetadata(): Promise<Metadata> {
  const uni = await getUniversityLanding();
  if (uni) return { title: uni.name, description: `Campuses of ${uni.name}.` };
  return { title: "CampusTwin", description: "School & campus management, one platform." };
}

// Root route by host:
//  - a university host (srm.campustwin.org)  -> campus directory
//  - a school host (kviit.campustwin.org)    -> the school's app (/dashboard)
//  - the apex (campustwin.org) / unknown     -> the CampusTwin placeholder
export default async function Home() {
  const uni = await getUniversityLanding();
  if (uni) {
    return (
      <div className="min-h-dvh bg-paper">
        <header className="border-b border-hair">
          <div className="mx-auto flex w-full max-w-3xl items-center gap-3 px-5 py-5 sm:px-8">
            <SchoolEmblem size={48} logo={uni.logo} monogram={uni.shortName || uni.name} name={uni.name} />
            <div className="leading-tight">
              <div className="text-[18px] font-semibold text-ink-900">{uni.name}</div>
              <div className="text-[13px] text-ink-500">Choose your campus</div>
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-8">
          {uni.campuses.length === 0 ? (
            <p className="rounded-md border border-hair px-4 py-3 text-[14px] text-ink-700">
              No campuses are published yet. Please check back soon.
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {uni.campuses.map((c) => (
                <a
                  key={c.id}
                  href={`https://${c.slug}.${BASE}`}
                  className="group flex items-center justify-between rounded-lg border border-hair bg-surface p-4 transition-colors hover:border-ink-300"
                >
                  <div className="min-w-0">
                    <div className="truncate text-[15px] font-semibold text-ink-900">{c.name}</div>
                    {c.place && <div className="truncate text-[13px] text-ink-500">{c.place}</div>}
                    <div className="mt-1 text-[12px] text-muted">{c.slug}.{BASE}</div>
                  </div>
                  <span className="ml-3 shrink-0 text-ink-500 transition-colors group-hover:text-[#0F6CBD]" aria-hidden>→</span>
                </a>
              ))}
            </div>
          )}
        </main>
      </div>
    );
  }

  // A school subdomain -> into the school's app.
  const brand = await getBrand();
  if (brand.slug) redirect("/dashboard");

  // Apex / unknown host -> neutral CampusTwin placeholder (no school).
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-paper px-6 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-[#0F6CBD] text-[20px] font-bold text-white">CT</div>
      <h1 className="mt-5 text-[26px] font-semibold text-ink-900">CampusTwin</h1>
      <p className="mt-2 max-w-md text-[15px] text-ink-500">
        School &amp; campus management, one platform. Each institution has its own address, e.g. <span className="text-ink-700">yourschool.{BASE}</span>.
      </p>
    </div>
  );
}
