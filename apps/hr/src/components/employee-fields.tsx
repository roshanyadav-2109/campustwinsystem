import { inputCls, labelCls } from "@/components/ui";
import { EMPLOYMENT_TYPES } from "@/lib/format";

type Opt = { id: number; name: string };
type Values = {
  code?: string; full_name?: string; email?: string | null; phone?: string | null;
  department_id?: number | null; designation_id?: number | null; manager_id?: number | null;
  employment_type?: string; date_of_joining?: string | null; gender?: string | null; date_of_birth?: string | null;
};

// Fields shared by the add and edit forms.
export function EmployeeFields({ v = {}, departments, designations, managers }: { v?: Values; departments: Opt[]; designations: Opt[]; managers: Opt[] }) {
  const field = (id: string, label: string, input: React.ReactNode, hint?: string) => (
    <div>
      <label htmlFor={id} className={labelCls}>{label}</label>
      {input}
      {hint && <p className="mt-1 text-[12px] text-cx-faint">{hint}</p>}
    </div>
  );
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {field("full_name", "Full name", <input id="full_name" name="full_name" required maxLength={150} defaultValue={v.full_name ?? ""} className={inputCls} />)}
      {field("code", "Employee number", <input id="code" name="code" required maxLength={30} defaultValue={v.code ?? ""} className={inputCls} />)}
      {field("email", "Work email", <input id="email" name="email" type="email" defaultValue={v.email ?? ""} className={inputCls} />, "Their sign-in email. They can open HR once it matches their login.")}
      {field("phone", "Phone", <input id="phone" name="phone" type="tel" maxLength={20} defaultValue={v.phone ?? ""} className={inputCls} />)}
      {field("department_id", "Department", (
        <select id="department_id" name="department_id" defaultValue={v.department_id ?? ""} className={inputCls}>
          <option value="">None</option>
          {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      ))}
      {field("designation_id", "Designation", (
        <select id="designation_id" name="designation_id" defaultValue={v.designation_id ?? ""} className={inputCls}>
          <option value="">None</option>
          {designations.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      ))}
      {field("manager_id", "Reports to", (
        <select id="manager_id" name="manager_id" defaultValue={v.manager_id ?? ""} className={inputCls}>
          <option value="">Nobody</option>
          {managers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      ), "Their manager sees their attendance and approves their leave.")}
      {field("employment_type", "Employment type", (
        <select id="employment_type" name="employment_type" defaultValue={v.employment_type ?? "permanent"} className={inputCls}>
          {EMPLOYMENT_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      ))}
      {field("date_of_joining", "Date of joining", <input id="date_of_joining" name="date_of_joining" type="date" defaultValue={v.date_of_joining ?? ""} className={inputCls} />)}
      {field("date_of_birth", "Date of birth", <input id="date_of_birth" name="date_of_birth" type="date" defaultValue={v.date_of_birth ?? ""} className={inputCls} />)}
      {field("gender", "Gender", (
        <select id="gender" name="gender" defaultValue={v.gender ?? ""} className={inputCls}>
          <option value="">Not stated</option>
          <option value="female">Female</option>
          <option value="male">Male</option>
          <option value="other">Other</option>
        </select>
      ))}
    </div>
  );
}
