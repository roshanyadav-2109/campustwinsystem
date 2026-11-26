import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { unstable_cache, revalidateTag } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { SCHOOL } from "@/lib/school";
import { slugFromHost } from "@/lib/host-slug";

// Branding is the same for every visitor and changes only when the office/console
// edits it, so it is cached across requests (not just per request) to avoid a DB
// round-trip on every public page hit. Dropped on edit via refreshBrand().
export const BRAND_TAG = "brand";

// Runtime institution branding, resolved per request from the subdomain
// (name.campustwin.org -> slug "name" -> the school row). Falls back to the one
// institution on the apex/localhost, and to the build-time SCHOOL defaults if
// the database can't be read. This replaces build-time branding for the public
// pages (login, apply) and the document title; signed-in pages read their brand
// from the session instead (session.school).

const BASE = process.env.NEXT_PUBLIC_BASE_DOMAIN || "campustwin.org";

export type Brand = {
  schoolId: number | null;
  slug: string;
  name: string;
  place: string;
  fullName: string;
  shortName: string;
  monogram: string;
  logo: string;
  loginImage: string;
  loginVideoId: string;
  primaryColor: string;
  status: string;
};

type Row = {
  id: number; slug: string; name: string; place: string | null; short_name: string | null;
  monogram: string | null; logo_url: string | null; login_image_url: string | null;
  login_video_id: string | null; primary_color: string | null; status: string | null;
};
const COLS = "id, slug, name, place, short_name, monogram, logo_url, login_image_url, login_video_id, primary_color, status";

function toBrand(r: Row): Brand {
  const name = r.name;
  const place = r.place ?? "";
  return {
    schoolId: r.id,
    slug: r.slug,
    name,
    place,
    fullName: place ? `${name}, ${place}` : name,
    shortName: (r.short_name && r.short_name.trim()) || name,
    monogram: ((r.monogram && r.monogram.trim()) || name).slice(0, 2).toUpperCase(),
    logo: (r.logo_url && r.logo_url.trim()) || SCHOOL.logo,
    loginImage: (r.login_image_url && r.login_image_url.trim()) || "",
    loginVideoId: (r.login_video_id && r.login_video_id.trim()) || SCHOOL.loginVideoId,
    primaryColor: (r.primary_color && r.primary_color.trim()) || "#0F6CBD",
    status: r.status ?? "active",
  };
}

// The institution slug from a host, or null for the apex / localhost / an IP /
// an unrelated host (e.g. a vercel.app preview).
export { slugFromHost };

// The apex (campustwin.org) and any unmatched host are NOT a school — they get
// the neutral CampusTwin brand, never a fall-back to some institution.
export const CAMPUSTWIN: Brand = {
  schoolId: null, slug: "", name: "CampusTwin", place: "", fullName: "CampusTwin",
  shortName: "CampusTwin", monogram: "CT", logo: "", loginImage: "", loginVideoId: "",
  primaryColor: "#0F6CBD", status: "active",
};

export type UniversityLanding = {
  id: number;
  name: string;
  slug: string;
  shortName: string | null;
  logo: string;
  primaryColor: string;
  campuses: { id: number; name: string; slug: string; place: string | null }[];
};

// If the current host's slug is a UNIVERSITY (not a campus/school), resolve it and
// its campuses for the public landing page. Null otherwise. Uses the admin client
// (branding is public), so it works signed-out.
const universityLandingBySlug = unstable_cache(
  async (slug: string): Promise<UniversityLanding | null> => {
    const db = createAdminClient();
    const { data: uni } = await db
      .from("university")
      .select("id, name, slug, short_name, logo_url, primary_color")
      .eq("slug", slug)
      .maybeSingle();
    if (!uni) return null;
    const { data: campuses } = await db
      .from("school")
      .select("id, name, slug, place")
      .eq("university_id", uni.id)
      .eq("status", "active")
      .order("name");
    return {
      id: uni.id,
      name: uni.name,
      slug: uni.slug,
      shortName: uni.short_name,
      logo: (uni.logo_url && uni.logo_url.trim()) || SCHOOL.logo,
      primaryColor: (uni.primary_color && uni.primary_color.trim()) || "#0F6CBD",
      campuses: (campuses ?? []).map((c) => ({ id: c.id, name: c.name, slug: c.slug, place: c.place })),
    };
  },
  ["brand-university-by-slug-v1"],
  { tags: [BRAND_TAG], revalidate: 600 },
);

export const getUniversityLanding = cache(async (): Promise<UniversityLanding | null> => {
  try {
    const slug = slugFromHost((await headers()).get("host"));
    if (!slug) return null;
    return await universityLandingBySlug(slug);
  } catch {
    return null;
  }
});

// Cached per slug across requests (10 min, or until a console edit drops it).
const schoolRowBySlug = unstable_cache(
  async (slug: string): Promise<Row | null> => {
    const db = createAdminClient();
    const { data } = await db.from("school").select(COLS).eq("slug", slug).maybeSingle();
    return (data as Row) ?? null;
  },
  ["brand-school-by-slug-v1"],
  { tags: [BRAND_TAG], revalidate: 600 },
);

export const getBrand = cache(async (): Promise<Brand> => {
  try {
    const slug = slugFromHost((await headers()).get("host"));
    if (slug) {
      const row = await schoolRowBySlug(slug);
      if (row) return toBrand(row);
    }
    // No matching school: the apex / an unknown host is NOT a school. Show the
    // neutral CampusTwin brand rather than falling back to some institution.
    return CAMPUSTWIN;
  } catch {
    // On a DB error, prefer the neutral brand over leaking a specific school.
    return CAMPUSTWIN;
  }
});

// Drop the branding cache so a console/office edit shows immediately.
export function refreshBrand() {
  revalidateTag(BRAND_TAG, { expire: 0 });
}
