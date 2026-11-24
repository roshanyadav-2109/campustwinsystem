"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSession, getCurrentYear } from "@/lib/session";
import { tenantPrefixForSchool, mediaKey, presignPut, publicUrl, urlUnderPrefix } from "@/lib/r2";

// Images go straight from the poster's browser to R2 (so a large photo never
// passes through our server), landing under this institution's own topological
// prefix (schools/<slug>/announcements or universities/<uni>/campuses/<campus>/…),
// so no tenant's files mix. Only staff can post.
export type UploadTicket =
  | { ok: true; uploadUrl: string; publicUrl: string }
  | { ok: false; error: string };

export async function signAnnouncementUpload(contentType: string): Promise<UploadTicket> {
  const session = await getSession();
  if (!session?.staffId) return { ok: false, error: "Only staff can add images." };
  if (!contentType.startsWith("image/")) return { ok: false, error: "Only images can be attached." };
  const prefix = await tenantPrefixForSchool(session.schoolId);
  const ext = (contentType.split("/")[1] || "jpg").replace("jpeg", "jpg").replace("+xml", "").replace(/[^a-z0-9]/g, "") || "jpg";
  const key = mediaKey(prefix, "announcements", `${crypto.randomUUID()}.${ext}`);
  return { ok: true, uploadUrl: await presignPut(key), publicUrl: publicUrl(key) };
}

// An announcement goes either to the whole school (principal/office only) or to
// any set of sections the poster picked — several classes at once, leaving out
// whichever sections they unticked.
export async function createAnnouncement(input: {
  title: string;
  body: string;
  audience: "school" | "sections";
  sectionIds?: number[];
  imageUrl?: string | null;
}) {
  const supabase = await createClient();
  const session = await getSession();
  if (!session?.staffId) return { ok: false, error: "Not permitted" };
  const year = await getCurrentYear();

  // Only an image that was just uploaded under THIS institution's own prefix is
  // kept — a tenant can't attach another tenant's file.
  let imageUrl: string | null = null;
  if (input.imageUrl) {
    const prefix = await tenantPrefixForSchool(session.schoolId);
    if (!urlUnderPrefix(input.imageUrl, prefix)) return { ok: false, error: "That image could not be attached." };
    imageUrl = input.imageUrl;
  }

  let target: { scope: "school" | "section"; section_id: number | null; section_ids: number[] | null };
  if (input.audience === "school") {
    if (!session.isAdminScope) return { ok: false, error: "Only the principal or office can post to the whole school." };
    target = { scope: "school", section_id: null, section_ids: null };
  } else {
    const ids = [...new Set((input.sectionIds ?? []).filter((n) => Number.isInteger(n) && n > 0))];
    if (!ids.length) return { ok: false, error: "Choose at least one class or section." };
    // One section keeps the classic single-section shape; several use the list.
    target = { scope: "section", section_id: ids[0], section_ids: ids.length > 1 ? ids : null };
  }

  const { error } = await supabase.from("announcement").insert({
    title: input.title,
    body: input.body,
    scope: target.scope,
    section_id: target.section_id,
    academic_year_id: year?.id ?? null,
    created_by: session.staffId,
    // The new columns are only written when used, so a plain notice still
    // saves on a database that has not had migration 0032 yet.
    ...(target.section_ids ? { section_ids: target.section_ids } : {}),
    ...(imageUrl ? { image_url: imageUrl } : {}),
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/announcements");
  revalidatePath("/dashboard");
  return { ok: true };
}
