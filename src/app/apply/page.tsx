import type { Metadata } from "next";
import { SchoolEmblem } from "@/components/brand";
import { SCHOOL } from "@/lib/school";
import { getReference } from "@/lib/data/reference";
import { ApplyForm } from "@/components/admissions/apply-form";
import type { ClassRef } from "@/components/admissions/shared";

export const metadata: Metadata = {
  title: `Apply for admission | ${SCHOOL.shortName}`,
  description: `Admission application for ${SCHOOL.fullName}.`,
};

// Public page: no sign-in. It reads only the list of classes (from the shared
// reference copy) and nothing about any person.
export default async function ApplyPage() {
  let classes: ClassRef[] = [];
  try {
    const ref = await getReference();
    const byId = new Map<number, { id: number; name: string; level: number }>();
    for (const s of ref.sections) if (s.class) byId.set(s.class.id, s.class);
    classes = [...byId.values()].sort((a, b) => a.level - b.level).map((c) => ({ id: c.id, name: c.name }));
  } catch {
    classes = [];
  }

  return (
    <div className="min-h-dvh bg-paper">
      <header className="border-b border-hair">
        <div className="mx-auto flex w-full max-w-2xl items-center gap-3 px-5 py-4 sm:px-8">
          <SchoolEmblem size={48} />
          <div className="leading-tight">
            <div className="text-[16px] font-semibold text-ink-900">{SCHOOL.name}</div>
            {SCHOOL.place && <div className="text-[13px] text-ink-500">{SCHOOL.place}</div>}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl px-5 py-8 sm:px-8">
        <h1 className="t-h1 text-ink-900">Apply for admission</h1>
        <p className="mt-1 text-[14px] text-ink-500">
          Fill in the details below. The school office will contact you on the phone number you give.
        </p>
        <div className="mt-6">
          {classes.length ? (
            <ApplyForm classes={classes} />
          ) : (
            <p className="rounded-md border border-hair px-4 py-3 text-[14px] text-ink-700">
              Online applications are not open at the moment. Please contact the school office.
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
