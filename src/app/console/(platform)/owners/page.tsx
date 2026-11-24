import { createAdminClient } from "@/lib/supabase/admin";
import { getOwnerEmail } from "@/lib/owner";
import { addOwner, removeOwner } from "@/app/console/actions";
import { ZoneHeader } from "@/components/console/table";
import { Section, inputCls, labelCls, btnPrimary, btnGhost } from "@/components/console/ui";

const fmt = (d: string) => new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

export default async function OwnersPage() {
  const me = await getOwnerEmail();
  const admin = createAdminClient();
  const { data: owners } = await admin.from("platform_owner").select("email, created_at").order("created_at");
  const list = owners ?? [];

  return (
    <div>
      <ZoneHeader title="Console access" sub="People who can sign in here and manage every institution" />

      <div className="grid items-start gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Section title="Members" desc={`${list.length} ${list.length === 1 ? "person" : "people"}`} flush>
            <ul className="divide-y divide-cx-line">
              {list.map((o) => (
                <li key={o.email} className="flex items-center justify-between gap-3 px-5 py-3">
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-cx-raised text-[12px] font-semibold text-cx-text-2">{o.email.slice(0, 1).toUpperCase()}</span>
                    <span className="min-w-0">
                      <span className="block truncate text-[13.5px] font-medium text-cx-text">{o.email}{o.email === me && <span className="ml-2 font-normal text-cx-muted">(you)</span>}</span>
                      {o.created_at && <span className="block text-[12px] text-cx-muted">Added {fmt(o.created_at)}</span>}
                    </span>
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
          </Section>

          <Section title="Add a member">
            <form action={addOwner} className="flex flex-wrap items-end gap-2">
              <div className="min-w-[260px] flex-1">
                <label className={labelCls} htmlFor="o-email">Google account email</label>
                <input id="o-email" name="email" type="email" required placeholder="name@example.com" className={inputCls} />
              </div>
              <button className={btnPrimary}>Add member</button>
            </form>
          </Section>
        </div>

        <Section title="What members can do">
          <ul className="space-y-2.5 text-[13px] leading-5 text-cx-text-2">
            <li>Open any institution and see its people, classes, attendance and exams.</li>
            <li>Create schools and universities, and change their branding and modules.</li>
            <li>Suspend or reactivate an institution.</li>
            <li>Export student and staff lists.</li>
          </ul>
        </Section>
      </div>
    </div>
  );
}
