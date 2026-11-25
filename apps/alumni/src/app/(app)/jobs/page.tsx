import { requireSetUp } from "@/lib/context";
import { fmtDate, todayIST } from "@/lib/format";
import { PageHeader, Section, Empty, inputCls, labelCls, btnPrimary, btnQuiet } from "@/components/ui";
import { ActionForm, Submit } from "@/components/action-form";
import { postJob, closeJob } from "../actions";

export const metadata = { title: "Jobs" };

export default async function Jobs() {
  const { db, org, isStaff, memberId } = await requireSetUp();
  const today = todayIST();
  const { data: jobs } = await db.from("job").select("id, title, company, location, apply_url, description, closes_on, member_id, created_at, poster:member!job_org_id_member_id_fkey(full_name, batch_year)")
    .eq("org_id", org.id).eq("status", "open").order("created_at", { ascending: false }).limit(100);
  const open = (jobs ?? []).filter((j) => !j.closes_on || j.closes_on >= today);

  return (
    <div>
      <PageHeader title="Jobs" sub="Openings shared by alumni and the alumni office" />
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Section flush>
          {open.length ? (
            <ul className="divide-y divide-cx-line">
              {open.map((j) => {
                const poster = j.poster as unknown as { full_name: string; batch_year: number | null } | null;
                const mine = isStaff || (memberId && j.member_id === memberId);
                return (
                  <li key={j.id} className="px-5 py-3.5">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="text-[15px] font-medium text-cx-text">{j.title}, {j.company}</p>
                      {mine && <ActionForm action={closeJob}><input type="hidden" name="id" value={j.id} /><Submit className={btnQuiet} pending="Closing">Close</Submit></ActionForm>}
                    </div>
                    <p className="text-[13px] text-cx-muted">
                      {[j.location, j.closes_on && `apply by ${fmtDate(j.closes_on)}`, poster ? `shared by ${poster.full_name}${poster.batch_year ? ` (${poster.batch_year})` : ""}` : "shared by the alumni office"].filter(Boolean).join(", ")}
                    </p>
                    {j.description && <p className="mt-1 line-clamp-3 whitespace-pre-line text-[13.5px] text-cx-text-2">{j.description}</p>}
                    {j.apply_url && <a href={j.apply_url} target="_blank" rel="noreferrer" className="mt-1 inline-block text-[13.5px] font-medium text-cx-link hover:underline">How to apply</a>}
                  </li>
                );
              })}
            </ul>
          ) : <Empty>No open jobs right now.</Empty>}
        </Section>
        {(isStaff || memberId) && (
          <Section title="Share a job">
            <ActionForm action={postJob} reset className="space-y-3">
              <div><label htmlFor="title" className={labelCls}>Role</label><input id="title" name="title" required maxLength={160} className={inputCls} /></div>
              <div><label htmlFor="company" className={labelCls}>Company</label><input id="company" name="company" required maxLength={120} className={inputCls} /></div>
              <div><label htmlFor="location" className={labelCls}>Location</label><input id="location" name="location" maxLength={120} placeholder="Bengaluru, or Remote" className={inputCls} /></div>
              <div><label htmlFor="apply_url" className={labelCls}>Link or email to apply</label><input id="apply_url" name="apply_url" placeholder="https://... or hr@company.com" className={inputCls} /></div>
              <div><label htmlFor="closes_on" className={labelCls}>Apply by (optional)</label><input id="closes_on" name="closes_on" type="date" min={today} className={inputCls} /></div>
              <div><label htmlFor="description" className={labelCls}>Details</label><textarea id="description" name="description" rows={3} maxLength={4000} className={inputCls} /></div>
              <Submit className={btnPrimary} pending="Posting">Post job</Submit>
            </ActionForm>
          </Section>
        )}
      </div>
    </div>
  );
}
