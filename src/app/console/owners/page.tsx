import { createAdminClient } from "@/lib/supabase/admin";
import { getOwnerEmail } from "@/lib/owner";
import { addOwner, removeOwner } from "../actions";
import { PageHeader, Section, inputCls, btnPrimary, btnGhost } from "@/components/console/ui";

export default async function OwnersPage() {
  const me = await getOwnerEmail();
  const admin = createAdminClient();
  const { data: owners } = await admin.from("platform_owner").select("email, note, created_at").order("created_at");

  return (
    <div className="max-w-2xl">
      <PageHeader title="Team" />
      <p className="-mt-3 mb-6 text-[13px] text-ink-500">
        CampusTwin team members who can sign in to this console with Google and manage every institution.
      </p>

      <Section title="Console access" desc={`${owners?.length ?? 0} member${(owners?.length ?? 0) === 1 ? "" : "s"}`}>
        <ul className="divide-y divide-hair rounded-lg border border-hair">
          {(owners ?? []).map((o) => (
            <li key={o.email} className="flex items-center justify-between gap-3 px-4 py-3 text-[13.5px]">
              <span className="flex items-center gap-2 text-ink-900">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-panel text-[11px] font-semibold uppercase text-ink-500">{o.email.slice(0, 2)}</span>
                {o.email}
                {o.email === me && <span className="rounded bg-[#0F6CBD]/10 px-1.5 py-0.5 text-[10.5px] font-medium text-[#0F6CBD]">You</span>}
              </span>
              {o.email !== me && (
                <form action={removeOwner}>
                  <input type="hidden" name="email" value={o.email} />
                  <button className={btnGhost}>Remove</button>
                </form>
              )}
            </li>
          ))}
        </ul>

        <form action={addOwner} className="mt-4 flex items-center gap-2">
          <input name="email" type="email" required placeholder="employee@campustwin.org" className={inputCls} />
          <button className={`${btnPrimary} shrink-0`}>Add member</button>
        </form>
      </Section>
    </div>
  );
}
