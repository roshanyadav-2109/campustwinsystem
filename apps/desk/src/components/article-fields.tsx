import { inputCls, labelCls } from "@/components/ui";

type A = { title?: string; body?: string; category_id?: number | null; published?: boolean };

export function ArticleFields({ v = {}, cats }: { v?: A; cats: { id: number; name: string }[] }) {
  return (
    <div className="space-y-3">
      <div><label htmlFor="title" className={labelCls}>Question or title</label><input id="title" name="title" required maxLength={200} defaultValue={v.title ?? ""} placeholder="How do I download my fee receipt?" className={inputCls} /></div>
      <div>
        <label htmlFor="category_id" className={labelCls}>About</label>
        <select id="category_id" name="category_id" defaultValue={v.category_id ?? ""} className={inputCls}>
          <option value="">General</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <div><label htmlFor="body" className={labelCls}>Answer</label><textarea id="body" name="body" required rows={8} maxLength={20000} defaultValue={v.body ?? ""} className={inputCls} /></div>
      <label className="flex items-center gap-2 text-[13.5px] text-cx-text-2"><input type="checkbox" name="published" defaultChecked={v.published ?? true} className="h-4 w-4 accent-cx-text" /> Show on the public help page</label>
    </div>
  );
}
