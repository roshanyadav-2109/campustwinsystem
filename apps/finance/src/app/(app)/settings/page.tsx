import { createClient as createJs } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/context";
import { STATES, fmtDate } from "@/lib/format";
import { PageHeader, Section, Empty, inputCls, labelCls, btnPrimary, btnGhost, btnQuiet } from "@/components/ui";
import { ActionForm, Submit } from "@/components/action-form";
import { saveSettings, addTeamMember, removeTeamMember } from "../actions";

export const metadata = { title: "Settings" };

const ROLE = { admin: "Finance admin", accountant: "Accountant", viewer: "Viewer" } as const;

export default async function Settings() {
  const { db, org, userId } = await requireAdmin();
  const [{ data: s }, { data: team }] = await Promise.all([
    db.from("settings").select("legal_name, gstin, state_code, books_locked_until").eq("org_id", org.id).single(),
    db.from("team").select("user_id, role, added_at").eq("org_id", org.id).order("added_at"),
  ]);
  // Emails for the people listed (login records are only readable server-side).
  const admin = createJs(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
  const emails = new Map<string, string>();
  await Promise.all((team ?? []).map(async (t) => {
    const { data } = await admin.auth.admin.getUserById(t.user_id);
    if (data.user?.email) emails.set(t.user_id, data.user.email);
  }));

  return (
    <div>
      <PageHeader title="Settings" sub={org.name} />
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Section title="Organisation and GST">
          <ActionForm action={saveSettings} className="space-y-4">
            <div><label htmlFor="legal_name" className={labelCls}>Legal name (on invoices)</label><input id="legal_name" name="legal_name" maxLength={200} defaultValue={s?.legal_name ?? ""} className={inputCls} /></div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="state_code" className={labelCls}>State</label>
                <select id="state_code" name="state_code" defaultValue={s?.state_code ?? ""} required className={inputCls}>
                  <option value="" disabled>Choose</option>
                  {STATES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
                </select>
              </div>
              <div><label htmlFor="gstin" className={labelCls}>GSTIN</label><input id="gstin" name="gstin" maxLength={15} defaultValue={s?.gstin ?? ""} className={`${inputCls} uppercase`} /></div>
            </div>
            <div>
              <label htmlFor="books_locked_until" className={labelCls}>Books locked up to</label>
              <input id="books_locked_until" name="books_locked_until" type="date" defaultValue={s?.books_locked_until ?? ""} className={inputCls} />
              <p className="mt-1 text-[12px] text-cx-faint">Nothing dated on or before this can be posted or cancelled. Set it after filing returns or closing a month.{s?.books_locked_until ? ` Now locked up to ${fmtDate(s.books_locked_until)}.` : ""}</p>
            </div>
            <Submit className={btnPrimary}>Save</Submit>
          </ActionForm>
        </Section>

        <Section title="Who can use the books" desc="Organisation owners and admins are finance admins automatically" flush>
          {team?.length ? (
            <ul className="divide-y divide-cx-line">
              {team.map((t) => (
                <li key={t.user_id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-[14px]">
                  <span><span className="text-cx-text">{emails.get(t.user_id) ?? "Unknown login"}</span><span className="block text-[12.5px] text-cx-muted">{ROLE[t.role as keyof typeof ROLE]}</span></span>
                  {t.user_id !== userId && (
                    <ActionForm action={removeTeamMember}><input type="hidden" name="user_id" value={t.user_id} /><Submit className={btnQuiet} pending="Removing">Remove</Submit></ActionForm>
                  )}
                </li>
              ))}
            </ul>
          ) : <Empty>Nobody else yet.</Empty>}
          <ActionForm action={addTeamMember} reset className="space-y-2 border-t border-cx-line p-5">
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_150px]">
              <div><label htmlFor="email" className="sr-only">Email</label><input id="email" name="email" type="email" required placeholder="accountant@example.com" className={inputCls} /></div>
              <div>
                <label htmlFor="role" className="sr-only">Role</label>
                <select id="role" name="role" defaultValue="accountant" className={inputCls}>
                  <option value="accountant">Accountant</option><option value="viewer">Viewer</option><option value="admin">Finance admin</option>
                </select>
              </div>
            </div>
            <p className="text-[12px] text-cx-faint">Accountants create and post entries. Viewers can only look. They sign in with Google using this email.</p>
            <Submit className={btnGhost} pending="Adding">Give access</Submit>
          </ActionForm>
        </Section>
      </div>
    </div>
  );
}
