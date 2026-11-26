import { guardTab } from "@/lib/access";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState } from "@/components/ui/empty";
import { createClient } from "@/lib/supabase/server";
import { DigitalIdCard, FamilyDetails, type FamilyCard } from "@/components/students/digital-id-card";

// Parents and students: the digital ID card (shown on the phone at the gate)
// and the details the school holds, read-only.
export default async function IdCardPage() {
  const denied = await guardTab("/dashboard/id-card");
  if (denied) return denied;
  const supabase = await createClient();
  const { data } = await supabase.rpc("my_family_cards" as never);
  const cards = ((data ?? []) as unknown as { student_id: number; card: FamilyCard }[]);
  const verifyBase = `https://verify.${process.env.NEXT_PUBLIC_BASE_DOMAIN || "campustwin.org"}/verify/`;
  return (
    <div className="space-y-6">
      <PageHeader title="ID card and details" description="The student ID card, valid on the phone, and the details the school holds." />
      {cards.length === 0 && <EmptyState art="nothing-yet" title="Nothing to show yet" />}
      {cards.map(({ student_id, card }) => (
        <section key={student_id} className="grid gap-4 lg:grid-cols-[420px_1fr]">
          <div><h2 className="mb-2 text-[15px] font-semibold text-ink-900">{card.name}</h2><DigitalIdCard c={card} verifyBase={verifyBase} /></div>
          <div className="lg:pt-8"><FamilyDetails c={card} /></div>
        </section>
      ))}
    </div>
  );
}
