import { NextResponse, type NextRequest } from "next/server";
import { randomBytes, createHash } from "node:crypto";

const BASE = process.env.NEXT_PUBLIC_BASE_DOMAIN || "campustwin.org";

// "Continue with Google" for every Eternity product on the base domain uses ONE
// Google return address, https://<base>/auth/google/callback, which the sign-in
// service on the base domain already handles. This route starts the handshake
// the same way CampusTwin does: a random state (against forged returns) and a
// nonce (against replays) in a short-lived cookie shared across the base domain,
// together with where to come back to (this product, and the page asked for).
export async function GET(request: NextRequest) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) return NextResponse.redirect(new URL("/login?error=google_off", request.url));

  const host = (request.headers.get("host") ?? "").split(":")[0].toLowerCase();
  if (!host.endsWith("." + BASE)) return NextResponse.redirect(new URL("/login?error=google_off", request.url));

  const asked = request.nextUrl.searchParams.get("next") ?? "/home";
  const next = asked.startsWith("/") && !asked.startsWith("//") && !asked.startsWith("/\\") && !asked.startsWith("/login") ? asked : "/home";
  const state = randomBytes(24).toString("base64url");
  const nonce = randomBytes(24).toString("base64url");

  const google = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  google.searchParams.set("client_id", clientId);
  google.searchParams.set("redirect_uri", `https://${BASE}/auth/google/callback`);
  google.searchParams.set("response_type", "code");
  google.searchParams.set("scope", "openid email profile");
  google.searchParams.set("state", state);
  google.searchParams.set("nonce", createHash("sha256").update(nonce).digest("hex"));
  google.searchParams.set("prompt", "select_account");

  const res = NextResponse.redirect(google);
  res.cookies.set("g_oauth", JSON.stringify({ state, nonce, next, origin: `https://${host}` }), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/auth/google",
    maxAge: 600,
    domain: "." + BASE,
  });
  return res;
}
