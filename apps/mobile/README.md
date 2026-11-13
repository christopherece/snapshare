# SnapShare mobile app (Android + iOS)

The native SnapShare app, built with Expo (SDK 58) and React Native. One app covers both sides of an event:

- **Guests** scan the event QR code (or type the event code), take photos with the in-app camera or pick them
  from their library, and watch the live gallery. Photos queue on the phone and upload when there is signal.
- **Hosts** sign in to see their events, moderate photos as they arrive (approve, hide, favorite, delete,
  review guest reports), show or print the QR code, open the live slideshow link, download the originals,
  and change the event settings.

Admin tools (accounts, invites, all customers' events) stay in the web dashboard.

## Run it locally

Requires [Bun](https://bun.sh), the backend running (see the root README), and either a development build of
the app or an Android emulator / iOS simulator.

```bash
cp apps/mobile/.env.example apps/mobile/.env    # set EXPO_PUBLIC_API_URL to your computer's LAN IP
bun install
bun run dev:mobile                              # Metro dev server
```

The app uses native modules that Expo Go may not carry at this SDK version, so use a development build:

```bash
cd apps/mobile
bunx eas build --profile development --platform android   # or: bunx expo run:android (needs Android Studio)
bunx eas build --profile development --platform ios       # iOS simulator build (needs a Mac to run)
```

Checks:

```bash
bun --cwd apps/mobile typecheck
cd apps/mobile && bunx expo-doctor
```

## Where things are

```
app/                    Screens (expo-router: one file per route)
  index.tsx             Start: scan a QR, enter a code, or go to hosting
  scan.tsx              QR scanner            join/          Event preview + name/passcode
  camera.tsx            The event camera      feed.tsx       Live gallery
  host/                 Host area (sign-in gate in _layout.tsx): events, new event, event, account
src/
  components/           UI kit (ui.tsx), camera, photo viewers, host tabs
  lib/                  API clients, upload queue, WebSocket, link parsing, config
  store/                Guest session (AsyncStorage) and host sign-in (Keychain / Keystore)
assets/                 Icon, Android adaptive icon, splash mark — generated, do not edit by hand
```

The icons come from the brand master: `bun --cwd packages/brand generate`.

## Configuration

| Variable | Purpose |
| --- | --- |
| `EXPO_PUBLIC_API_URL` | The SnapShare server. Baked into the app at build time. `eas.json` sets it for store builds. |
| `EXPO_PUBLIC_LINK_HOST` | Optional. Domain whose `https://<host>/join/<code>` links open the app. Defaults to the API host. |
| `EXPO_PUBLIC_SUPPORT_EMAIL` | Optional. Where "Delete my account" requests are emailed. |

`app.json` holds the static app config; `app.config.ts` adds the link domain.

## Release builds

One-time setup:

1. Create an [Expo account](https://expo.dev), then in `apps/mobile`: `bunx eas login` and `bunx eas init`
   (links the project and records its ID).
2. Decide the app ID **before the first store upload — it cannot be changed afterwards.** It is
   `com.snapshare.app` in `app.json` (`ios.bundleIdentifier` and `android.package`). If you change it, also set
   `ANDROID_APP_PACKAGE` on the server.
3. Check the server URL in `eas.json` (`build.preview.env` and `build.production.env`).
4. Apple Developer Program membership (iOS) and a Google Play Console account (Android).

Build and submit:

```bash
cd apps/mobile
bunx eas build --profile preview --platform android      # an APK to install and test on real phones
bunx eas build --profile production --platform all       # store builds (AAB + IPA); build numbers auto-increment
bunx eas submit --profile production --platform android  # uploads to the Play internal track
bunx eas submit --profile production --platform ios      # uploads to App Store Connect / TestFlight
```

EAS creates and stores the signing keys the first time you build.

### After the app is published

Set these on the server (`.env`) and restart it:

- `APP_STORE_URL`, `PLAY_STORE_URL` — the guest web app then offers the native app.
- `IOS_APP_ID` (`<Apple Team ID>.<bundle id>`) and `ANDROID_APP_FINGERPRINTS` (SHA-256 of the Play app-signing
  key *and* the upload key) — the server then serves `/.well-known/apple-app-site-association` and
  `/.well-known/assetlinks.json`, and the printed QR code opens the app directly on phones that have it.
  Without them the QR code keeps opening the web app, which is fine.

### Store review notes

- **Account deletion.** The stores require a way to delete an account that can be created in the app. The app
  has *Account → Delete my account*, which emails the operator; the server has no self-service deletion yet.
  Apple may ask for deletion to be completed inside the app — if so, add a `DELETE /api/auth/me` endpoint and
  call it from `app/host/account.tsx`.
- **User-generated content.** Guests can report photos, hosts moderate them, and the terms are linked from the
  join and sign-in screens. Mention this in the review notes, and give the reviewer a test event code and a
  host login.
- **Permissions.** Camera (photos and QR scanning) and photo library (picking photos to share). No microphone,
  location or tracking.
- **Privacy forms.** Collected data: name (optional for guests), email (hosts), photos, and a random device ID
  used for rate limiting. Privacy policy URL: `https://<your domain>/privacy`.
