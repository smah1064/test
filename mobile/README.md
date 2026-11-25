# إبداع phone apps (iPhone and Android)

The apps show the live shop, **https://ebda3.me**, inside the app, with phone features around it. Every change
to the website shows in the apps at once; a new app version is only needed when the app part itself changes.

Built with [Capacitor 8](https://capacitorjs.com). App id `me.ebda3.app`, name **إبداع** (Arabic first, English
supported). This folder is separate from the website: nothing here is deployed with the site.

## What the app adds to the website

| Feature | Android | iPhone |
| --- | --- | --- |
| Its own "no connection" page (both languages), retries by itself and returns to the page (the app checks the shop for the page: the shop's security headers don't let the page read the shop itself) | ✓ | ✓ |
| Shop links stay in the app; other sites open in an in-app browser tab; WhatsApp, Instagram, the stores… open their own app | ✓ | ✓ |
| Shop links from WhatsApp/email open the app (App Links / universal links)¹ | ✓ | ✓ |
| The phone's share sheet for "Share…" in the editor | ✓ (added) | ✓ (built in) |
| "Save image" and other files the page makes: to Photos/Downloads (Android), share sheet with "Save Image"/"Save to Files" (iPhone) | ✓ | ✓ |
| The invoice's "Print / Save as PDF" with the phone's print screen | ✓ | ✓ |
| Camera **or** photos/files for every picture upload | ✓ | ✓ (built in) |
| Notifications for order updates and proofs, offered right after an order² | ready | ready |
| Update prompts (must-update screen, "new version" banner) and Google Play in-app updates³ | ✓ | ✓ |
| Google/Facebook sign-in in the phone's browser, handed back safely⁴ | ready | ready |
| Launch screen and icons from the brand files; status bar, notch and home bar kept clear | ✓ | ✓ |
| Back button: previous page, skipping the "no connection" page; the app goes to the background instead of closing | ✓ | swipe back |

¹ needs the two `/.well-known` files on the website and the store signing keys.
² needs the website part (device registration and sending) plus a Firebase project (Android) and the Apple push key.
³ the website serves `/app/config.json` (see below); without it the apps simply never ask.
⁴ hidden in the app until the website supports it; on iPhone Apple also requires "Sign in with Apple" next to it.

The website changes these need were sent to the website's chat; they are listed in
[What the website provides](#what-the-website-provides).

## How it fits together

```
mobile/
  capacitor.config.ts    app id, name, the shop address (server.url), plugin settings
  www/                   the app's own pages: offline.html, brand-mark.svg, app-glue.js
  android/               Android Studio project (Java)  → app/src/main/java/me/ebda3/app/
  ios/App/               Xcode project (Swift)          → App/Shell/
  ios/ShellCoreTests/    Swift tests for the iPhone link rules (swift test)
  scripts/               brand-assets.mjs (icons), version.mjs (version numbers)
  store/                 icons for the store listings
  test/                  tests (npm test)
```

- **`www/app-glue.js`** runs inside the shop's pages (the apps inject it before the page's scripts, only on the
  shop's own address). It adds the phone features above, marks the page with `<html class="in-app in-app-android">`
  (or `in-app-ios`) and gives the site `window.ebda3App` (`isApp`, `platform`, `version`, `build`,
  `enableNotifications()`, `openExternal(url)`, `refreshConfig()`). Requests from the app end their user agent
  with `Ebda3App/<version> (android|ios)`.
- **The native part** is one small plugin per platform, `Ebda3Shell` (`ShellPlugin.java` / `ShellPlugin.swift`),
  with the same methods: `open`, `print`, `saveFile`, `setRemoteConfig`, `signIn`, `getInfo`. The link rules
  are plain code with tests on both platforms (`LinkPolicy`, `DeepLinks`, `BackNavigator`; `ShellCore.swift`).
- Other plugins: `@capacitor/push-notifications`, `@capacitor/share`, `@capawesome/capacitor-app-update`.
  Versions are pinned exactly in `package.json`.

## Build and test

Needs Node 22. In `mobile/`:

```bash
npm ci                 # packages
npm test               # page features on the real shop pages, offline page, settings (needs "npm ci" in the repo root too)
npm run sync           # copy the app's files and settings into both native projects
```

- **Android** (needs the Android SDK / Android Studio and Java 21): `npm run android:debug` builds a test app in
  `android/app/build/outputs/apk/debug/`. Store build: `npm run android:release` (an `.aab`; signed when the
  `EBDA3_UPLOAD_KEYSTORE*` variables are set, see `android/app/build.gradle`).
- **iPhone** (needs a Mac with Xcode, or the online build): open `ios/App/App.xcodeproj` after `npm run sync`.
- **Online builds**: every push to the `mobile-apps` branch runs `.github/workflows/mobile-apps.yml` on GitHub:
  the tests, the Android logic tests and lint, an Android test app (download it from the run's *Artifacts*), a
  store bundle build, the iPhone link tests and an iPhone simulator build with screenshots.
- **A test build against a copy of the shop**: start the shop locally
  (`PREVIEW_LOCK=off PORT=3600 DATA_DIR=/tmp/app-data ADMIN_PASSWORD=pw node server.js` in the repo root), then
  `EBDA3_SITE_URL=http://10.0.2.2:3600 npx cap sync android` (Android emulator) or
  `EBDA3_SITE_URL=http://localhost:3600 npx cap sync ios` (iPhone simulator). Release builds refuse such a setup.

## Versions and updates

- The version is `"version"` in `package.json` (now **1.0.0**). The stores' build number comes from it:
  1.2.3 → 10203. Raise it with `npm run version:bump` (patch; or `-- minor` / `-- major`) before each store upload.
- Website changes need no app update. App changes do: bump, build, upload; then raise `latestBuild` (offer) or
  `minBuild` (require) in `/app/config.json` so older apps ask people to update.
- Upgrading Capacitor or a plugin: change the exact versions in `package.json`, `npm install`, `npm run sync`,
  `npm test`, and push: the online builds show whether both apps still build.

## What the website provides

The apps work without these; each one turns on a feature. All were sent to the website's chat.

1. **`/.well-known/assetlinks.json`** and **`/.well-known/apple-app-site-association`** (open shop links in the
   app), and **`/app/config.json`**, all reachable while the shop is private.
2. **`/app/config.json`**, read once per app start (all fields optional):

   ```json
   {
     "android": { "minBuild": 10000, "latestBuild": 10000, "storeUrl": "https://play.google.com/store/apps/details?id=me.ebda3.app" },
     "ios": { "minBuild": 10000, "latestBuild": 10000, "storeUrl": "https://apps.apple.com/app/id…" },
     "message": { "ar": "…", "en": "…" },
     "features": { "push": false, "socialLogin": { "android": false, "ios": false } },
     "inAppHosts": []
   }
   ```

   `inAppHosts` lists other sites allowed to open inside the app (e.g. the payment page once prepayment starts).
3. **Google/Facebook sign-in for the app**: `/auth/<provider>?app=1&challenge=…` in the phone's browser, the
   callback answering `me.ebda3.app://auth?code=…` (or `?error=…`), and `/auth/app?code=…&verifier=…` in the app,
   where the shop checks that SHA-256(verifier) matches the challenge before signing in.
4. **Notifications**: `POST /api/app/devices` (`{token, platform, appVersion, build, lang}`), then sending order
   updates with `data.url` set to the page to open (Android channel `orders`).

## What the owner needs to do for the stores

- **Google Play** (one-time $25, made by the owner): create the app `me.ebda3.app`; upload the `.aab`; Play then
  shows the signing key fingerprint for `assetlinks.json`. Fill in the data-safety form (account, orders,
  photos uploaded by the customer; no ads, no tracking).
- **Apple** ($99 a year, made by the owner): the Team ID for the universal links file; then the online build can
  sign and upload to TestFlight once the signing secrets are added to the repository's GitHub secrets (never to
  the code). Apple will check: privacy policy (/privacy ✓), account deletion in the app (Account › Password ✓),
  and Sign in with Apple if Google/Facebook sign-in is shown on iPhone (it is hidden there for now).
- **Push**: a Firebase project for Android (its `google-services.json` goes in `android/app/`) and an Apple push
  key; then set `Ebda3PushEnabled` to true in `ios/App/App/Info.plist`.

## Not done yet

- Store signing and uploading (needs the accounts).
- Notifications and Google sign-in work only after the website parts above.
- Sign in with Apple (only needed if Google/Facebook sign-in is shown on iPhone).
- Store listing texts and screenshots.
