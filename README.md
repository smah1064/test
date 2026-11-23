# Employee Attendance — selfie + GPS

A mobile app for employees to check in and out, and a web dashboard for admins.

- **Selfie on every check-in/out.** The app takes the photo itself with the front camera. There is no gallery picker and the phone's own camera app (and its beauty filters) is never used.
- **GPS geofence.** A check-in is only accepted inside the radius of the employee's work location. Weak GPS fixes are rejected.
- **Developer mode must be off.** On Android, fake-GPS apps only work after Developer options are turned on, so the app refuses to work while they are on. It also blocks mocked GPS fixes, rooted or jailbroken phones, and emulators.
- **One phone per employee.** An account is locked to the first phone it logs in on, so a colleague can't check in for someone else. An admin can reset it.
- **Monthly report.** On the 1st of each month the server builds an Excel report for the previous month and can email it to admins. Admins can also download any month from the dashboard at any time.
- **Security alerts.** Every blocked attempt is logged with the employee, the reason and the map location, and shows up in the report.

```
mobile/   Flutter app (Android + iOS) for employees
server/   Node.js API + admin web dashboard + monthly report job
```

---

## How check-in works

1. The employee taps **Check in**.
2. The app checks the phone: Developer options and USB debugging are off, the phone is not rooted or jailbroken, and it is not an emulator. If a check fails, a screen explains how to fix it (with a button to open Developer options), and the attempt is reported to admins.
3. The app reads live GPS (never a cached position) and waits for a fix accurate to about 30 m. A fix marked as mocked is blocked and reported.
4. The front camera opens inside the app and the employee takes a selfie.
5. The phone is checked again, then the selfie, location and flags are uploaded.
6. **The server checks everything again.** It recomputes the distance to the site, rejects weak GPS and selfies older than 5 minutes, checks that the file is a real JPEG, checks the phone binding, and rejects a check-in while already checked in. The server's own clock sets the time of the punch, so changing the phone's clock has no effect.

## Monthly report contents

For each employee:

- working days, days present, days absent and attendance %
- late arrivals and total late minutes, using the work start time plus a grace period
- days they left early and days with no check-out
- total hours, average hours per day and days worked on weekends
- number of blocked punches (developer mode, fake GPS, root or outside the location)

The Excel file has three sheets: **Summary**, **Daily detail** (one row per employee per day, with absent rows in red and late rows in yellow) and **Blocked punches**. CSV export is also available.

Set the working hours, grace minutes, weekend days (for example Fri/Sat) and public holidays in **Settings** on the dashboard.

---

## Setup

### 1. Run the server

You need a machine with Node.js 18+ (or Docker) and an **HTTPS** address, such as `https://attendance.yourcompany.com`. Release builds of the app only talk to HTTPS. Any VPS works if you put Caddy or nginx in front of it. Railway, Render and Fly.io also work if you give them a persistent volume for `data/`.

```bash
cd server
cp .env.example .env        # then edit it: JWT_SECRET, COMPANY_TZ, ADMIN_PASSWORD, SMTP…
npm install
npm start                   # http://localhost:3000
```

Or with Docker:

```bash
cd server
docker build -t attendance .
docker run -d -p 3000:3000 --env-file .env -v $(pwd)/data:/app/data --restart unless-stopped attendance
```

Everything is stored in `server/data/`: the SQLite database, the selfies and the generated reports. **Back up this folder.**

### 2. Set up the dashboard

Open the server address in a browser and log in with `ADMIN_CODE` / `ADMIN_PASSWORD`. Then:

1. **Change password** (top right).
2. **Settings:** company name, work hours, grace period, weekend days and holidays.
3. **Locations:** add each office or site with its coordinates and an allowed radius. 100–200 m is typical, because indoor GPS can be 20–50 m off. To get coordinates, right-click the building in Google Maps and copy them, or stand there and click **Use my current location**.
4. **Employees:** add each employee with a code, name, password and work location. Choose "Any location" for people who move between sites.

### 3. Build and install the app

**Option A: let GitHub build the APK.** This repo has a workflow at `.github/workflows/build.yml`. In the repo, go to **Settings → Secrets and variables → Actions → Variables** and add `API_URL` = your server address. Then open **Actions → Build → Run workflow**. Download `attendance-apk` from the finished run and send the APK to employees.

**Option B: build locally** with [Flutter](https://docs.flutter.dev/get-started/install):

```bash
cd mobile
flutter pub get
flutter build apk --release --dart-define=API_URL=https://attendance.yourcompany.com
# → build/app/outputs/flutter-apk/app-release.apk
```

For iOS, build on a Mac with Xcode: `flutter build ipa --release --dart-define=API_URL=…`, then distribute through TestFlight or Apple Business Manager.

Before a Play Store or App Store release:

- Change the app ID `com.yourcompany.attendance_app` in `mobile/android/app/build.gradle.kts` and in Xcode.
- Create a release signing key ([Flutter guide](https://docs.flutter.dev/deployment/android#sign-the-app)). The default release build uses the debug key. That is fine for sending the APK directly, but not for the Play Store.

### 4. Employees

The employee installs the app, logs in with their code and password, and allows camera and location access. The phone is now registered to them. If they get a new phone, an admin clicks **Reset phone** on the Employees page.

Developer options must be off. On most Android phones: **Settings → System → Developer options → turn off the switch at the top** (on Samsung: **Settings → Developer options**). The app shows these steps and a button that opens the screen.

---

## Developing

- **Server:** `cd server && npm run dev`; tests: `npm test`.
- **App:** you need USB debugging to run the app from your computer, and the app normally blocks that. Run debug builds with `flutter run --dart-define=ALLOW_DEV_MODE=true --dart-define=API_URL=http://<your-pc-ip>:3000` to skip the developer-mode and emulator checks. The flag is ignored in release builds. Debug builds may use plain `http://`; release builds need HTTPS.
- **Monthly report by hand:** `node src/index.js report 2026-10` writes `data/reports/attendance-2026-10.xlsx` and emails it if SMTP is set.

## Limits and further hardening

These measures stop the usual cheats: fake-GPS apps, buddy punching from another phone, photos from the gallery and old selfies. Be aware of these limits:

- **The device checks run in the app.** Someone with root access, or a modified copy of the APK, could fake those results. The server still enforces the geofence, the selfie, freshness and the phone binding. For stronger proof that the request comes from your unmodified app on a genuine phone, add the [Google Play Integrity API](https://developer.android.com/google/play/integrity) and Apple [App Attest](https://developer.apple.com/documentation/devicecheck/establishing-your-app-s-integrity) and verify their tokens on the server.
- **iOS has no Developer-mode switch that apps can read.** On iOS 15+ the app instead detects simulated locations, which is the only way to fake GPS without jailbreaking, and it blocks jailbroken phones.
- **Selfies are not matched to a face.** Admins can review every photo on the dashboard. A good next step is automatic face checking: on-device face detection to reject photos with no face, or server-side face matching against a reference photo.
- **Filters:** the app uses the camera directly, with no gallery and no hand-off to the camera app, so apps like Snapchat or the stock beauty mode can't be applied. A few phone makers process front-camera images inside the camera hardware itself, and no app can turn that off.
