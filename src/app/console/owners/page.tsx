import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOwnerEmail } from "@/lib/owner";
import { addOwner, removeOwner } from "../actions";

const input = "rounded-md border border-hair bg-white px-3 py-2 text-[14px] text-ink-900 outline-none focus:border-[#0F6CBD]";

export default async function OwnersPage() {
  const me = await getOwnerEmail();
  const admin = createAdminClient();
  const { data: owners } = await admin.from("platform_owner").select("email, note, created_at").order("created_at");

  return (
    <div className="max-w-xl">
      <div className="mb-5"><Link href="/console" className="text-[13px] text-[#0F6CBD]">&larr; Institutions</Link></div>
      <h1 className="t-h1 text-ink-900">Company team</h1>
      <p className="mt-1 text-[13px] text-ink-500">CampusTwin team members who can sign in to this console (via Google) and manage every institution. Add your employees here.</p>

      <ul className="mt-5 divide-y divide-hair rounded-lg border border-hair bg-surface">
        {(owners ?? []).map((o) => (
          <li key={o.email} className="flex items-center justify-between px-4 py-3 text-[14px]">
            <span className="text-ink-900">{o.email}{o.email === me && <span className="ml-2 text-[11px] text-ink-500">(you)</span>}</span>
            {o.email !== me && (
              <form action={removeOwner}>
                <input type="hidden" name="email" value={o.email} />
                <button className="rounded-md border border-hair px-2.5 py-1 text-[12px] text-ink-700 hover:bg-panel">Remove</button>
              </form>
            )}
          </li>
        ))}
      </ul>

      <form action={addOwner} className="mt-4 flex items-center gap-2">
        <input name="email" type="email" required placeholder="employee@campustwin.org" className={`${input} flex-1`} />
        <button className="rounded-md bg-[#0F6CBD] px-4 py-2 text-[13px] font-medium text-white">Add team member</button>
      </form>
    </div>
  );
}
