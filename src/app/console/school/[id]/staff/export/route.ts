import { getOwnerEmail } from "@/lib/owner";
import { createAdminClient } from "@/lib/supabase/admin";
import { csvResponse } from "@/lib/console/csv";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await getOwnerEmail())) return new Response("Forbidden", { status: 403 });
  const { id } = await params;
  const schoolId = Number(id);
  const admin = createAdminClient();
  const { data: school } = await admin.from("school").select("slug").eq("id", schoolId).maybeSingle();
  if (!school) return new Response("Not found", { status: 404 });
  const { data } = await admin.from("staff").select("employee_code, full_name, role, email, phone").eq("school_id", schoolId).order("full_name").limit(5000);
  return csvResponse(
    `${school.slug}-staff-${new Date().toISOString().slice(0, 10)}.csv`,
    ["Employee code", "Name", "Role", "Email", "Phone"],
    (data ?? []).map((s) => [s.employee_code, s.full_name, s.role, s.email, s.phone]),
  );
}
