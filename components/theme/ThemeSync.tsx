"use client";

import { useEffect } from "react";
import { getContrastForeground } from "@/lib/theme/color";
import { rehydrateThemeStore, useThemeStore, type ThemeMode } from "./store";

function applyTheme(mode: ThemeMode, primaryColor: string, secondaryColor: string) {
  const root = document.documentElement;
  const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const dark = mode === "dark" || (mode === "system" && systemDark);
  root.classList.toggle("dark", dark);
  root.style.setProperty("--color-primary", primaryColor);
  root.style.setProperty("--color-primary-foreground", getContrastForeground(primaryColor));
  root.style.setProperty("--color-secondary", secondaryColor);
  root.style.setProperty("--color-secondary-foreground", getContrastForeground(secondaryColor));
}

/**
 * Applies the persisted theme to <html> and keeps it in sync with store
 * changes and OS theme changes. The layout's inline no-flash script already
 * applied these values before first paint; this takes over once React hydrates.
 */
export default function ThemeSync() {
  const mode = useThemeStore((s) => s.mode);
  const primaryColor = useThemeStore((s) => s.primaryColor);
  const secondaryColor = useThemeStore((s) => s.secondaryColor);

  useEffect(() => {
    rehydrateThemeStore();
  }, []);

  useEffect(() => {
    applyTheme(mode, primaryColor, secondaryColor);
    if (mode !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = () => applyTheme(mode, primaryColor, secondaryColor);
    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, [mode, primaryColor, secondaryColor]);

  return null;
}
