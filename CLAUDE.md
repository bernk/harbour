# Vancouver Harbour Anchorages

Single-user map app for marking anchorages and pick-up/drop-off locations around
Vancouver Harbour as labeled circles. No accounts, no backend — all data lives in
on-device storage. Two implementations exist side by side (see branches below).

## Repo layout

- `main` branch — static web app (root of repo): `index.html`, `style.css`, `app.js`
- `react-native-app` branch — Expo/React Native iOS app under `mobile/`

These are independent implementations of the same spec, not build artifacts of each
other. Changes to one do not need to be mirrored to the other unless asked.

## Web app (`main`)

- Plain HTML/CSS/vanilla JS, no build step, no framework.
- Map: Leaflet + CartoDB Positron tiles (free, no API key).
- Persistence: `localStorage`, keys `vancouver-anchorages-markers` (marker array) and
  `vancouver-anchorages-view` (last map center/zoom).
- Marker shape: `{ id, label, category: "anchorage"|"pickupDropoff", centerLat, centerLng,
  radiusMeters, createdAt }`.
- Radius clamped `MIN_RADIUS=10`–`MAX_RADIUS=1000`, `DEFAULT_RADIUS=350` (tuned by user,
  don't revert to the original spec's 2000/150 defaults).
- View Mode (default, read-only + geolocation dot) vs Edit Mode (draw/move/resize/
  rename/delete circles), toggled top-right. Custom drag-to-move / drag-to-resize
  implemented by hand with Leaflet mouse events — no Leaflet.draw/Geomen plugin.
- Local dev: `.claude/launch.json` has a `static` config (`python3 -m http.server 4173`)
  for use with the Preview tool.
- **Geolocation requires HTTPS or `localhost`** — plain LAN HTTP won't get the
  current-location dot working on a phone.

## Mobile app (`react-native-app` branch, `mobile/`)

- Expo (SDK 57) + `react-native-maps` (Apple Maps provider, no API key) + `expo-location`
  + `@react-native-async-storage/async-storage` + `@react-native-community/slider`.
- Full native rebuild (user's explicit choice over a WebView wrapper) — draw/move/
  resize/label/delete reimplemented with RN Marker `draggable`/`onDrag`/`onDragEnd` and
  a haversine-based resize handle, not a port of the Leaflet interaction code.
- Same marker JSON shape and same radius defaults as the web app, for parity.
- Source split: `MapScreen.js` (all map/mode logic), `MarkerFormModal.js`,
  `ConfirmModal.js`, `MarkerLabel.js`, `ResizeHandle.js`, `storage.js`, `geo.js`,
  `color.js`.
- Deployment path chosen: **Expo Go** (scan QR, no Apple Developer account). Not yet
  set up for EAS Build / TestFlight / permanent home-screen install — that's a
  possible future step if a real standalone app is wanted.
- Verified via `npx expo export --platform ios` + `npx expo-doctor` (bundle compiles,
  all native modules Expo-Go compatible) — not via a browser preview, since
  react-native-maps has no meaningful web target.

## Where things stand / open thread

Was in the middle of figuring out how to get the **static web app** onto the user's
iPhone when this file was requested. Key constraint: geolocation needs HTTPS, so
serving over local Wi-Fi from the Mac won't give the current-location feature. Options
on the table, not yet decided:
1. GitHub Pages (push repo to GitHub, enable Pages) — free HTTPS, ties to this repo.
2. Netlify/Vercel deploy — free HTTPS, no GitHub push required.
3. Local network only — fastest, no account needed, but no geolocation.

No git remote is configured yet (`git remote -v` is empty) — that'll need setting up
for options 1 or 2. Once hosted, "Add to Home Screen" in iOS Safari gives it an
app-like icon.

## Working conventions learned this session

- User tunes constants directly in code (e.g. radius defaults/max) — treat those edits
  as intentional product decisions, not bugs to "fix back" to the original spec.
- For an ambiguous multi-option implementation choice (e.g. WebView vs native rewrite,
  Expo Go vs EAS vs Xcode direct install), ask via explicit options before building —
  user has firm preferences and doesn't want the default assumed.
- Don't run long-lived interactive dev servers (`expo start`, etc.) in the background
  on the user's behalf — they need the attached terminal for QR codes / live-reload
  keyboard shortcuts. Give run instructions instead.
