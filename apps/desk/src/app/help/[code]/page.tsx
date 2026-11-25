import { notFound } from "next/navigation";
import { publicDb, isCode } from "@/lib/public";
import { inputCls, labelCls, btnPrimary } from "@/components/ui";
import { ActionForm, Submit, Toaster } from "@/components/action-form";
import { submitTicket } from "./actions";

export const metadata = { title: "Help" };
export const dynamic = "force-dynamic";

// An organisation's public help page: answers first, then a way to ask.
export default async function Help({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ q?: string; a?: string }> }) {
  const { code } = await params;
  if (!isCode(code)) notFound();
  const sp = await searchParams;
  const db = publicDb();
  const { data: s } = await db.from("settings").select("org_id, display_name, form_open").eq("public_code", code).maybeSingle();
  if (!s) notFound();
  const { data: sub } = await db.rpc("subscribed", { p_org: s.org_id });
  if (!sub) notFound();
  const q = (sp.q ?? "").trim().replace(/[%_,()\\"*:]/g, " ").trim().slice(0, 60);
  let aq = db.from("article").select("id, title, body").eq("org_id", s.org_id).eq("published", true).order("updated_at", { ascending: false }).limit(20);
  // every word must appear in the title or the answer, in any order
  for (const w of q.split(/\s+/).filter((x) => x.length > 1).slice(0, 6)) aq = aq.or(`title.ilike.%${w}%,body.ilike.%${w}%`);
  const [{ data: articles }, { data: cats }] = await Promise.all([
    aq,
    db.from("category").select("id, name").eq("org_id", s.org_id).eq("active", true).order("name"),
  ]);
  const open = Number(sp.a) || null;

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-12 items-center bg-cx-bar px-4 text-white">
        <span className="text-[15px] font-semibold">{s.display_name ?? "Help"}</span>
        <span className="ml-2 text-[13px] text-white/60">Help</span>
      </header>
      <main className="mx-auto grid w-full max-w-[1100px] gap-6 px-4 pb-16 pt-8 lg:grid-cols-[minmax(0,1fr)_420px]">
        <section>
          <h1 className="text-[24px] font-semibold leading-8 text-cx-text">How can we help?</h1>
          <form className="mt-3 flex gap-2">
            <label htmlFor="q" className="sr-only">Search the answers</label>
            <input id="q" name="q" defaultValue={q} placeholder="Search the answers, e.g. fee receipt" className={inputCls} />
            <button className="inline-flex h-8 shrink-0 items-center rounded-md border border-cx-line-strong bg-cx-card px-3 text-[13px] font-medium text-cx-text hover:bg-cx-raised">Search</button>
          </form>
          <ul className="mt-4 divide-y divide-cx-line overflow-hidden rounded-[10px] border border-cx-line bg-cx-card">
            {(articles ?? []).length ? articles!.map((a) => (
              <li key={a.id}>
                <details open={open === a.id} className="group px-5 py-3">
                  <summary className="cursor-pointer list-none text-[14.5px] font-medium text-cx-text marker:hidden">{a.title}</summary>
                  <p className="mt-2 whitespace-pre-line text-[14px] leading-6 text-cx-text-2">{a.body}</p>
                </details>
              </li>
            )) : <li className="px-5 py-8 text-center text-[13.5px] text-cx-muted">{q ? "No answers match. Ask us instead." : "No answers published yet."}</li>}
          </ul>
        </section>

        <section className="lg:pt-10">
          {s.form_open ? (
            <ActionForm action={submitTicket} className="space-y-3 rounded-[10px] border border-cx-line bg-cx-card p-5">
              <h2 className="text-[16px] font-semibold text-cx-text">Ask us</h2>
              <input type="hidden" name="code" value={code} />
              <div aria-hidden className="absolute -left-[9999px]"><label htmlFor="website">Website</label><input id="website" name="website" tabIndex={-1} autoComplete="off" /></div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div><label htmlFor="requester_name" className={labelCls}>Your name</label><input id="requester_name" name="requester_name" required maxLength={150} className={inputCls} /></div>
                <div><label htmlFor="requester_phone" className={labelCls}>Phone (optional)</label><input id="requester_phone" name="requester_phone" type="tel" maxLength={20} className={inputCls} /></div>
              </div>
              <div><label htmlFor="requester_email" className={labelCls}>Email (optional)</label><input id="requester_email" name="requester_email" type="email" className={inputCls} /></div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="kind" className={labelCls}>This is a</label>
                  <select id="kind" name="kind" defaultValue="request" className={inputCls}>
                    <option value="request">Request or question</option><option value="complaint">Complaint</option><option value="grievance">Formal grievance</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="category_id" className={labelCls}>About</label>
                  <select id="category_id" name="category_id" defaultValue="" className={inputCls}>
                    <option value="">Not sure</option>
                    {(cats ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              </div>
              <div><label htmlFor="subject" className={labelCls}>Subject</label><input id="subject" name="subject" required maxLength={200} className={inputCls} /></div>
              <div><label htmlFor="description" className={labelCls}>Details</label><textarea id="description" name="description" required rows={5} maxLength={8000} className={inputCls} /></div>
              <Submit className={`${btnPrimary} w-full`} pending="Sending">Send</Submit>
              <p className="text-[12px] leading-5 text-cx-faint">You get a private link to follow your request and reply. Keep it safe; anyone with the link can see the conversation.</p>
            </ActionForm>
          ) : (
            <p className="rounded-[10px] border border-cx-line bg-cx-card p-5 text-[14px] text-cx-text-2">Requests are not being taken here at the moment.</p>
          )}
        </section>
      </main>
      <Toaster />
    </div>
  );
}
