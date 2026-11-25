import { requireSetUp } from "@/lib/context";
import { fmtDate } from "@/lib/format";
import { PageHeader, Section, Empty, inputCls, labelCls, btnPrimary, btnQuiet } from "@/components/ui";
import { ActionForm, Submit } from "@/components/action-form";
import { addPost, deletePost } from "../actions";

export const metadata = { title: "News" };

export default async function News() {
  const { db, org, isStaff } = await requireSetUp();
  const { data: posts } = await db.from("post").select("id, title, body, created_at").eq("org_id", org.id).order("created_at", { ascending: false }).limit(50);
  return (
    <div>
      <PageHeader title="News" sub="From the alumni office" />
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Section flush>
          {posts?.length ? (
            <ul className="divide-y divide-cx-line">
              {posts.map((p) => (
                <li key={p.id} className="px-5 py-4">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="text-[15.5px] font-semibold text-cx-text">{p.title}</p>
                    {isStaff && <ActionForm action={deletePost}><input type="hidden" name="id" value={p.id} /><Submit className={btnQuiet} pending="Removing">Remove</Submit></ActionForm>}
                  </div>
                  <p className="text-[12px] text-cx-faint">{fmtDate(p.created_at)}</p>
                  <p className="mt-1.5 whitespace-pre-line text-[14px] leading-6 text-cx-text-2">{p.body}</p>
                </li>
              ))}
            </ul>
          ) : <Empty>No news yet.</Empty>}
        </Section>
        {isStaff && (
          <Section title="Post news">
            <ActionForm action={addPost} reset className="space-y-3">
              <div><label htmlFor="title" className={labelCls}>Headline</label><input id="title" name="title" required maxLength={160} className={inputCls} /></div>
              <div><label htmlFor="body" className={labelCls}>News</label><textarea id="body" name="body" rows={6} required maxLength={8000} className={inputCls} /></div>
              <Submit className={btnPrimary} pending="Posting">Post</Submit>
            </ActionForm>
          </Section>
        )}
      </div>
    </div>
  );
}
