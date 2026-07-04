import { notFound } from "next/navigation";
import Editor from "@/components/editor/Editor";
import OutlinePanel from "@/components/editor/OutlinePanel";
import TitleInput from "@/components/editor/TitleInput";
import AttachmentsPanel from "@/components/files/AttachmentsPanel";
import PageMetaBar from "@/components/page-meta/PageMetaBar";
import TabSync from "@/components/tabs/TabSync";
import { getBlocks } from "@/lib/db/blocks";
import { getPage, getSpaces } from "@/lib/db/pages";

export const dynamic = "force-dynamic";

export default async function PageView({
  params,
}: {
  params: Promise<{ spaceSlug: string; pageId: string }>;
}) {
  const { spaceSlug, pageId } = await params;
  const page = await getPage(pageId);
  if (!page || page.is_archived) notFound();

  const [blocks, spaces] = await Promise.all([getBlocks(pageId), getSpaces()]);

  return (
    <>
      <TabSync pageId={page.id} spaceSlug={spaceSlug} title={page.title} />
      <PageMetaBar page={page} spaceSlug={spaceSlug} spaces={spaces} />
      <div className="mx-auto max-w-3xl px-6 py-12">
        <header className="mb-8 flex items-start gap-3">
          {page.icon && (
            <span className="text-4xl leading-[1.15]" aria-hidden>
              {page.icon}
            </span>
          )}
          <TitleInput pageId={page.id} initialTitle={page.title} />
        </header>
        <Editor pageId={page.id} initialBlocks={blocks} breadcrumb={page.title} />
        <div className="mt-12">
          <AttachmentsPanel pageId={page.id} />
        </div>
      </div>
      <OutlinePanel pageId={page.id} />
    </>
  );
}
