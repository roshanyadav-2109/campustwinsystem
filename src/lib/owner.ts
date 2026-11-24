import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// The signed-in user's email if they are a platform owner, else null. Owners are
// an allowlist (public.platform_owner) checked with the service-role client; this
// is the single gate for the company console. Cached per request.
export const getOwnerEmail = cache(async (): Promise<string | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const email = (data?.claims?.email as string | undefined)?.trim().toLowerCase();
  if (!email) return null;
  const admin = createAdminClient();
  const { data: row } = await admin.from("platform_owner").select("email").eq("email", email).maybeSingle();
  return row ? email : null;
});

// True if the given email is on the owner allowlist (used by the Google callback).
export async function isOwnerEmail(email: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin.from("platform_owner").select("email").eq("email", email.trim().toLowerCase()).maybeSingle();
  return !!data;
}
