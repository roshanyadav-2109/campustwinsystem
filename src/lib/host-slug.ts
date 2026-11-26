// The institution a website address belongs to: "greenfield" for
// greenfield.campustwin.org (or a campus under a university host). Null for
// the apex, localhost and other hosts. Safe in the browser and on the server.
const BASE = process.env.NEXT_PUBLIC_BASE_DOMAIN || "campustwin.org";

export function slugFromHost(host: string | null | undefined): string | null {
  if (!host) return null;
  const h = host.split(":")[0].toLowerCase();
  if (h === "localhost" || /^[0-9.]+$/.test(h)) return null;
  if (!h.endsWith("." + BASE)) return null;
  const sub = h.slice(0, -(("." + BASE).length));
  if (!sub || sub === "www") return null;
  return sub.split(".").pop() || null;
}

/** The header every database call carries, so the database acts as the
 *  person's membership at this institution (see migration 0078). */
export const INSTITUTION_HEADER = "x-campustwin-school";
export const institutionHeaders = (host: string | null | undefined): Record<string, string> => {
  const slug = slugFromHost(host);
  return slug && slug !== "console" ? { [INSTITUTION_HEADER]: slug } : {};
};
