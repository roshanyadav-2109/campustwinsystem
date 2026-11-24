import "server-only";
import { AwsClient } from "aws4fetch";
import { createAdminClient } from "@/lib/supabase/admin";

// Cloudflare R2 object storage, organised by a DEEP TOPOLOGICAL key structure so
// no tenant's files ever mix. The key prefix encodes the full org hierarchy:
//
//   standalone school:   schools/<school-slug>/<category>/<file>
//   university campus:    universities/<uni-slug>/campuses/<campus-slug>/<category>/<file>
//   university-level:     universities/<uni-slug>/<category>/<file>
//
// So a whole university = `universities/<slug>/`, one campus = that path's
// `campuses/<campus-slug>/`, and a standalone school = `schools/<slug>/`. Each is
// a clean, listable, independently-exportable/deletable prefix.
//
// Served (read) from the public custom domain with zero egress; written (PUT) via
// short-lived presigned URLs the browser uses directly.

const ACCOUNT = process.env.R2_ACCOUNT_ID || "";
const BUCKET = process.env.R2_BUCKET || "campustwin-media";
const PUBLIC_BASE = (process.env.R2_PUBLIC_BASE || "https://cdn.campustwin.org").replace(/\/+$/, "");
const ENDPOINT = `https://${ACCOUNT}.r2.cloudflarestorage.com/${BUCKET}`;

let _client: AwsClient | null = null;
function client() {
  if (!_client) {
    _client = new AwsClient({
      accessKeyId: process.env.R2_ACCESS_KEY_ID || "",
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
      service: "s3",
      region: "auto",
    });
  }
  return _client;
}

const seg = (s: string) => s.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);

// ---- Topology ----
export function schoolPrefix(schoolSlug: string, universitySlug?: string | null): string {
  return universitySlug
    ? `universities/${seg(universitySlug)}/campuses/${seg(schoolSlug)}`
    : `schools/${seg(schoolSlug)}`;
}
export function universityPrefix(universitySlug: string): string {
  return `universities/${seg(universitySlug)}`;
}

export function mediaKey(prefix: string, category: string, filename: string): string {
  return `${prefix}/${seg(category)}/${seg(filename)}`.replace(/\/+/g, "/");
}

// ---- File naming ----
// One clean extension; original filenames are never used (they carry spaces,
// unicode and sometimes personal info).
export function extFromType(contentType: string): string {
  return (contentType.split("/")[1] || "bin").toLowerCase().replace("jpeg", "jpg").replace("+xml", "").replace(/[^a-z0-9]/g, "").slice(0, 5) || "bin";
}

// Category key builders — the ONLY way files get named, so every feature drops
// into the correct, non-mixing branch of the topology:
//   announcements -> announcements/<uuid>.<ext>   (unique per post)
//   student photo -> students/<id>/photo.<ext>    (one current photo per student)
//   staff photo   -> staff/<id>/photo.<ext>       (one current photo per teacher)
//   branding      -> brand/<logo|wordmark|login>.<ext>
//   documents     -> docs/<uuid>.<ext>
// Student/staff keys use the person's STABLE id, so class promotion (a DB
// enrolment change) never moves or orphans their files.
export function announcementKey(prefix: string, contentType: string): string {
  return `${prefix}/announcements/${crypto.randomUUID()}.${extFromType(contentType)}`;
}
export function studentPhotoKey(prefix: string, studentId: number, contentType: string): string {
  return `${prefix}/students/${studentId}/photo.${extFromType(contentType)}`;
}
export function staffPhotoKey(prefix: string, staffId: number, contentType: string): string {
  return `${prefix}/staff/${staffId}/photo.${extFromType(contentType)}`;
}
export function brandKey(prefix: string, which: "logo" | "wordmark" | "login-image", contentType: string): string {
  return `${prefix}/brand/${which}.${extFromType(contentType)}`;
}
export function documentKey(prefix: string, contentType: string): string {
  return `${prefix}/docs/${crypto.randomUUID()}.${extFromType(contentType)}`;
}
export function publicUrl(key: string): string { return `${PUBLIC_BASE}/${key}`; }
export function isOwnR2Url(url: string): boolean { return url.startsWith(PUBLIC_BASE + "/"); }
// A file truly belongs to this tenant only if it sits under the tenant's prefix.
export function urlUnderPrefix(url: string, prefix: string): boolean {
  return url.startsWith(`${PUBLIC_BASE}/${prefix}/`);
}

// Resolve a school's topological prefix (its university slug, if a campus).
export async function tenantPrefixForSchool(schoolId: number): Promise<string> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("school")
    .select("slug, university:university_id(slug)")
    .eq("id", schoolId)
    .maybeSingle();
  const schoolSlug = (data as { slug?: string } | null)?.slug ?? `school-${schoolId}`;
  const uniSlug = (data as { university?: { slug: string } | null } | null)?.university?.slug ?? null;
  return schoolPrefix(schoolSlug, uniSlug);
}

// The object key behind a public URL (for deletes), or null if not one of ours.
export function keyFromUrl(url: string | null | undefined): string | null {
  if (!url || !url.startsWith(PUBLIC_BASE + "/")) return null;
  return url.slice(PUBLIC_BASE.length + 1).split("?")[0];
}

// Delete an object so storage never keeps an orphan after a photo is replaced or
// removed. No-op for a blank/foreign URL. Never throws (best-effort cleanup).
export async function deleteObject(keyOrUrl: string | null | undefined): Promise<void> {
  if (!keyOrUrl) return;
  const key = keyOrUrl.startsWith("http") ? keyFromUrl(keyOrUrl) : keyOrUrl;
  if (!key) return;
  try {
    await client().fetch(`${ENDPOINT}/${key}`, { method: "DELETE" });
  } catch { /* best-effort */ }
}

// A short-lived presigned PUT URL for a direct browser upload.
export async function presignPut(key: string, expiresSec = 300): Promise<string> {
  const u = new URL(`${ENDPOINT}/${key}`);
  u.searchParams.set("X-Amz-Expires", String(expiresSec));
  const signed = await client().sign(u.toString(), { method: "PUT", aws: { signQuery: true } });
  return signed.url;
}
