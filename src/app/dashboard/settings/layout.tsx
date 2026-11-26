import { getSession } from "@/lib/session";
import { getT } from "@/i18n/server";
import { guardTab } from "@/lib/access";
import { SettingsNav } from "@/components/settings/settings-nav";
import { settingsSections } from "./sections";

// Settings: everything an institution sets up once, in one place. Each
// section page also guards itself, so a shared link cannot open a section
// this person does not have.
export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const denied = await guardTab("/dashboard/settings");
  if (denied) return denied;
  const session = (await getSession())!;
  const { t } = await getT();
  const items = settingsSections(session).map((r) => ({ href: r.href, label: t(r.labelKey) }));
  return (
    <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
      <SettingsNav title={t("settings.title")} items={items} />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
