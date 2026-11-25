import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient as createJsClient } from "@supabase/supabase-js";
import { cookies, headers } from "next/headers";
import type { Database } from "@/lib/database.types";

// Connection details come only from the environment, so a build can never
// silently point at the wrong project.
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const BASE = process.env.NEXT_PUBLIC_BASE_DOMAIN || "campustwin.org";

// One session across every product on the base domain (hrms.campustwin.org,
// snm.campustwin.org ...). Other hosts get a host-only cookie.
export function cookieDomainForHost(host: string | null | undefined): string | undefined {
  if (!host) return undefined;
  const h = host.split(":")[0].toLowerCase();
  return h === BASE || h.endsWith("." + BASE) ? "." + BASE : undefined;
}

// Signed-in person's client, reading the `alum` schema. Row security decides
// what they can see and change.
export async function createClient() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) throw new Error("Supabase connection is not configured");
  const cookieStore = await cookies();
  const domain = cookieDomainForHost((await headers()).get("host"));
  return createServerClient<Database, "alum">(SUPABASE_URL, SUPABASE_ANON_KEY, {
    db: { schema: "alum" },
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => cookieStore.set(name, value, domain ? { ...options, domain } : options));
        } catch {
          /* Server Component: the proxy refreshes the session instead */
        }
      },
    },
  });
}

// Server-only reader for `core` (organisation names). Never used for alumni data,
// which always goes through the signed-in person's client and row security.
export function createCoreReader() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !key) throw new Error("Supabase service key is not configured");
  return createJsClient<Database, "core">(SUPABASE_URL, key, {
    db: { schema: "core" },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
