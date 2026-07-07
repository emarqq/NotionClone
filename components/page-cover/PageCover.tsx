"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus, Loader2, MoveVertical, X } from "lucide-react";
import {
  setPageCoverAction,
  setPageCoverPositionAction,
} from "@/app/actions/pages";
import { uploadCoverImage } from "@/components/page-cover/uploadCover";

const CONTROL_BTN_CLASS =
  "flex items-center gap-1 rounded bg-white/90 px-2.5 py-1 text-xs font-medium text-neutral-700 shadow hover:bg-white disabled:opacity-60 dark:bg-neutral-900/90 dark:text-neutral-200 dark:hover:bg-neutral-900";

/**
 * Full-bleed cover banner shown above the title when `pages.cover_url` is
 * set. Hover reveals Change cover / Reposition / Remove; reposition is a
 * vertical drag that adjusts the image's `object-position` and persists via
 * `setPageCoverPositionAction` on save.
 */
export default function PageCover({
  pageId,
  coverUrl,
  coverPosition,
}: {
  pageId: string;
  coverUrl: string;
  coverPosition: number;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startY: number; startPos: number } | null>(null);

  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [position, setPosition] = useState(coverPosition);
  const [repositioning, setRepositioning] = useState(false);

  const handleFile = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      const storagePath = await uploadCoverImage(pageId, file);
      await setPageCoverAction(pageId, storagePath);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  };

  const handleRemove = async () => {
    if (!confirm("Remove cover image?")) return;
    await setPageCoverAction(pageId, null);
    router.refresh();
  };

  const onMouseDown = (e: React.MouseEvent) => {
    if (!repositioning) return;
    dragRef.current = { startY: e.clientY, startPos: position };
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (!repositioning || !dragRef.current || !containerRef.current) return;
    const { startY, startPos } = dragRef.current;
    const height = containerRef.current.clientHeight || 1;
    const deltaPercent = ((e.clientY - startY) / height) * 100;
    setPosition(Math.min(100, Math.max(0, startPos - deltaPercent)));
  };
  const onMouseUp = () => {
    dragRef.current = null;
  };

  const savePosition = async () => {
    setRepositioning(false);
    await setPageCoverPositionAction(pageId, position);
    router.refresh();
  };
  const cancelReposition = () => {
    setRepositioning(false);
    setPosition(coverPosition);
  };

  return (
    <div className="group relative w-full">
      <div
        ref={containerRef}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        className={`h-52 w-full overflow-hidden sm:h-64 ${repositioning ? "cursor-ns-resize" : ""}`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- signed URL, next/image can't optimize it */}
        <img
          src={coverUrl}
          alt=""
          draggable={false}
          className="h-full w-full select-none object-cover"
          style={{ objectPosition: `center ${position}%` }}
        />
      </div>

      {repositioning ? (
        <div className="absolute bottom-3 right-3 flex gap-1.5">
          <button
            type="button"
            onClick={cancelReposition}
            className={CONTROL_BTN_CLASS}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void savePosition()}
            className="rounded bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground shadow hover:opacity-90"
          >
            Save position
          </button>
        </div>
      ) : (
        <div className="absolute bottom-3 right-3 flex gap-1.5 opacity-0 transition-opacity group-hover:opacity-100">
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void handleFile(file);
            }}
          />
          <button
            type="button"
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
            className={CONTROL_BTN_CLASS}
          >
            {uploading ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <ImagePlus size={13} />
            )}
            Change cover
          </button>
          <button
            type="button"
            onClick={() => setRepositioning(true)}
            className={CONTROL_BTN_CLASS}
          >
            <MoveVertical size={13} />
            Reposition
          </button>
          <button
            type="button"
            onClick={() => void handleRemove()}
            className={CONTROL_BTN_CLASS}
          >
            <X size={13} />
            Remove
          </button>
        </div>
      )}
      {error && (
        <p className="absolute bottom-3 left-3 rounded bg-white/90 px-2 py-1 text-xs text-red-600 shadow dark:bg-neutral-900/90 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
