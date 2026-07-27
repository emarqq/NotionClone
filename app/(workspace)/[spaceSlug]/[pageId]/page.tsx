import { notFound } from "next/navigation";
import Backlinks from "@/components/backlinks/Backlinks";
import DatabaseTableView from "@/components/database/DatabaseTableView";
import Editor from "@/components/editor/Editor";
import TitleInput from "@/components/editor/TitleInput";
import AttachmentsPanel from "@/components/files/AttachmentsPanel";
import PageCover from "@/components/page-cover/PageCover";
import PageCoverControl from "@/components/page-cover/PageCoverControl";
import PageIconControl from "@/components/page-cover/PageIconControl";
import PageMetaBar from "@/components/page-meta/PageMetaBar";
import ContentsPanel from "@/components/page-nav/ContentsPanel";
import SubPagesList from "@/components/page-nav/SubPagesList";
import TabSync from "@/components/tabs/TabSync";
import { getBlocks } from "@/lib/db/blocks";
import {
  getDatabaseRows,
  getOptionsForDatabase,
  getProperties,
  getValuesForRows,
  getViews,
} from "@/lib/db/databases";
import { getSignedUrl } from "@/lib/db/files";
import { getAncestors, getChildren, getPage, getSpaces } from "@/lib/db/pages";

export const dynamic = "force-dynamic";

export default async function PageView({
  params,
}: {
  params: Promise<{ spaceSlug: string; pageId: string }>;
}) {
  const { spaceSlug, pageId } = await params;
  const page = await getPage(pageId);
  if (!page || page.is_archived) notFound();

  const [blocks, spaces, ancestors, children, coverUrl] = await Promise.all([
    getBlocks(pageId),
    getSpaces(),
    getAncestors(pageId),
    getChildren(pageId),
    page.cover_url ? getSignedUrl(page.cover_url).catch(() => null) : null,
  ]);
  const parent = ancestors.length > 0 ? ancestors[ancestors.length - 1] : null;

  if (page.is_database) {
    const [properties, rows, optionsByProperty] = await Promise.all([
      getProperties(pageId),
      getDatabaseRows(pageId),
      getOptionsForDatabase(pageId),
      // Not rendered this phase beyond proving it loads (no view switcher yet).
      getViews(pageId),
    ]);
    const valuesByRow = await getValuesForRows(rows.map((r) => r.id));

    return (
      <>
        <TabSync pageId={page.id} spaceSlug={spaceSlug} title={page.title} />
        <PageMetaBar
          page={page}
          spaceSlug={spaceSlug}
          spaces={spaces}
          ancestors={ancestors}
        />
        {coverUrl && (
          <PageCover
            pageId={page.id}
            coverUrl={coverUrl}
            coverPosition={page.cover_position}
          />
        )}
        <div className="mx-auto max-w-5xl px-6 py-12">
          <header className="mb-8">
            {(!page.icon || !page.cover_url) && (
              <div className="mb-1 flex items-center gap-1">
                {!page.icon && <PageIconControl pageId={page.id} icon={null} />}
                {!page.cover_url && <PageCoverControl pageId={page.id} />}
              </div>
            )}
            <div className="flex items-start gap-3">
              {page.icon && <PageIconControl pageId={page.id} icon={page.icon} />}
              <TitleInput pageId={page.id} initialTitle={page.title} />
            </div>
          </header>
          <DatabaseTableView
            databasePageId={page.id}
            spaceSlug={spaceSlug}
            properties={properties}
            optionsByProperty={optionsByProperty}
            rows={rows}
            valuesByRow={valuesByRow}
          />
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
          hideSubPages
        />
      </>
    );
  }

  return (
    <>
      <TabSync pageId={page.id} spaceSlug={spaceSlug} title={page.title} />
      <PageMetaBar
        page={page}
        spaceSlug={spaceSlug}
        spaces={spaces}
        ancestors={ancestors}
      />
      {coverUrl && (
        <PageCover
          pageId={page.id}
          coverUrl={coverUrl}
          coverPosition={page.cover_position}
        />
      )}
      <div className="mx-auto max-w-3xl px-6 py-12">
        <header className="mb-8">
          {(!page.icon || !page.cover_url) && (
            <div className="mb-1 flex items-center gap-1">
              {!page.icon && <PageIconControl pageId={page.id} icon={null} />}
              {!page.cover_url && <PageCoverControl pageId={page.id} />}
            </div>
          )}
          <div className="flex items-start gap-3">
            {page.icon && <PageIconControl pageId={page.id} icon={page.icon} />}
            <TitleInput pageId={page.id} initialTitle={page.title} />
          </div>
        </header>
        <Editor pageId={page.id} initialBlocks={blocks} breadcrumb={page.title} />
        <SubPagesList pages={children} spaceSlug={spaceSlug} />
        <Backlinks pageId={page.id} />
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
