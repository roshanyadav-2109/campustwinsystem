import { notFound } from "next/navigation";
import { publicDb, isToken } from "@/lib/public";
import { fmtWhen, STATUS_LABEL, STATUS_TONE, KIND_LABEL } from "@/lib/format";
import { inputCls, btnPrimary, Status } from "@/components/ui";
import { ActionForm, Submit, Toaster } from "@/components/action-form";
import { requesterReply } from "./actions";

export const metadata = { title: "Your request", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

// The requester's private view of their request: status, the public
// conversation (never internal notes) and a reply box.
export default async function Track({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ new?: string }> }) {
  const { token } = await params;
  if (!isToken(token)) notFound();
  const db = publicDb();
  const { data: t } = await db.from("ticket").select("id, org_id, number, subject, description, kind, status, requester_name, created_at").eq("public_token", token).maybeSingle();
  if (!t) notFound();
  const [{ data: msgs }, { data: s }] = await Promise.all([
    db.from("message").select("id, author_kind, author_name, body, created_at").eq("ticket_id", t.id).eq("internal", false).order("created_at"),
    db.from("settings").select("display_name").eq("org_id", t.org_id).single(),
  ]);
  const fresh = (await searchParams).new === "1";

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-12 items-center bg-cx-bar px-4 text-white">
        <span className="text-[15px] font-semibold">{s?.display_name ?? "Help"}</span>
        <span className="ml-2 text-[13px] text-white/60">Your request</span>
      </header>
      <main className="mx-auto w-full max-w-[760px] px-4 pb-16 pt-8">
        {fresh && (
          <p role="status" className="mb-4 rounded-md border border-cx-line bg-cx-card px-4 py-3 text-[14px] text-cx-text-2">
            <b className="font-semibold text-cx-text">Your request has been received.</b> Bookmark this page: it is your private link to follow the request and reply.
          </p>
        )}
        <h1 className="text-[22px] font-semibold leading-8 text-cx-text text-balance">{t.subject}</h1>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 text-[13px] text-cx-muted">
          <span>Request #{t.number}</span><span>{KIND_LABEL[t.kind]}</span><Status tone={STATUS_TONE[t.status]}>{STATUS_LABEL[t.status]}</Status>
        </p>
        <ol className="mt-5 space-y-3">
          <li className="rounded-[10px] border border-cx-line bg-cx-card p-4">
            <p className="text-[12.5px] text-cx-muted">{t.requester_name}, {fmtWhen(t.created_at)}</p>
            <p className="mt-1 whitespace-pre-line text-[14px] leading-6 text-cx-text">{t.description}</p>
          </li>
          {(msgs ?? []).map((m) => (
            <li key={m.id} className={`rounded-[10px] border p-4 ${m.author_kind === "agent" ? "border-cx-line-strong bg-cx-raised" : "border-cx-line bg-cx-card"}`}>
              <p className="text-[12.5px] text-cx-muted">{m.author_kind === "agent" ? `${m.author_name}, help desk` : m.author_name}, {fmtWhen(m.created_at)}</p>
              <p className="mt-1 whitespace-pre-line text-[14px] leading-6 text-cx-text">{m.body}</p>
            </li>
          ))}
        </ol>
        {t.status !== "closed" ? (
          <ActionForm action={requesterReply} reset className="mt-5 space-y-2">
            <input type="hidden" name="token" value={token} />
            <label htmlFor="body" className="text-[13px] font-medium text-cx-text-2">Reply</label>
            <textarea id="body" name="body" rows={4} maxLength={8000} required className={inputCls} />
            <Submit className={btnPrimary} pending="Sending">Send reply</Submit>
          </ActionForm>
        ) : <p className="mt-5 text-[13.5px] text-cx-muted">This request is closed.</p>}
      </main>
      <Toaster />
    </div>
  );
}
