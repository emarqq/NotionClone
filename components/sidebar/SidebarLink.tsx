"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import clsx from "clsx";

/**
 * Flat sidebar row (Home / Favorites / Recents): icon + label link with the
 * same styling and active highlight as page tree rows.
 */
export default function SidebarLink({
  href,
  label,
  icon,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
}) {
  const pathname = usePathname();
  const isActive = pathname === href;

  return (
    <Link
      href={href}
      className={clsx(
        "flex items-center gap-1.5 rounded-md px-2 py-1 text-sm",
        isActive
          ? "bg-secondary/10 font-medium text-neutral-900 dark:bg-secondary/15 dark:text-neutral-100"
          : "text-neutral-700 hover:bg-neutral-200/60 dark:text-neutral-300 dark:hover:bg-neutral-800/70"
      )}
    >
      <span className="flex w-4 shrink-0 items-center justify-center">
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </Link>
  );
}
