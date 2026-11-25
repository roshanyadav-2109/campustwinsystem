import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Next 16 `proxy` (formerly middleware): refreshes the session cookie on every
// request and sends signed-out visitors to the sign-in page.
const PUBLIC = ["/login", "/auth", "/help", "/t"];
const BASE = process.env.NEXT_PUBLIC_BASE_DOMAIN || "campustwin.org";

function cookieDomain(host: string | null): string | undefined {
  const h = (host ?? "").split(":")[0].toLowerCase();
  return h === BASE || h.endsWith("." + BASE) ? "." + BASE : undefined;
}

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const domain = cookieDomain(request.headers.get("host"));

  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "", {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, domain ? { ...options, domain } : options));
      },
    },
  });

  // Nothing may run between creating the client and getClaims().
  const { data } = await supabase.auth.getClaims();
  const signedIn = !!data?.claims;
  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC.some((p) => path === p || path.startsWith(p + "/"));

  if (!signedIn && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    if (path !== "/") url.searchParams.set("next", path + request.nextUrl.search);
    return NextResponse.redirect(url);
  }
  if (signedIn && path === "/login") {
    return NextResponse.redirect(new URL("/home", request.url));
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
