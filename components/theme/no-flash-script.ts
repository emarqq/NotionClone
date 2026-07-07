import { DEFAULT_PRIMARY_COLOR, DEFAULT_SECONDARY_COLOR } from "./constants";

/**
 * Runs synchronously in <head>, before first paint, so the persisted theme
 * applies without a flash of the default light/neutral theme. Must be plain
 * inlineable JS (no imports) since it can't load lib/theme/color.ts at this
 * point — the luminance formula is intentionally duplicated from there.
 */
export const NO_FLASH_THEME_SCRIPT = `(function() {
  try {
    var stored = localStorage.getItem("kh-theme");
    var state = stored ? JSON.parse(stored).state : null;
    var mode = (state && state.mode) || "system";
    var primary = (state && state.primaryColor) || "${DEFAULT_PRIMARY_COLOR}";
    var secondary = (state && state.secondaryColor) || "${DEFAULT_SECONDARY_COLOR}";
    var systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    var dark = mode === "dark" || (mode === "system" && systemDark);
    var root = document.documentElement;
    if (dark) root.classList.add("dark");
    root.style.setProperty("--color-primary", primary);
    root.style.setProperty("--color-secondary", secondary);
    function luminance(hex) {
      var v = hex.replace("#", "");
      var r = parseInt(v.substring(0, 2), 16) / 255;
      var g = parseInt(v.substring(2, 4), 16) / 255;
      var b = parseInt(v.substring(4, 6), 16) / 255;
      var chans = [r, g, b].map(function (c) {
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * chans[0] + 0.7152 * chans[1] + 0.0722 * chans[2];
    }
    root.style.setProperty("--color-primary-foreground", luminance(primary) > 0.179 ? "#000000" : "#ffffff");
    root.style.setProperty("--color-secondary-foreground", luminance(secondary) > 0.179 ? "#000000" : "#ffffff");
  } catch (e) {}
})();`;
