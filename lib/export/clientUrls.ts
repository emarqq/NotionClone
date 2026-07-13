export type ExportFormat = "markdown" | "docx" | "pdf";

/** Client-side URL for the page-export API route (`app/api/pages/[pageId]/export`). */
export function pageExportUrl(pageId: string, format: ExportFormat): string {
  return `/api/pages/${pageId}/export?format=${format}`;
}
