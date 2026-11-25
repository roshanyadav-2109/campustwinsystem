import { inputCls, labelCls } from "@/components/ui";

type P = { programme?: string | null; company?: string | null; job_title?: string | null; higher_studies?: string | null; city?: string | null; country?: string | null; phone?: string | null; linkedin_url?: string | null };

// What an alumnus keeps up to date about themselves.
export function ProfileFields({ v = {} }: { v?: P }) {
  const f = (id: keyof P, label: string, extra: { maxLength?: number; type?: string; placeholder?: string } = {}) => (
    <div>
      <label htmlFor={id} className={labelCls}>{label}</label>
      <input id={id} name={id} defaultValue={v[id] ?? ""} className={inputCls} maxLength={extra.maxLength} type={extra.type} placeholder={extra.placeholder} />
    </div>
  );
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {f("programme", "Course or class", { maxLength: 120 })}
      {f("company", "Where you work", { maxLength: 120 })}
      {f("job_title", "Your role", { maxLength: 120 })}
      {f("higher_studies", "Higher studies (if any)", { maxLength: 160, placeholder: "MBA, IIM Ahmedabad" })}
      {f("city", "City", { maxLength: 80 })}
      {f("country", "Country", { maxLength: 60 })}
      {f("phone", "Phone", { maxLength: 20, type: "tel" })}
      {f("linkedin_url", "LinkedIn profile link", { placeholder: "https://www.linkedin.com/in/..." })}
    </div>
  );
}
