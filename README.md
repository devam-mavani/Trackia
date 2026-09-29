# Trackia

Offline-first media tracker for anime, series, movies, books, and manga.
Pure black + red theme, everything stored in `localStorage`, wrapped as a
native Android app with Capacitor.

## Data model

Each entry: `title`, `type` (anime/series/movie/book/manga), `cover` (optional
data URL), `season` (anime/series only), `progress` + optional `total`
(unit depends on type — episodes/pages/chapters), `status` (plan/progress/
completed/hold/dropped), `rating` (0–10), `notes`, `tags[]`.

## Run the web app locally

```bash
npm install
npm run dev       # dev server at http://localhost:5173
npm run build     # production build -> dist/
```

## Android (Capacitor)

The `android/` native project is **not committed** — it's generated fresh
each time from `capacitor.config.json`, which keeps the repo small and avoids
drift between the web build and the native shell.

```bash
npm install
npm run build              # builds dist/
npx cap add android        # first time only, locally
npx cap sync android
node scripts/patch-manifest.js   # adds camera + storage permissions
npx cap open android       # opens Android Studio
```

To build a debug APK from the command line instead of Android Studio:

```bash
cd android
./gradlew assembleDebug
# APK lands in android/app/build/outputs/apk/debug/
```

### Camera plugin & permissions

The cover-image picker uses the official `@capacitor/camera` plugin
(`Camera.getPhoto` with `CameraSource.Prompt`, so the user can choose
"take photo" or "choose from gallery"). In a plain desktop browser (no
native Capacitor runtime) it falls back to a hidden `<input type="file">`
so the web build stays usable outside the app.

`scripts/patch-manifest.js` adds the following to
`android/app/src/main/AndroidManifest.xml` after `cap add android` runs:

- `android.permission.CAMERA`
- `android.permission.READ_EXTERNAL_STORAGE` / `WRITE_EXTERNAL_STORAGE`
  (capped at `maxSdkVersion="32"` for legacy storage access)
- `android.permission.READ_MEDIA_IMAGES` (Android 13+ granular media access)
- an optional `android.hardware.camera` feature declaration

## CI: debug APK on every push

`.github/workflows/android-debug-apk.yml` runs on every push:

1. `npm ci`
2. `npm run build`
3. `npx cap add android` (fresh project, since `android/` isn't committed)
4. `npx cap sync android`
5. `node scripts/patch-manifest.js`
6. `./gradlew assembleDebug`
7. Uploads the resulting APK as a workflow artifact (`trackia-debug-apk`)

Download it from the **Actions** tab → the workflow run → **Artifacts**.

## Settings

- **Font size** — small / medium / large, applied via a CSS custom property.
- **Tile size** — small / medium / large, changes the card grid's minimum
  tile width and cover height.
- **Theme colors** — hex inputs (+ color pickers) for background, card
  surface, accent, and text; stored in `localStorage` and applied as CSS
  variable overrides. "Reset to default theme" clears the overrides.
- **Backup** — export the full library as a `.json` file, or import one
  (from Trackia or a compatible export) to merge into the current library.


## Home: separate sources

The Home page has a switch at the top — **Movies & TV · Anime · Manga · Books**.
Each source is fully separate (its own search, discovery rows, detail info and
"more like this"), and the choice is remembered.

| Source | Data from | Needs a key? |
|---|---|---|
| Movies & TV | TMDB (+ OMDb for IMDb ratings) | Free TMDB key, added in Settings |
| Anime, Manga | AniList | No |
| Books | Google Books | No (optional key via `VITE_GOOGLE_BOOKS_KEY`) |

AniList allows ~30 requests/minute, so Home rows load lazily as you scroll and
results are cached for 6 hours.

### Database update (one time)
Run `supabase/migrations/20260929_anime_manga_books.sql` in the Supabase SQL
editor. Until then everything still works; only entries added from AniList /
Google Books can't sync to the cloud.
