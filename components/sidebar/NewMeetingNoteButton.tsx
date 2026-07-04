"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import clsx from "clsx";
import { createMeetingNoteAction } from "@/app/actions/meetings";

/**
 * Creates a templated meeting-note page via server action and navigates to
 * it. Used by the sidebar space headers and the space landing page.
 */
export default function NewMeetingNoteButton({
  spaceId,
  spaceSlug,
  parentPageId = null,
  title = "New meeting note",
  className,
  children,
}: {
  spaceId: string;
  spaceSlug: string;
  parentPageId?: string | null;
  title?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={isPending}
      className={clsx(className, isPending && "pointer-events-none opacity-50")}
      onClick={() => {
        startTransition(async () => {
          const page = await createMeetingNoteAction(
            spaceId,
            spaceSlug,
            parentPageId
          );
          router.push(`/${spaceSlug}/${page.id}`);
        });
      }}
    >
      {children}
    </button>
  );
}
