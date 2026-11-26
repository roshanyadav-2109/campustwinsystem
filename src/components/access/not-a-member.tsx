import { createClient } from "@/lib/supabase/server";

const BASE = process.env.NEXT_PUBLIC_BASE_DOMAIN || "campustwin.org";
const ROLE: Record<string, string> = { staff: "Staff", guardian: "Parent", student: "Student" };

// Shown on an institution's website to someone signed in who does not belong
// to it: where they do belong, one link each.
export async function NotAMember({ hostSlug }: { hostSlug: string }) {
  const supabase = await createClient();
  const { data } = await supabase.rpc("my_institutions" as never);
  const mine = (data ?? []) as { school_id: number; name: string; slug: string; role: string }[];
  return (
    <main className="mx-auto max-w-lg px-6 py-16">
      <h1 className="text-[22px] font-semibold text-ink-900">You are not part of this institution</h1>
      <p className="mt-2 text-[14px] text-ink-700">Your login does not belong to {hostSlug}.{BASE}. If you should have access, ask its office to add you with this email address.</p>
      {mine.length > 0 && (
        <div className="mt-6">
          <h2 className="text-[13px] font-semibold text-ink-900">Your institutions</h2>
          <ul className="mt-2 divide-y divide-hair rounded-md border border-hair">
            {mine.map((m) => (
              <li key={`${m.school_id}-${m.role}`}>
                <a href={`https://${m.slug}.${BASE}/dashboard`} className="flex items-center justify-between px-4 py-3 text-[14px] hover:bg-panel">
                  <span className="font-medium text-ink-900">{m.name}</span>
                  <span className="text-ink-500">{ROLE[m.role] ?? m.role}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="mt-6 text-[13px]"><a href="/auth/signout" className="font-medium text-[#0F6CBD] hover:underline">Sign out</a></p>
    </main>
  );
}
