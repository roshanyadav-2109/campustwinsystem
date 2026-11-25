import "server-only";
import { createClient as createJs } from "@supabase/supabase-js";

// Server-only access for the two public pages (help page and tracking link).
// Every query here is scoped to one organisation's public code or one ticket's
// unguessable token; nothing else is ever read or written through it.
export function publicDb() {
  return createJs(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
    db: { schema: "desk" },
  });
}

export const isCode = (s: string) => /^[a-z0-9]{6,20}$/.test(s);
export const isToken = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s);
