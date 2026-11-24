import { createServerClient } from "@supabase/ssr";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "@/lib/supabase/config";
import { cookies, headers } from "next/headers";
import { cookieDomainForHost } from "@/lib/supabase/cookie-domain";
import type { Database } from "@/lib/database.types";

// Server Supabase client (RSC, Server Actions, Route Handlers).
// cookies() is async in Next 16.
export async function createClient() {
  const cookieStore = await cookies();
  const domain = cookieDomainForHost((await headers()).get("host"));
  return createServerClient<Database>(
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          // In pure Server Components cookie writes throw; the proxy refreshes
          // the session, so this is safe to swallow.
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, domain ? { ...options, domain } : options),
            );
          } catch {
            /* called from a Server Component — ignore */
          }
        },
      },
    },
  );
}
