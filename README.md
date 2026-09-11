# ABC Hospital — AI Hospital Agent

Two apps on one Firebase backend:

| App | Folder | Who | Platforms |
|---|---|---|---|
| Hospital portal (React + Vite) | `/` | Admins, reception, doctors | Web |
| Doctor app (Flutter) | `mobile_app/` | Doctors | Android, iOS, Web |

Both apps share appointments (token numbers, 30-min slots from each doctor's schedule), patient **medical records**
(consultation notes, vitals, prescriptions, lab-report uploads) and **ZegoCloud video consultations**. The video
room ID is the appointment ID. The patient joins at `<portal>/#/call/<appointmentId>` (no account needed),
using a link the doctor sends on WhatsApp from the app.

## 1. Firebase (once)

1. Create a Firebase project. Enable **Authentication → Email/Password** and **Google**, **Firestore** and **Storage**.
2. Deploy rules and indexes from this folder: `npx firebase-tools deploy --only firestore,storage`
3. First admin: create a user in Authentication, then in Firestore add `users/<uid>` with `{ role: "admin" }`.
   Staff roles: `admin | hospital_admin | doctor | receptionist | billing`. Doctors self-register from the app.

## 2. Web portal

```bash
cp .env.example .env.local   # fill in Firebase web config + Zego keys
npm install
npm run dev                  # http://localhost:3000
```

With the Firebase keys left empty, the portal runs on built-in sample data (demo mode, no login).
After the first admin login on an empty database, click **Load sample data** to seed it.
Deploy: `npm run build && npx firebase-tools deploy --only hosting`. Set `VITE_PUBLIC_URL` to the hosted URL
so patient call links point to it.

## 3. Doctor app (Flutter)

```bash
cd mobile_app
dart pub global activate flutterfire_cli
flutterfire configure          # same Firebase project; overwrites lib/firebase_options.dart
cp env.example.json env.json   # Zego AppID/AppSign + PORTAL_URL
flutter run --dart-define-from-file=env.json
flutter build apk --dart-define-from-file=env.json
flutter build web --dart-define-from-file=env.json
```

- Google sign-in on Android needs your app's SHA-1 added in Firebase project settings.
- iOS: deployment target 15.0. Camera, microphone and photo usage strings are already in `Info.plist`.
- The ZegoCloud Flutter call kit is Android/iOS only. The Flutter **web** build opens the portal's call page instead.

## Tests

```bash
node --test src/slots.test.mjs      # portal slot logic
cd mobile_app && flutter test       # same cases for the Dart copy
```

## Before going live

- **Video tokens:** both apps use Zego's test auth (the server secret or AppSign is in the client). Mint Zego
  Token04 in a Cloud Function and pass `token` instead.
- Phone OTP isn't implemented. Sign-up verifies email with a link.
- Payments, staff, audit logs and departments in the portal are still local sample data.
