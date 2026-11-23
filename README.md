# Employee Attendance — selfie + office Wi-Fi

A check-in web page for employees, an admin dashboard, and a monthly report. There is also an optional mobile app for staff who don't work in an office.

- **Check in from a web page.** Employees open the company's attendance address on their phone. There's nothing to install, and it works on Android and iPhone. They can also add it to the home screen so it opens like an app.
- **Office Wi-Fi required.** Each office location can list its Wi-Fi's internet address. Check-ins there are only accepted from that network. A fake-GPS app can't change which network a phone is on, so this is the main protection against cheating.
- **Live selfie on every check-in and check-out.** The page captures the photo from the live front camera. There is no upload button, so gallery photos and filtered or edited pictures can't be used.
- **GPS is checked too.** The location is recorded with every check-in and must be at the office.
- **One phone per employee.** An account is locked to the first browser or phone it logs in on, so a colleague can't check in for someone else. An admin can reset it.
- **Monthly report.** On the 1st of each month the server builds an Excel report for the previous month and can email it to admins. Any month can also be downloaded from the dashboard.
- **Security alerts.** Every blocked attempt is logged with the employee and the reason, for example "not on office Wi-Fi" or "outside location".
- **Arabic and English.** The check-in page and the app follow the phone's language and have a switch to change it, with a full right-to-left layout in Arabic. The admin dashboard and reports are in English.

```
server/   Node.js server: employee check-in page (/), admin dashboard (/admin), API, monthly report job
mobile/   Optional Flutter app (Android + iOS) for staff at sites without office Wi-Fi
```

---

## How a check-in is verified

1. The employee taps **Check in**. If the phone isn't on the office Wi-Fi, the page says so immediately: "turn off mobile data and connect to the office Wi-Fi".
2. The page reads the phone's location, then opens the front camera, and the employee takes a selfie.
3. **The server decides.** It accepts the check-in only if all of these are true:
   - The request comes from the office's internet address.
   - The location is at the office. On office Wi-Fi this check is lenient, because indoor GPS can be a few hundred metres off and the Wi-Fi already proves the employee is there. A location in another part of town is still rejected.
   - The selfie is a real photo taken less than 5 minutes ago.
   - The request comes from the employee's registered browser or phone.
   - The employee isn't already checked in (for a check-in) or already checked out (for a check-out).

   The server's clock sets the time of the check-in, so changing the phone's clock has no effect.

**The Wi-Fi rule belongs to the location, not to the app or the page.** If a location has office Wi-Fi addresses, every check-in there must come from that Wi-Fi, from the web page or the app. Nobody can skip the check by using a different client. Locations without Wi-Fi addresses use GPS only. These suit field sites, where employees should use the mobile app, which can detect fake GPS.

## Monthly report contents

For each employee:

- working days, days present, days absent and attendance %
- late arrivals and total late minutes, using the work start time plus a grace period
- days they left early and days with no check-out
- total hours, average hours per day and days worked on weekends
- blocked check-ins: not on office Wi-Fi, outside the location, developer mode, fake GPS or a rooted phone

The Excel file has three sheets: **Summary**, **Daily detail** (one row per employee per day, with absent rows in red and late rows in yellow) and **Blocked punches**. CSV export is also available.

---

## Setup

### 1. Run the server

You need a machine with Node.js 18+ (or Docker) and an **HTTPS** address, such as `https://attendance.yourcompany.com`. Browsers only allow the camera and location on HTTPS pages.

```bash
cd server
cp .env.example .env        # then edit it: JWT_SECRET, COMPANY_TZ, ADMIN_PASSWORD, TRUST_PROXY, SMTP…
npm install
npm start                   # http://localhost:3000
```

Or with Docker:

```bash
cd server
docker build -t attendance .
docker run -d -p 3000:3000 --env-file .env -v $(pwd)/data:/app/data --restart unless-stopped attendance
```

Everything is stored in `server/data/`: the database, the selfies and the generated reports. **Back up this folder.**

#### Important: `TRUST_PROXY`

The Wi-Fi check depends on the server seeing each phone's real internet address. HTTPS is normally provided by a proxy in front of the server (Caddy, nginx, or the hosting platform). That proxy passes the real address on, and the server must be told to trust it, but only it:

| How the server is run | Set |
|---|---|
| Caddy or nginx **on the same machine** (recommended) | nothing (the default `loopback` is right) |
| Render, Railway, Fly.io, Heroku or behind a single load balancer | `TRUST_PROXY=1` |
| Behind Cloudflare **and** a host proxy | `TRUST_PROXY=2` |

**Check that it's right:** on the dashboard, open **Locations → Edit → Use this network**. It should show your office's public address. If it says *private address*, the setting is wrong. Never trust more proxies than you really have: anyone could then fake their address.

The simplest HTTPS setup on your own server is Caddy with this one-line `Caddyfile`. It gets the certificate automatically:

```
attendance.yourcompany.com {
    reverse_proxy localhost:3000
}
```

### 2. Set up the dashboard

Open `https://<your-address>/admin` and log in with `ADMIN_CODE` / `ADMIN_PASSWORD`. Then:

1. **Change password** (top right).
2. **Settings:** company name, work hours, grace period, weekend days and holidays.
3. **Locations:** add each office with its coordinates and a radius. 100–200 m is typical. Then set up its Wi-Fi:
   1. Go to the office and connect your phone or laptop to the **office Wi-Fi**, with mobile data and any VPN off.
   2. Open the dashboard there, edit the location and click **Use this network**. The office's internet address is filled in.
   3. If the office has a second internet line or a backup connection, connect to it and click the button again. All the addresses are kept.

   If the office's internet provider changes the address (some home-style connections do), check-ins will be rejected as "not on office Wi-Fi". Repeat these steps, or ask the provider for a **static IP**, which is the usual choice for offices.
4. **Employees:** add each employee with a code, name, password and work location.

### 3. Employees

Send employees the address, for example `https://attendance.yourcompany.com`. Each employee:

1. Opens it on their phone **in their normal browser**, not a private or incognito window. Their account is linked to that browser at first login.
2. Logs in, then allows **camera** and **location** when asked.
3. Optionally adds the page to the home screen: Safari → Share → **Add to Home Screen**, or Chrome → ⋮ → **Add to Home screen**.

If an employee gets a new phone, clears their browser data, or switches browser, they will see "registered to another phone". The admin clicks **Reset phone** on the Employees page, and the employee logs in again.

### 4. Optional: the mobile app (staff outside the office)

For staff at sites with no office Wi-Fi, use the Flutter app in `mobile/`. It adds the protections a web page can't have: it blocks Android Developer options, fake-GPS apps, rooted or jailbroken phones and emulators. Assign these employees to locations that have **no** Wi-Fi addresses.

- **Build with GitHub:** in the repo go to **Settings → Secrets and variables → Actions → Variables** and add `API_URL` = your server address. Then open **Actions → Build → Run workflow** and download `attendance-apk` from the finished run.
- **Build locally** with [Flutter](https://docs.flutter.dev/get-started/install): `cd mobile && flutter build apk --release --dart-define=API_URL=https://attendance.yourcompany.com`.
- **iOS:** build on a Mac with Xcode (`flutter build ipa …`) and distribute through TestFlight.

Before a Play Store release, change the app ID `com.yourcompany.attendance_app` and create a release signing key ([guide](https://docs.flutter.dev/deployment/android#sign-the-app)).

---

## Developing

- **Server:** `cd server && npm run dev`; tests: `npm test`. The check-in page is `server/public/index.html` + `checkin.js`; the dashboard is `server/public/admin/`.
- **Testing the Wi-Fi check locally:** requests from your own machine come from `127.0.0.1`. Put `127.0.0.1` in a location's office Wi-Fi list to test, and remove it afterwards.
- **Translations:** check-in page text is at the top of `server/public/checkin.js`, app text is in `mobile/lib/l10n/strings.dart`, and server messages are in `server/src/i18n.js`.
- **App development:** run debug builds with `flutter run --dart-define=ALLOW_DEV_MODE=true --dart-define=API_URL=http://<your-pc-ip>:3000` to skip the developer-mode check, which USB debugging needs. The flag has no effect in release builds.
- **Monthly report by hand:** `node src/index.js report 2026-10` writes `data/reports/attendance-2026-10.xlsx` and emails it if SMTP is set.

## Limits

- **Someone inside the office building can check in for a colleague who isn't there,** if they know the colleague's password and have the colleague's registered phone or browser. The selfie is the defence here: admins can see every photo on the dashboard. A good next step is automatic face matching against a reference photo.
- **A VPN into the office network** would make a remote phone look like it is in the office. Most small offices don't run one. If yours does, don't use the VPN's exit address as an office Wi-Fi entry.
- **The web page can't see phone settings,** so on GPS-only locations a fake-GPS app could fool it. That's why GPS-only locations should be used with the mobile app.
- **Filters:** the photo comes from the live camera stream, with no upload and no camera app, so filter and beauty apps can't be applied. A few phone makers process front-camera images inside the camera hardware itself, and no app or page can turn that off.
