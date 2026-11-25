import { createClient } from "@/lib/supabase";
import { btnGhost } from "@/components/ui";

export const metadata = { title: "No access" };

export default async function NoAccess() {
  const db = await createClient();
  const { data } = await db.auth.getClaims();
  const email = (data?.claims?.email as string | undefined) ?? null;
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-12 items-center bg-cx-bar px-4 text-white">
        <span className="text-[15px] font-semibold">Eternity</span>
        <span className="ml-2 text-[15px] text-white/70">Finance</span>
      </header>
      <main className="mx-auto mt-[12vh] w-full max-w-[460px] px-4">
        <h1 className="text-[22px] font-semibold text-cx-text">No organisation to open</h1>
        <p className="mt-2 text-[14px] leading-6 text-cx-text-2">
          {email ? <>You are signed in as <b className="font-medium text-cx-text">{email}</b>, </> : "You are signed in, "}
          but no organisation using Eternity Finance has given you access. Ask your accounts team to add you with this email.
        </p>
        <form action="/auth/signout" method="post" className="mt-5">
          <button className={btnGhost}>Sign in with another account</button>
        </form>
      </main>
    </div>
  );
}
