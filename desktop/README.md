# Knowledge Hub desktop launcher

`launch.sh` boots colima, then local Supabase, then `next start -p 3777`
(building first if `.next` is missing), waits for an HTTP response, and
opens the app in its own Chrome app-mode window (falls back to Chromium/
Brave/Edge/default browser). Closing the window just "clicks out" —
services keep running so relaunch is instant.

Ports: app on `http://127.0.0.1:3777`, Supabase on its usual 543xx ports.
Logs: `~/Library/Logs/KnowledgeHub.log` (append, timestamped).

Stop the app server: `desktop/stop.sh`. Stop everything (Supabase +
colima too): `desktop/stop.sh --all`.

To rebuild the icon/app: edit `desktop/icon.svg`, re-render via
`qlmanage -t -s 1024 -o . icon.svg`, resize with `sips` into an
`icon.iconset/`, then `iconutil -c icns icon.iconset -o icon.icns` and
copy it into `Knowledge Hub.app/Contents/Resources/`. Re-run
`codesign --force --deep -s - "Knowledge Hub.app" && xattr -cr "Knowledge Hub.app"`,
then re-copy the whole bundle to `~/Applications/`.
