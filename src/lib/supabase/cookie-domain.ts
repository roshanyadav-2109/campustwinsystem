// Share the Supabase session cookie (and the Google OAuth handshake cookie)
// across every campus subdomain of the base domain, so a login completed on the
// apex also works on name.campustwin.org. Any other host (localhost, a custom
// domain, the old vercel/neuralai host) gets an ordinary host-only cookie.
const BASE = process.env.NEXT_PUBLIC_BASE_DOMAIN || "campustwin.org";

export function cookieDomainForHost(host: string | null | undefined): string | undefined {
  if (!host) return undefined;
  const h = host.split(":")[0].toLowerCase();
  if (h === BASE || h.endsWith("." + BASE)) return "." + BASE;
  return undefined;
}
