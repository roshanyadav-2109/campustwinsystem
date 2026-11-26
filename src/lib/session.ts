import { cache } from "react";
import { editionOf, isHigherEd, type Edition } from "@/core/edition";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/database.types";
import { getReference } from "@/lib/data/reference";

export type StaffRole = Database["public"]["Enums"]["staff_role"];
export type ProfileRole = Database["public"]["Enums"]["profile_role"];
export type NavRole = "student" | "guardian" | "subject_teacher" | "class_teacher" | "principal" | "office" | "transport";

export type Session = {
  userId: string;
  role: ProfileRole;
  fullName: string;
  locale: string;
  schoolId: number;
  staffId: number | null;
  guardianId: number | null;
  studentId: number | null;
  staffRole: StaffRole | null;
  // effective role for labels (from staff.role)
  effectiveRole: StaffRole | "student" | "guardian";
  isAdminScope: boolean; // principal or office
  isClassTeacher: boolean; // holds a class-teacher allotment this year (dynamic)
  // role used to build nav/quick-links: a staff member who class-teaches a
  // section is treated as class_teacher regardless of their static staff.role.
  navRole: NavRole;
  // The institution's registry: branding + which paid modules are switched on.
  school: SchoolBrand;
  // Multi-campus: set when this profile is a central university admin. The admin
  // works inside one "active" campus at a time (schoolId above already reflects
  // it, because current_school_id() returns the active campus), and can switch
  // between the university's campuses or see the cross-campus roll-up.
  isUniversityAdmin: boolean;
  university: UniversityBrand | null;
  activeCampusId: number | null;
  campuses: CampusLite[];
};

export type UniversityBrand = {
  id: number;
  name: string;
  slug: string;
  shortName: string | null;
  logoUrl: string | null;
  primaryColor: string;
};
export type CampusLite = {
  id: number;
  name: string;
  slug: string;
  status: string;
  students: number;
  staff: number;
};

export type SchoolModules = Record<string, boolean>;
export type SchoolBrand = {
  slug: string;
  name: string;
  shortName: string | null;
  place: string | null;
  monogram: string | null;
  logoUrl: string | null;
  loginImageUrl: string | null;
  loginVideoId: string | null;
  primaryColor: string;
  modules: SchoolModules;
  status: string;
  /** School, college or university: decides menus, words and rules. */
  edition: Edition;
  /** College or university campus: higher-education features apply. */
  higherEd: boolean;
};

// Load the signed-in user's profile (RLS: self-read). Returns null if signed out.
// Cached per request so the profile query runs once even though layout, page and
// data helpers all ask for the session. The identity comes from getClaims(),
// which verifies the JWT locally against the cached signing key — no auth-server
// round trip (the proxy has already refreshed the cookie if it had expired).
export const getSession = cache(async (): Promise<Session | null> => {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;
  const userId = claims?.sub;
  if (!userId) return null;
  const user = { id: userId };

  // The profile and the current year do not depend on each other, and the year
  // is wanted by nearly every page anyway (getCurrentYear caches it per request),
  // so fetch them together rather than one after the other.
  const [{ data }, year] = await Promise.all([
    supabase
      .from("profile")
      .select("id, role, full_name, locale, school_id, staff_id, guardian_id, student_id, university_id, active_campus_id, school:school_id(slug, name, short_name, place, monogram, logo_url, login_image_url, login_video_id, primary_color, modules, status, institution_type, university_id), staff:staff_id(role, email, teacher_allotment(academic_year_id, is_class_teacher)), guardian:guardian_id(email), student:student_id(email)")
      .eq("id", user.id)
      .single(),
    getCurrentYear(),
  ]);
  if (!data) return null;

  // Google sign-in follows the email on the school record: once the office
  // changes or removes it, a Google login stops working straight away.
  const providers = (claims?.app_metadata as { providers?: string[] } | undefined)?.providers ?? [];
  if (providers.includes("google")) {
    const recordEmail =
      (data.staff as { email: string | null } | null)?.email ??
      (data.guardian as { email: string | null } | null)?.email ??
      (data.student as { email: string | null } | null)?.email ?? null;
    const signedInAs = typeof claims?.email === "string" ? claims.email : "";
    if (!recordEmail || recordEmail.trim().toLowerCase() !== signedInAs.trim().toLowerCase()) return null;
  }

  const staffRole = (data.staff as { role: StaffRole } | null)?.role ?? null;
  const effectiveRole: Session["effectiveRole"] =
    data.role === "staff" ? (staffRole ?? "office") : data.role;

  // Is this staff member a class teacher of any section in the current year?
  // Their allotments come with the profile, so this costs no extra trip.
  const allots = (data.staff as { teacher_allotment?: { academic_year_id: number; is_class_teacher: boolean }[] } | null)?.teacher_allotment ?? [];
  const isClassTeacher = !!year && allots.some((a) => a.is_class_teacher && a.academic_year_id === year.id);

  const navRole: NavRole = isClassTeacher ? "class_teacher" : (effectiveRole as NavRole);

  const sc = data.school as unknown as {
    slug: string; name: string; short_name: string | null; place: string | null; monogram: string | null;
    logo_url: string | null; login_image_url: string | null; login_video_id: string | null;
    primary_color: string; modules: SchoolModules | null; status: string;
    institution_type?: string | null; university_id?: number | null;
  } | null;
  let school: SchoolBrand = {
    slug: sc?.slug ?? "",
    name: sc?.name ?? "",
    shortName: sc?.short_name ?? null,
    place: sc?.place ?? null,
    monogram: sc?.monogram ?? null,
    logoUrl: sc?.logo_url ?? null,
    loginImageUrl: sc?.login_image_url ?? null,
    loginVideoId: sc?.login_video_id ?? null,
    primaryColor: sc?.primary_color ?? "#0F6CBD",
    modules: (sc?.modules as SchoolModules) ?? {},
    status: sc?.status ?? "active",
    edition: editionOf({ institution_type: sc?.institution_type, university_id: sc?.university_id }),
    higherEd: isHigherEd(editionOf({ institution_type: sc?.institution_type, university_id: sc?.university_id })),
  };

  const universityId = (data as { university_id: number | null }).university_id ?? null;
  const activeCampusId = (data as { active_campus_id: number | null }).active_campus_id ?? null;

  // A central admin working inside a campus: both the data scope (current_school_id
  // = active campus) and the displayed brand follow that campus, not their home
  // school. Fetch the active campus's brand to keep the shell consistent.
  if (activeCampusId && activeCampusId !== data.school_id) {
    const { data: ac } = await supabase
      .from("school")
      .select("slug, name, short_name, place, monogram, logo_url, login_image_url, login_video_id, primary_color, modules, status, institution_type, university_id")
      .eq("id", activeCampusId)
      .maybeSingle();
    const a = ac as unknown as typeof sc;
    if (a) {
      school = {
        slug: a.slug, name: a.name, shortName: a.short_name, place: a.place, monogram: a.monogram,
        logoUrl: a.logo_url, loginImageUrl: a.login_image_url, loginVideoId: a.login_video_id,
        primaryColor: a.primary_color ?? "#0F6CBD", modules: (a.modules as SchoolModules) ?? {}, status: a.status ?? "active",
        edition: editionOf(a),
        higherEd: isHigherEd(editionOf(a)),
      };
    }
  }

  // Central university admin: load the university brand and the campus list
  // (via the SECURITY DEFINER roll-up, which returns all of this university's
  // campuses even though normal RLS only exposes the active one).
  let university: UniversityBrand | null = null;
  let campuses: CampusLite[] = [];
  if (universityId) {
    const [{ data: uni }, { data: rollup }] = await Promise.all([
      supabase.from("university").select("id, name, slug, short_name, logo_url, primary_color").eq("id", universityId).maybeSingle(),
      supabase.rpc("university_overview"),
    ]);
    if (uni) {
      university = {
        id: uni.id,
        name: uni.name,
        slug: uni.slug,
        shortName: uni.short_name ?? null,
        logoUrl: uni.logo_url ?? null,
        primaryColor: uni.primary_color ?? "#0F6CBD",
      };
    }
    campuses = ((rollup as { campus_id: number; campus_name: string; slug: string; status: string; students: number; staff: number }[] | null) ?? [])
      .map((c) => ({ id: c.campus_id, name: c.campus_name, slug: c.slug, status: c.status, students: Number(c.students), staff: Number(c.staff) }));
  }

  return {
    userId: data.id,
    role: data.role,
    fullName: data.full_name,
    locale: data.locale,
    schoolId: activeCampusId ?? data.school_id,
    staffId: data.staff_id,
    guardianId: data.guardian_id,
    studentId: data.student_id,
    staffRole,
    effectiveRole,
    isAdminScope: staffRole === "principal" || staffRole === "office",
    isClassTeacher,
    navRole,
    school,
    isUniversityAdmin: !!university,
    university,
    activeCampusId,
    campuses,
  };
});

// A student's identity card: gender, roll no, class-section label (e.g. "VIII-A")
// and the section's class teacher. Cached per request. Null if not enrolled.
export type Gender = Database["public"]["Enums"]["gender_type"];
export type StudentCard = { gender: Gender | null; roll: number | null; classSection: string | null; classTeacher: string | null };
export const getStudentCard = cache(async (studentId: number): Promise<StudentCard | null> => {
  const supabase = await createClient();
  const year = await getCurrentYear();
  if (!year) return null;
  const { data: enr } = await supabase
    .from("student_enrollment")
    .select("roll_no, section_id, section:section_id(name, class:class_id(name)), student:student_id(gender)")
    .eq("student_id", studentId)
    .eq("academic_year_id", year.id)
    .single();
  if (!enr) return null;
  const sec = enr.section as unknown as { name: string; class: { name: string } | null } | null;
  const classSection = sec ? (sec.class ? `${sec.class.name}-${sec.name}` : sec.name) : null;
  const gender = (enr.student as unknown as { gender: Gender | null } | null)?.gender ?? null;

  let classTeacher: string | null = null;
  if (enr.section_id) {
    const { data: ct } = await supabase
      .from("teacher_allotment")
      .select("staff:staff_id(full_name)")
      .eq("section_id", enr.section_id)
      .eq("academic_year_id", year.id)
      .eq("is_class_teacher", true)
      .limit(1)
      .maybeSingle();
    classTeacher = (ct?.staff as unknown as { full_name: string } | null)?.full_name ?? null;
  }
  return { gender, roll: enr.roll_no, classSection, classTeacher };
});

// Current academic year — from the shared reference copy (no database trip).
export const getCurrentYear = cache(async () => (await getReference()).currentYear);
