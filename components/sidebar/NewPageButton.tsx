"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import clsx from "clsx";
import { createPageAction } from "@/app/actions/pages";

/**
 * Creates a page via server action and navigates to it.
 * Used by the sidebar space headers and the space landing page.
 */
export default function NewPageButton({
  spaceId,
  spaceSlug,
  parentPageId = null,
  title = "New page",
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
          const page = await createPageAction(spaceId, spaceSlug, parentPageId);
          router.push(`/${spaceSlug}/${page.id}?focusTitle=1`);
        });
      }}
    >
      {children}
    </button>
  );
}
