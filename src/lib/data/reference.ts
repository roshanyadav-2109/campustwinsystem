import "server-only";
import { cache } from "react";
import { unstable_cache, revalidateTag } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// The school's reference lists — school years, classes and sections, subjects,
// and which subjects each class studies. They are the same for everyone, change
// only when the office edits them, and nearly every page needs them, so one copy
// is kept on the server instead of being read from the database on every page.
//
// Nothing personal or live is cached here (attendance, marks, notices, leave,
// students, sign-ins all stay live). What each person may *see* is still worked
// out per request; these lists only supply names and order.
//
// Kept for 10 minutes at most, and dropped the moment the office changes any of
// them (see refreshReference()).

export type RefYear = { id: number; name: string; is_current: boolean };
export type RefSubject = { id: number; name: string; code: string };
export type RefSection = { id: number; name: string; class: { id: number; name: string; level: number } };
export type Reference = {
  years: RefYear[];               // newest first
  currentYear: { id: number; name: string } | null;
  subjects: RefSubject[];         // by name
  sections: RefSection[];         // by name
  classSubjects: { class_id: number; subject_id: number }[];
};

const TAG = "school-reference";
const EMPTY: Reference = { years: [], currentYear: null, subjects: [], sections: [], classSubjects: [] };

// The caller's effective school: a central university admin's active campus, else
// their own school. Null when signed out. Cached per request.
export const effectiveSchoolId = cache(async (): Promise<number | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const uid = data?.claims?.sub as string | undefined;
  if (!uid) return null;
  const admin = createAdminClient();
  const { data: p } = await admin.from("profile").select("school_id, active_campus_id").eq("id", uid).maybeSingle();
  if (!p) return null;
  return (p as { school_id: number; active_campus_id: number | null }).active_campus_id ?? (p as { school_id: number }).school_id;
});

// Per-school reference lists, cached per school id (unstable_cache keys on the
// argument). Multi-tenant safe: every query is filtered by school_id.
const fetchReference = unstable_cache(
  async (schoolId: number): Promise<Reference> => {
    const db = createAdminClient();
    const [years, subjects, sections, classSubjects] = await Promise.all([
      db.from("academic_year").select("id, name, is_current").eq("school_id", schoolId).order("start_date", { ascending: false }),
      db.from("subject").select("id, name, code").eq("school_id", schoolId).order("name"),
      db.from("section").select("id, name, class:class_id(id, name, level)").eq("school_id", schoolId).order("name"),
      db.from("class_subject").select("class_id, subject_id").eq("school_id", schoolId),
    ]);
    const err = years.error ?? subjects.error ?? sections.error ?? classSubjects.error;
    if (err) throw new Error(`Could not load school lists: ${err.message}`); // never cache a failed read
    const yearList = (years.data ?? []) as RefYear[];
    const cur = yearList.find((y) => y.is_current) ?? null;
    return {
      years: yearList,
      currentYear: cur ? { id: cur.id, name: cur.name } : null,
      subjects: (subjects.data ?? []) as RefSubject[],
      sections: (sections.data ?? []) as unknown as RefSection[],
      classSubjects: classSubjects.data ?? [],
    };
  },
  ["school-reference-v2"],
  { tags: [TAG], revalidate: 600 },
);

// Signed-in callers get their own school's lists automatically; the public apply
// page passes the school id resolved from the subdomain.
export async function getReference(schoolIdOverride?: number): Promise<Reference> {
  const schoolId = schoolIdOverride ?? (await effectiveSchoolId());
  if (!schoolId) return EMPTY;
  return fetchReference(schoolId);
}

// Call after any change to school years, classes, sections, subjects or which
// subjects a class studies, so every page shows the change straight away.
export function refreshReference() {
  revalidateTag(TAG, { expire: 0 });
}
