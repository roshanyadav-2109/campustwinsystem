import { requireAdmin } from "@/lib/context";
import { agentMap } from "@/lib/agents";
import { PageHeader, Section, Empty, inputCls, labelCls, btnPrimary, btnGhost, btnQuiet } from "@/components/ui";
import { ActionForm, Submit } from "@/components/action-form";
import { saveSettings, addCategory, toggleCategory, addTeamMember, removeTeamMember } from "../actions";

export const metadata = { title: "Settings" };
const P = [["urgent", "Urgent"], ["high", "High"], ["normal", "Normal"], ["low", "Low"]] as const;

export default async function Settings() {
  const { db, org, userId } = await requireAdmin();
  const [{ data: s }, { data: cats }, { data: team }, agents] = await Promise.all([
    db.from("settings").select("*").eq("org_id", org.id).single(),
    db.from("category").select("id, name, active").eq("org_id", org.id).order("name"),
    db.from("team").select("user_id, role").eq("org_id", org.id).order("added_at"),
    agentMap(db, org.id),
  ]);
  if (!s) return null;
  const email = new Map(agents.list.map((a) => [a.id, a.email]));
  return (
    <div>
      <PageHeader title="Settings" sub={org.name} />
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Section title="Help page and deadlines">
          <ActionForm action={saveSettings} className="space-y-4">
            <div><label htmlFor="display_name" className={labelCls}>Name shown on the help page</label><input id="display_name" name="display_name" maxLength={200} defaultValue={s.display_name ?? ""} className={inputCls} /></div>
            <p className="break-all font-mono text-[12.5px] text-cx-text">desk.campustwin.org/help/{s.public_code}</p>
            <label className="flex items-center gap-2 text-[13.5px] text-cx-text-2"><input type="checkbox" name="form_open" defaultChecked={s.form_open} className="h-4 w-4 accent-cx-text" /> Take requests through the help page</label>
            <div>
              <p className="mb-1 text-[12.5px] font-medium text-cx-text-2">Deadlines in hours</p>
              <table className="w-full text-[13.5px]">
                <thead><tr className="text-left text-[12.5px] text-cx-muted"><th className="py-1 font-medium">Priority</th><th className="py-1 font-medium">First reply within</th><th className="py-1 font-medium">Resolve within</th></tr></thead>
                <tbody>
                  {P.map(([k, label]) => (
                    <tr key={k}>
                      <td className="py-1 text-cx-text">{label}</td>
                      <td className="py-1 pr-2"><label htmlFor={`respond_${k}`} className="sr-only">{label}: first reply within (hours)</label><input id={`respond_${k}`} name={`respond_${k}`} type="number" min={1} max={720} defaultValue={s[`respond_${k}` as keyof typeof s] as number} className={inputCls} /></td>
                      <td className="py-1"><label htmlFor={`resolve_${k}`} className="sr-only">{label}: resolve within (hours)</label><input id={`resolve_${k}`} name={`resolve_${k}`} type="number" min={1} max={2160} defaultValue={s[`resolve_${k}` as keyof typeof s] as number} className={inputCls} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Submit className={btnPrimary}>Save</Submit>
          </ActionForm>
        </Section>
        <div className="space-y-4">
          <Section title="Subjects" desc="What people can choose when they ask" flush>
            <ul className="divide-y divide-cx-line">
              {(cats ?? []).map((c) => (
                <li key={c.id} className={`flex items-center justify-between px-5 py-2 text-[14px] ${c.active ? "" : "text-cx-faint"}`}>
                  <span>{c.name}</span>
                  <ActionForm action={toggleCategory}><input type="hidden" name="id" value={c.id} /><input type="hidden" name="active" value={c.active ? "0" : "1"} /><Submit className={btnQuiet}>{c.active ? "Hide" : "Show"}</Submit></ActionForm>
                </li>
              ))}
            </ul>
            <ActionForm action={addCategory} reset className="flex gap-2 border-t border-cx-line p-4">
              <label htmlFor="cat-name" className="sr-only">New subject</label>
              <input id="cat-name" name="name" required maxLength={80} placeholder="e.g. Hostel" className={inputCls} />
              <Submit className={btnGhost} pending="Adding">Add</Submit>
            </ActionForm>
          </Section>
          <Section title="Agents" desc="Organisation owners and admins are desk admins automatically" flush>
            {team?.length ? (
              <ul className="divide-y divide-cx-line">
                {team.map((t) => (
                  <li key={t.user_id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-[14px]">
                    <span><span className="text-cx-text">{email.get(t.user_id) ?? "Unknown login"}</span><span className="block text-[12.5px] text-cx-muted">{t.role === "admin" ? "Desk admin" : "Agent"}</span></span>
                    {t.user_id !== userId && <ActionForm action={removeTeamMember}><input type="hidden" name="user_id" value={t.user_id} /><Submit className={btnQuiet} pending="Removing">Remove</Submit></ActionForm>}
                  </li>
                ))}
              </ul>
            ) : <Empty>No agents yet.</Empty>}
            <ActionForm action={addTeamMember} reset className="space-y-2 border-t border-cx-line p-5">
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_140px]">
                <div><label htmlFor="team-email" className="sr-only">Email</label><input id="team-email" name="email" type="email" required placeholder="helpdesk@example.edu" className={inputCls} /></div>
                <div><label htmlFor="team-role" className="sr-only">Role</label><select id="team-role" name="role" defaultValue="agent" className={inputCls}><option value="agent">Agent</option><option value="admin">Desk admin</option></select></div>
              </div>
              <p className="text-[12px] text-cx-faint">Agents answer and resolve requests. Admins also change these settings. They sign in with Google using this email.</p>
              <Submit className={btnGhost} pending="Adding">Add agent</Submit>
            </ActionForm>
          </Section>
        </div>
      </div>
    </div>
  );
}
