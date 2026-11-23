# Attendance — mobile app (Flutter, Android + iOS)

See the main [README](../README.md) for the full setup.

```bash
flutter pub get
# Point the app at your server and build an installable APK:
flutter build apk --release --dart-define=API_URL=https://attendance.yourcompany.com
# iOS (on a Mac with Xcode):
flutter build ipa --release --dart-define=API_URL=https://attendance.yourcompany.com
```

While developing you need USB debugging, which the app normally refuses. Run debug builds with
`--dart-define=ALLOW_DEV_MODE=true` to skip the Developer-options and emulator checks. This flag
has no effect in release builds.
