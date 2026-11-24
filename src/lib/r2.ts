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

// A short-lived presigned PUT URL for a direct browser upload.
export async function presignPut(key: string, expiresSec = 300): Promise<string> {
  const u = new URL(`${ENDPOINT}/${key}`);
  u.searchParams.set("X-Amz-Expires", String(expiresSec));
  const signed = await client().sign(u.toString(), { method: "PUT", aws: { signQuery: true } });
  return signed.url;
}
