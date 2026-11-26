"use client";
import { createBrowserClient } from "@supabase/ssr";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "@/lib/supabase/config";
import { cookieDomainForHost } from "@/lib/supabase/cookie-domain";
import type { Database } from "@/lib/database.types";
import { institutionHeaders } from "@/lib/host-slug";

// Browser Supabase client. Uses the public anon key; RLS is the security
// boundary, so this is safe to ship to the client. On a campus subdomain the
// session cookie is scoped to the base domain so it is shared across campuses
// (consistent with the server/proxy writers and the Google OAuth flow).
export function createClient() {
  const host = typeof window !== "undefined" ? window.location.hostname : undefined;
  const domain = host ? cookieDomainForHost(host) : undefined;
  return createBrowserClient<Database>(
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    {
      // Every call says which institution's website it came from (0078).
      global: { headers: institutionHeaders(host) },
      ...(domain ? { cookieOptions: { domain } } : {}),
    },
  );
}
