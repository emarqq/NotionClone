"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Image as ImageIcon, Loader2 } from "lucide-react";
import { setPageCoverAction } from "@/app/actions/pages";
import { uploadCoverImage } from "@/components/page-cover/uploadCover";

/** Ghost "Add cover" affordance shown above the title when no cover is set. */
export default function PageCoverControl({ pageId }: { pageId: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div>
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
        className="flex items-center gap-1.5 rounded px-1.5 py-1 text-xs text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 disabled:opacity-60 dark:text-neutral-500 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
      >
        {uploading ? (
          <Loader2 size={14} className="animate-spin" />
        ) : (
          <ImageIcon size={14} />
        )}
        Add cover
      </button>
      {error && (
        <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}
