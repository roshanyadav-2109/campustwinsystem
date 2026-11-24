import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { SCHOOL } from "@/lib/school";

// Runtime institution branding, resolved per request from the subdomain
// (name.campustwin.org -> slug "name" -> the school row). Falls back to the one
// institution on the apex/localhost, and to the build-time SCHOOL defaults if
// the database can't be read. This replaces build-time branding for the public
// pages (login, apply) and the document title; signed-in pages read their brand
// from the session instead (session.school).

const BASE = process.env.NEXT_PUBLIC_BASE_DOMAIN || "campustwin.org";

export type Brand = {
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
};

type Row = {
  slug: string; name: string; place: string | null; short_name: string | null;
  monogram: string | null; logo_url: string | null; login_image_url: string | null;
  login_video_id: string | null; primary_color: string | null;
};
const COLS = "slug, name, place, short_name, monogram, logo_url, login_image_url, login_video_id, primary_color, status";

function toBrand(r: Row): Brand {
  const name = r.name;
  const place = r.place ?? "";
  return {
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
  };
}

// The institution slug from a host, or null for the apex / localhost / an IP /
// an unrelated host (e.g. a vercel.app preview).
export function slugFromHost(host: string | null): string | null {
  if (!host) return null;
  const h = host.split(":")[0].toLowerCase();
  if (h === "localhost" || /^[0-9.]+$/.test(h)) return null;
  if (!h.endsWith("." + BASE)) return null;
  const sub = h.slice(0, -(("." + BASE).length));
  if (!sub || sub === "www") return null;
  return sub.split(".").pop() || null;
}

// The apex (campustwin.org) and any unmatched host are NOT a school — they get
// the neutral CampusTwin brand, never a fall-back to some institution.
export const CAMPUSTWIN: Brand = {
  slug: "", name: "CampusTwin", place: "", fullName: "CampusTwin",
  shortName: "CampusTwin", monogram: "CT", logo: "", loginImage: "", loginVideoId: "",
  primaryColor: "#0F6CBD",
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
export const getUniversityLanding = cache(async (): Promise<UniversityLanding | null> => {
  try {
    const host = (await headers()).get("host");
    const slug = slugFromHost(host);
    if (!slug) return null;
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
  } catch {
    return null;
  }
});

export const getBrand = cache(async (): Promise<Brand> => {
  try {
    const db = createAdminClient();
    const host = (await headers()).get("host");
    const slug = slugFromHost(host);
    if (slug) {
      const { data } = await db.from("school").select(COLS).eq("slug", slug).maybeSingle();
      if (data) return toBrand(data as Row);
    }
    // No matching school: the apex / an unknown host is NOT a school. Show the
    // neutral CampusTwin brand rather than falling back to some institution.
    return CAMPUSTWIN;
  } catch {
    // On a DB error, prefer the neutral brand over leaking a specific school.
    return CAMPUSTWIN;
  }
});
