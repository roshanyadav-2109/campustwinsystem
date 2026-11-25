import { notFound } from "next/navigation";
import { createClient as createJs } from "@supabase/supabase-js";
import { inputCls, labelCls, btnPrimary } from "@/components/ui";
import { ActionForm, Submit, Toaster } from "@/components/action-form";
import { requestToJoin } from "./actions";

export const metadata = { title: "Join the alumni network" };
export const dynamic = "force-dynamic";

// Public page an institution shares with its alumni. Anyone can ask to join;
// the alumni office checks and approves each request.
export default async function Join({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  if (!/^[a-z0-9]{6,20}$/.test(code)) notFound();
  const admin = createJs(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false }, db: { schema: "alum" } });
  const { data: s } = await admin.from("settings").select("org_id, display_name, join_open").eq("join_code", code).maybeSingle();
  if (!s) notFound();
  const year = new Date().getFullYear();

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-12 items-center bg-cx-bar px-4 text-white">
        <span className="text-[15px] font-semibold">Eternity</span>
        <span className="ml-2 text-[15px] text-white/70">Alumni</span>
      </header>
      <main className="mx-auto w-full max-w-[560px] px-4 pb-16 pt-[8vh]">
        <h1 className="text-[24px] font-semibold leading-8 text-cx-text text-balance">{s.display_name ?? "Alumni network"}</h1>
        {!s.join_open ? (
          <p className="mt-2 text-[14px] text-cx-text-2">Requests to join are closed at the moment. Please contact the alumni office.</p>
        ) : (
          <>
            <p className="mb-6 mt-1 text-[14px] text-cx-muted">Ask to join the alumni network. The alumni office checks every request, then you can sign in with Google using this email.</p>
            <ActionForm action={requestToJoin} className="space-y-4 rounded-[10px] border border-cx-line bg-cx-card p-5">
              <input type="hidden" name="code" value={code} />
              {/* Left empty by people; automated sign-up scripts tend to fill it. */}
              <div aria-hidden className="absolute -left-[9999px]"><label htmlFor="website">Website</label><input id="website" name="website" tabIndex={-1} autoComplete="off" /></div>
              <div><label htmlFor="full_name" className={labelCls}>Full name</label><input id="full_name" name="full_name" required maxLength={150} className={inputCls} /></div>
              <div><label htmlFor="email" className={labelCls}>Email (the one you sign in to Google with)</label><input id="email" name="email" type="email" required className={inputCls} /></div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div><label htmlFor="batch_year" className={labelCls}>Year you passed out</label><input id="batch_year" name="batch_year" type="number" min={1950} max={year + 1} required className={inputCls} /></div>
                <div><label htmlFor="programme" className={labelCls}>Course or class</label><input id="programme" name="programme" maxLength={120} placeholder="B.Com, Class XII" className={inputCls} /></div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div><label htmlFor="roll_number" className={labelCls}>Roll number (if you remember)</label><input id="roll_number" name="roll_number" maxLength={40} className={inputCls} /></div>
                <div><label htmlFor="city" className={labelCls}>City you live in</label><input id="city" name="city" maxLength={80} className={inputCls} /></div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div><label htmlFor="company" className={labelCls}>Where you work</label><input id="company" name="company" maxLength={120} className={inputCls} /></div>
                <div><label htmlFor="phone" className={labelCls}>Phone</label><input id="phone" name="phone" type="tel" maxLength={20} className={inputCls} /></div>
              </div>
              <Submit className={`${btnPrimary} w-full`} pending="Sending">Ask to join</Submit>
            </ActionForm>
          </>
        )}
      </main>
      <Toaster />
    </div>
  );
}
