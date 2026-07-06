import { notFound } from "next/navigation";
import Editor from "@/components/editor/Editor";
import TitleInput from "@/components/editor/TitleInput";
import AttachmentsPanel from "@/components/files/AttachmentsPanel";
import PageMetaBar from "@/components/page-meta/PageMetaBar";
import ContentsPanel from "@/components/page-nav/ContentsPanel";
import SubPagesList from "@/components/page-nav/SubPagesList";
import TabSync from "@/components/tabs/TabSync";
import { getBlocks } from "@/lib/db/blocks";
import { getAncestors, getChildren, getPage, getSpaces } from "@/lib/db/pages";
import { PageIcon } from "@/lib/icons";

export const dynamic = "force-dynamic";

export default async function PageView({
  params,
}: {
  params: Promise<{ spaceSlug: string; pageId: string }>;
}) {
  const { spaceSlug, pageId } = await params;
  const page = await getPage(pageId);
  if (!page || page.is_archived) notFound();

  const [blocks, spaces, ancestors, children] = await Promise.all([
    getBlocks(pageId),
    getSpaces(),
    getAncestors(pageId),
    getChildren(pageId),
  ]);
  const parent = ancestors.length > 0 ? ancestors[ancestors.length - 1] : null;

  return (
    <>
      <TabSync pageId={page.id} spaceSlug={spaceSlug} title={page.title} />
      <PageMetaBar
        page={page}
        spaceSlug={spaceSlug}
        spaces={spaces}
        ancestors={ancestors}
      />
      <div className="mx-auto max-w-3xl px-6 py-12">
        <header className="mb-8 flex items-start gap-3">
          {page.icon && (
            <span className="mt-1 leading-[1.15]">
              <PageIcon icon={page.icon} size={36} />
            </span>
          )}
          <TitleInput pageId={page.id} initialTitle={page.title} />
        </header>
        <Editor pageId={page.id} initialBlocks={blocks} breadcrumb={page.title} />
        <SubPagesList pages={children} spaceSlug={spaceSlug} />
        <div className="mt-12">
          <AttachmentsPanel pageId={page.id} />
        </div>
      </div>
      <ContentsPanel
        page={page}
        spaceId={page.space_id}
        spaceSlug={spaceSlug}
        parent={parent}
        initialChildren={children}
      />
    </>
  );
}
