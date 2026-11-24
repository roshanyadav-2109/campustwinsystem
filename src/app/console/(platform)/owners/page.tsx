import { createAdminClient } from "@/lib/supabase/admin";
import { getOwnerEmail } from "@/lib/owner";
import { addOwner, removeOwner } from "@/app/console/actions";
import { PageHeader, Section, inputCls, btnPrimary, btnGhost } from "@/components/console/ui";

export default async function OwnersPage() {
  const me = await getOwnerEmail();
  const admin = createAdminClient();
  const { data: owners } = await admin.from("platform_owner").select("email, note, created_at").order("created_at");

  return (
    <div className="max-w-2xl">
      <PageHeader title="Team" />
      <p className="-mt-3 mb-4 text-[12.5px] text-cx-muted">
        CampusTwin team members who can sign in to this console with Google and manage every institution.
      </p>

      <Section title="Console access" desc={`${owners?.length ?? 0} member${(owners?.length ?? 0) === 1 ? "" : "s"}`}>
        <ul className="divide-y divide-cx-line rounded-lg border border-cx-line">
          {(owners ?? []).map((o) => (
            <li key={o.email} className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-[13px]">
              <span className="flex items-center gap-2 text-cx-text">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-cx-raised text-[11px] font-semibold uppercase text-cx-muted">{o.email.slice(0, 2)}</span>
                {o.email}
                {o.email === me && <span className="rounded bg-cx-raised px-1.5 py-0.5 text-[10px] font-medium text-cx-link">You</span>}
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
        <form action={addOwner} className="mt-3 flex items-center gap-2">
          <input name="email" type="email" required placeholder="employee@campustwin.org" className={inputCls} />
          <button className={`${btnPrimary} shrink-0`}>Add member</button>
        </form>
      </Section>
    </div>
  );
}
