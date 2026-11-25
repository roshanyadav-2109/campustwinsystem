import { notFound } from "next/navigation";
import { requireSetUp } from "@/lib/context";
import { PageHeader, Section, btnPrimary } from "@/components/ui";
import { ActionForm, Submit } from "@/components/action-form";
import { ArticleFields } from "@/components/article-fields";
import { saveArticle } from "../../actions";

export const metadata = { title: "Article" };

export default async function Article({ params }: { params: Promise<{ id: string }> }) {
  const { db, org } = await requireSetUp();
  const { id: raw } = await params;
  if (!/^\d+$/.test(raw)) notFound();
  const [{ data: a }, { data: cats }] = await Promise.all([
    db.from("article").select("*").eq("org_id", org.id).eq("id", Number(raw)).maybeSingle(),
    db.from("category").select("id, name").eq("org_id", org.id).eq("active", true).order("name"),
  ]);
  if (!a) notFound();
  return (
    <div>
      <PageHeader title={a.title} sub={a.published ? "On the help page" : "Hidden"} />
      <div className="max-w-[760px]">
        <Section>
          <ActionForm action={saveArticle} className="space-y-3">
            <input type="hidden" name="id" value={a.id} />
            <ArticleFields v={a} cats={cats ?? []} />
            <Submit className={btnPrimary}>Save</Submit>
          </ActionForm>
        </Section>
      </div>
    </div>
  );
}
