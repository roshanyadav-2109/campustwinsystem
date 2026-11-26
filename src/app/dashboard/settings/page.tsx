import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { settingsSections } from "./sections";

// Settings opens on its first section.
export default async function SettingsIndex() {
  const session = await getSession();
  const first = session ? settingsSections(session)[0] : undefined;
  redirect(first?.href ?? "/dashboard");
}
