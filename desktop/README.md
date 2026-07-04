# Knowledge Hub desktop app

`~/Applications/Knowledge Hub.app` is a real Electron app (macOS only) that
wraps the local Next.js app at `http://127.0.0.1:3777`. It boots colima,
then local Supabase, then the production Next.js server (building first if
`.next/BUILD_ID` is missing) — reusing whatever is already running, exactly
like the old shell-script shim did. Ports and logs are unchanged: app on
`http://127.0.0.1:3777`, Supabase on its usual `543xx` ports, logs at
`~/Library/Logs/KnowledgeHub.log` (append, timestamped).

## Architecture

- `desktop/electron/` is its own npm package (own `package.json`, own
  `node_modules`) with `electron` and `electron-builder` as devDependencies.
  It is **not** a dependency of the root Next.js app and is never bundled
  into it.
- `desktop/electron/src/main.js` is the Electron main process, in plain
  CommonJS (no build step). It ports the exact startup sequence from
  `launch.sh`/`stop.sh`:
  1. Show a frameless splash window immediately with a live status line
     ("Starting Docker VM…", "Starting Supabase…", "Building app…",
     "Starting server…") so launch never feels dead.
  2. Check colima (`colima status`), start it if needed.
  3. Check Supabase (`supabase status` from the repo root), run
     `supabase start` if needed.
  4. Check `http://127.0.0.1:3777` — if nothing answers: build first if
     `.next/BUILD_ID` is missing (`npm run build`), then spawn
     `npx next start -p 3777` **detached** with output appended to the log
     file, and `unref()` it so it outlives the Electron process. Poll for
     up to 180s; on timeout, show an error dialog with the log path.
  5. Close the splash, open the main window.
- The repo root's `next.config.ts` intentionally stays as-is —
  **not** `output: 'standalone'**. The app serves from the live repo
  checkout exactly like before; standalone output buys nothing for a
  single-machine tool that always runs from source and would complicate
  the dev loop (two divergent output modes to keep in sync).
- Paths are hardcoded (repo root, `supabase` binary, colima's docker
  socket), matching `launch.sh`/`stop.sh` — this is a personal,
  single-machine tool, not a redistributable app. This also sidesteps a
  real footgun: once packaged, a path derived from `__dirname` resolves
  *inside* `app.asar`, not the actual checkout on disk.
- Child processes get an explicit `PATH`
  (`/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH`) and
  `DOCKER_HOST` — a `.app` launched from Finder/Dock gets a much sparser
  environment than a Terminal shell, so this can't be left implicit.

## Why electron-builder (not electron-forge)

electron-builder was chosen over electron-forge: this is a single-platform
(macOS-only), unpacked `.app` target with ad-hoc signing, which is a ~15
line `build` key in `package.json`. electron-forge's value is its
scaffolding for multi-platform installers/updaters/templates — none of
which this app needs, since it's a thin localhost wrapper that is never
distributed and never bundles the web app it points at.

## Rebuilding the Electron app

```sh
cd desktop/electron
npm install
npx electron-builder --mac dir
```

This produces `desktop/electron/dist/mac-arm64/Knowledge Hub.app`.
electron-builder's `identity: null` is documented to ad-hoc-sign
automatically, but in practice (electron-builder 25.1.8) it just **skips
signing** and leaves Electron's original factory signature in place, which
no longer matches the modified bundle (custom `Info.plist`, icon,
`app.asar`) and fails `codesign --verify`. Explicitly re-sign after every
build:

```sh
codesign --force --deep -s - "dist/mac-arm64/Knowledge Hub.app"
xattr -cr "dist/mac-arm64/Knowledge Hub.app"
```

Then install it:

```sh
rm -rf ~/Applications/"Knowledge Hub.app"
cp -R "dist/mac-arm64/Knowledge Hub.app" ~/Applications/
```

## The old Chrome-app-mode shim (fallback)

The previous shim — a tiny `.app` bundle whose executable just `exec`'d
`launch.sh`, opening the site in a Chrome `--app=` window — has been kept
as a fallback at `~/Applications/Knowledge Hub (Chrome).app` (not deleted).
The repo's own `desktop/Knowledge Hub.app` (source of that shim) is
untouched. If the Electron app ever regresses, that fallback still works
exactly as before.

To rebuild the icon (`desktop/icon.icns`, shared by both apps): edit
`desktop/icon.svg`, re-render via `qlmanage -t -s 1024 -o . icon.svg`,
resize with `sips` into an `icon.iconset/`, then
`iconutil -c icns icon.iconset -o icon.icns`.

## Behavior: close vs quit vs "Shut Down Backend & Quit"

- **Closing the window** (red traffic light) or **Cmd-Q**: the window (or
  app) closes, but colima/Supabase/the Next.js server all keep running.
  The app stays in the Dock; clicking the Dock icon reopens the window
  instantly (this is standard macOS app behavior — no custom code needed
  beyond the default `window-all-closed`/`activate` handlers).
- **App menu → "Shut Down Backend & Quit"**: runs `desktop/stop.sh --all`
  (stopping the Next.js server, Supabase, and colima) and then quits.
  Use this when you actually want everything torn down, e.g. before a
  reboot or to free up RAM.
- `desktop/stop.sh` (no args) stops only the port-3777 server;
  `desktop/stop.sh --all` also stops Supabase and colima. Both remain the
  source of truth for "stop everything" — the menu item just shells out to
  the same script.

The standard macOS Edit menu (Cut/Copy/Paste/Undo/Select All) and Window
menu are wired up via Electron's built-in `editMenu`/`windowMenu` roles, so
keyboard shortcuts work normally inside the app.

## Known pre-existing issue: `npm run build` uses `--turbopack`

`package.json`'s `build` script is `next build --turbopack`. In this
Next.js version (15.5.20), a Turbopack production build does **not**
produce a `BUILD_ID` or `routes-manifest.json` that `next start` can read
— `next start` fails immediately with "Could not find a production build".
Both `launch.sh` and the Electron app's cold-start path call `npm run
build` when `.next/BUILD_ID` is missing, so **a genuine cold build via
either launcher will currently produce a server that won't start.** This
was hit and worked around during verification of this change (rebuilt with
plain `next build`, no `--turbopack`, to restore a working `.next`). This
is a pre-existing defect in the build tooling, not something introduced by
the Electron rewrite — fixing it (e.g. dropping `--turbopack` from the
`build` script, or confirming a newer Next.js version resolves it) is a
separate decision for the app's maintainer.

## Logs & ports (unchanged)

Ports: app on `http://127.0.0.1:3777`, Supabase on its usual `543xx`
ports. Logs: `~/Library/Logs/KnowledgeHub.log` (append, timestamped).
