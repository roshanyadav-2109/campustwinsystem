import { createClient as createJs } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/context";
import { PageHeader, Section, Empty, inputCls, labelCls, btnPrimary, btnGhost, btnQuiet } from "@/components/ui";
import { ActionForm, Submit } from "@/components/action-form";
import { saveSettings, addTeamMember, removeTeamMember } from "../../actions";

export const metadata = { title: "Settings" };

export default async function Settings() {
  const { db, org, userId } = await requireAdmin();
  const [{ data: s }, { data: team }] = await Promise.all([
    db.from("settings").select("*").eq("org_id", org.id).single(),
    db.from("team").select("user_id, role").eq("org_id", org.id).order("added_at"),
  ]);
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
        <Section title="Institution and tax details">
          <ActionForm action={saveSettings} className="space-y-4">
            <div><label htmlFor="display_name" className={labelCls}>Name shown to alumni and on receipts</label><input id="display_name" name="display_name" maxLength={200} defaultValue={s?.display_name ?? ""} className={inputCls} /></div>
            <div><label htmlFor="address" className={labelCls}>Address (on receipts)</label><textarea id="address" name="address" rows={2} maxLength={500} defaultValue={s?.address ?? ""} className={inputCls} /></div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div><label htmlFor="pan" className={labelCls}>Institution&apos;s PAN</label><input id="pan" name="pan" maxLength={10} defaultValue={s?.pan ?? ""} className={`${inputCls} uppercase`} /></div>
              <div><label htmlFor="reg_80g" className={labelCls}>80G registration number</label><input id="reg_80g" name="reg_80g" maxLength={60} defaultValue={s?.reg_80g ?? ""} className={inputCls} /></div>
            </div>
            <div><label htmlFor="reg_80g_valid_until" className={labelCls}>80G registration valid until</label><input id="reg_80g_valid_until" name="reg_80g_valid_until" type="date" defaultValue={s?.reg_80g_valid_until ?? ""} className={inputCls} /></div>
            <label className="flex items-start gap-2 text-[13.5px] text-cx-text-2"><input type="checkbox" name="fcra_registered" defaultChecked={s?.fcra_registered} className="mt-0.5 h-4 w-4 accent-cx-text" /> Registered under FCRA (allowed to receive donations from foreign citizens)</label>
            <label className="flex items-start gap-2 text-[13.5px] text-cx-text-2"><input type="checkbox" name="join_open" defaultChecked={s?.join_open} className="mt-0.5 h-4 w-4 accent-cx-text" /> Accept requests to join through the join link</label>
            <Submit className={btnPrimary}>Save</Submit>
          </ActionForm>
        </Section>
        <Section title="Alumni office" desc="Organisation owners and admins are alumni admins automatically" flush>
          {team?.length ? (
            <ul className="divide-y divide-cx-line">
              {team.map((t) => (
                <li key={t.user_id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-[14px]">
                  <span><span className="text-cx-text">{emails.get(t.user_id) ?? "Unknown login"}</span><span className="block text-[12.5px] text-cx-muted">{t.role === "admin" ? "Alumni admin" : "Alumni office"}</span></span>
                  {t.user_id !== userId && <ActionForm action={removeTeamMember}><input type="hidden" name="user_id" value={t.user_id} /><Submit className={btnQuiet} pending="Removing">Remove</Submit></ActionForm>}
                </li>
              ))}
            </ul>
          ) : <Empty>Nobody else yet.</Empty>}
          <ActionForm action={addTeamMember} reset className="space-y-2 border-t border-cx-line p-5">
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_160px]">
              <div><label htmlFor="team-email" className="sr-only">Email</label><input id="team-email" name="email" type="email" required placeholder="alumni.office@example.edu" className={inputCls} /></div>
              <div><label htmlFor="team-role" className="sr-only">Role</label>
                <select id="team-role" name="role" defaultValue="editor" className={inputCls}><option value="editor">Alumni office</option><option value="admin">Alumni admin</option></select>
              </div>
            </div>
            <p className="text-[12px] text-cx-faint">The alumni office manages records, events, news and donations. Admins also change these settings. They sign in with Google using this email.</p>
            <Submit className={btnGhost} pending="Adding">Give access</Submit>
          </ActionForm>
        </Section>
      </div>
    </div>
  );
}
