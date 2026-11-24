"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";

// Switch the central admin's active campus. current_school_id() returns this
// campus, so every page then scopes to it. The DB trigger guarantees the campus
// belongs to the admin's university, so a tampered id is rejected there too.
export async function switchCampus(formData: FormData) {
  const session = await getSession();
  if (!session?.isUniversityAdmin) redirect("/dashboard");

  const campusId = Number(formData.get("campusId"));
  if (!Number.isFinite(campusId) || !session.campuses.some((c) => c.id === campusId)) {
    redirect("/dashboard/university?error=badcampus");
  }

  const supabase = await createClient();
  const { error } = await supabase.from("profile").update({ active_campus_id: campusId }).eq("id", session.userId);
  if (error) redirect("/dashboard/university?error=switch");

  revalidatePath("/", "layout");
  redirect("/dashboard");
}
