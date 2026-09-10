# Trackia (Android app)

This is the same Trackia media tracker, wrapped as a real native Android app
with [Capacitor](https://capacitorjs.com/) instead of a browser-installed
PWA. All the app's HTML/CSS/JS is bundled *inside* the app package — there's
no GitHub Pages URL involved, and no browser wrapper.

You don't need Android Studio installed. A GitHub Actions workflow in this
repo (`.github/workflows/build-apk.yml`) builds the `.apk` in the cloud every
time you push, and you download the finished file from GitHub.

## 1. Push this to a GitHub repo

Create a new repo and push everything in this folder (the `android/`,
`www/`, `.github/` folders, and the root config files).

```bash
cd trackia-app
git init
git add .
git commit -m "Trackia: native Android wrapper"
git branch -M main
git remote add origin https://github.com/<your-username>/<repo-name>.git
git push -u origin main
```

`node_modules/` isn't included — you don't need it locally, since the
workflow installs dependencies itself in the cloud. (If you ever want to run
Capacitor commands on your own machine, `npm install` first.)

## 2. Let GitHub build the APK

1. On GitHub, open the repo's **Actions** tab.
2. You should see a run called "Build APK" already in progress (it triggers
   automatically on push to `main`). If not, click **Build APK** in the
   sidebar → **Run workflow**.
3. Wait for it to finish (a few minutes — first run is slower).
4. Open the finished run, scroll to **Artifacts**, and download
   **trackia-debug-apk**. It's a zip containing `app-debug.apk`.

You can do steps 3–4 straight from your phone's browser if you'd rather not
use a computer — GitHub's Actions/Artifacts pages work fine on mobile.

## 3. Install it on your Pixel

1. Unzip the downloaded zip if you got it on a computer, then copy
   `app-debug.apk` to your phone (or just download it directly on the phone,
   where it lands in **Downloads**).
2. Open it from **Files** (or tap the download notification).
3. Android will ask to allow installs from that source the first time —
   tap **Settings**, enable **Allow from this source**, then go back and
   tap **Install**.
4. Open **Trackia** from your app drawer like any other app.

This is a debug build, which is the normal way to install your own app
without publishing it anywhere — it's signed with a throwaway debug key
that Gradle generates automatically, so Android is fine installing it, it
just won't come from the Play Store. Nothing about functionality is
different from a release build.

## Data and updates

- Your list is stored on-device (inside the app's own storage) — nothing is
  sent anywhere.
- Because the web assets are now bundled into the APK rather than fetched
  from a URL, updating the app means: edit files in `www/`, commit, push,
  and repeat steps 2–3 to install the new APK over the old one (same
  `applicationId`, so it updates in place and keeps your data).
- If you later want it on the Play Store, that needs a signed release build
  and a Play Console account — a different, heavier process. This debug-APK
  route is the right one for "just on my own phone."

## What's actually in here

- `www/` — the same app you already had (unchanged)
- `android/` — the native Android project Capacitor generated, with the app
  icon and splash screen re-themed to match Trackia's palette
- `.github/workflows/build-apk.yml` — builds `android/` into an APK on every
  push and attaches it to the workflow run
- `capacitor.config.ts` — app id (`com.trackia.app`) and app name (`Trackia`)
