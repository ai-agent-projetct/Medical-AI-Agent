# ABC Hospital — AI Hospital Agent

Two apps on one Firebase backend:

| App | Folder | Who | Platforms |
|---|---|---|---|
| Hospital portal (React + Vite) | `/` | Admins, reception, billing, doctors | Web |
| Mobile app (Flutter) | `mobile_app/` | **Patients and doctors** (role picked at sign-up) | Android, iOS, Web |

**Patient side** of the mobile app (Practo-style): find doctors by name, speciality, symptom or hospital;
doctor profiles with fees and verified reviews; book clinic visits or video consultations for yourself or
family members (live free slots, token numbers); join the video call; chat with the clinic, including a free
follow-up chat; prescriptions and records for the whole family, with report uploads; order medicines (Rx upload
for prescription drugs) and book lab tests with home sample collection; health articles. Staff handle orders on
the portal's **Pharmacy & Lab Orders** page.

**AI voice receptionist (phone booking with token numbers)**
- Patients call the hospital number. The agent speaks **English, Tamil, Telugu, Kannada, Malayalam or Hindi**
  (press 1–6 or say the language). It understands the doctor, department or problem ("chest pain", "மூட்டு வலி",
  "జ్వరం"…) and offers free slots for today, tomorrow or the day after.
- It recognises registered callers by caller ID ("Is this for Asha?") and otherwise asks for the name and
  registers the patient.
- It books with the doctor's **daily token number** in the same transaction the apps use, so there is no
  double booking. It reads the token out, and the WhatsApp confirmation follows automatically.
- If it can't understand after three tries, it transfers to `RECEPTION_NUMBER` or promises a call-back.
- Code: `functions/voiceAgent.js` (dialogue, all languages), `functions/voiceCtx.js` (booking),
  `functions/twiml.js` (Twilio TwiML + signature check), endpoints `voiceCall` (Twilio webhook) and
  `voiceTurn` (portal demo).
- Portal → **AI Voice Receptionist (Calls)**: live call log with transcripts and booked tokens, plus a
  browser demo. You talk into the microphone (Chrome) or type, using the same agent and real bookings.
- Simulate a phone call against the emulators: `node scripts/voice-call-sim.mjs +919812345678 "#2" "எனக்கு நெஞ்சு வலி" "நாளை" "#2" "Lakshmi" "ஆமா"`.
- Going live: Twilio Indian voice number → "A call comes in" Webhook (POST)
  `https://asia-south1-<project>.cloudfunctions.net/voiceCall`, then set `VOICE_WEBHOOK_URL` to that URL and
  run `firebase functions:secrets:set TWILIO_AUTH_TOKEN`. Have each language's prompts reviewed by a native
  speaker, and check the TTS voice names in `functions/twiml.js` against Twilio's voice list.

**Hospital billing & pharmacy** (portal, sidebar section *Hospital Billing & Pharmacy*):
- **Billing Counter**: OPD/service bills from the charge master, GST invoices numbered per counter and financial
  year (`OPD/C1/2026-27/000001`, never deleted), partial payments, dues, print and WhatsApp.
- **Pharmacy POS**: medicine sales, stock deducted first-expiry-first-out across batches, walk-in customers.
- **Pharmacy Inventory**: item master (composition, HSN, GST, MRP, Rx flag), batch stock with expiry,
  purchase entry (GRN) with free quantity, suppliers and payables, expiry and low-stock alerts.
- **In-Patient (IPD)**: wards and live bed board, admission with advance, running charges, discharge with
  room rent per started 24 hours and the advance adjusted on the final bill.
- **Charge Master** (tariff) and **Billing Reports**: collection by payment mode, revenue, GST and dues by
  department, computed server-side.

Every money and stock change runs in a Firestore transaction. Receipts are append-only and refunds need an
admin. New `pharmacist` role (set by an admin). These modules query by date, status or search prefix with
limits, so they don't download whole collections.

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

## Demo (one command, no Firebase project needed)

Needs Node 22, Java 21 and Python.

```bash
npm install
npm run demo        # emulators + demo hospital + portal on http://localhost:3000 (Emulator UI on :4000)
npm run demo:app    # second terminal: mobile app (web build) on http://localhost:3100
```

Build the mobile web app once first:

```bash
cd mobile_app && flutter build web --dart-define=USE_EMULATORS=true --dart-define=PORTAL_URL=http://localhost:3000
```

The demo hospital has 8 doctors across specialities, 62 patients, today's and tomorrow's OPD queues with
daily tokens, a tariff, pharmacy stock (with near-expiry and low-stock items), 24 beds in 3 wards and the
patient-app catalogs. Logins (emulator only):

| Role | Email | Password | App |
|---|---|---|---|
| Admin | admin@demo.test | demo-admin-123 | portal |
| Reception | reception@demo.test | demo-recep-123 | portal |
| Billing | billing@demo.test | demo-bill-123 | portal |
| Pharmacist | pharmacy@demo.test | demo-pharm-123 | portal |
| Doctor | doctor@demo.test | demo-doctor-123 | mobile app |
| Patient | patient@demo.test | demo-patient-123 | mobile app |

Phone OTP in the demo: the Auth emulator shows the code in its log and in the Emulator UI.
Video calls need a ZegoCloud AppID (`VITE_ZEGO_APP_ID`, `ZEGO_APP_ID`); everything else works offline.

## Run everything locally (no Firebase project needed)

The Firebase Local Emulator Suite (Auth, Firestore, Storage; needs Java 11+) stands in for a real project.

```bash
npm run emulators                    # terminal 1: emulators on :9099/:8181/:9199, UI on :4000
node scripts/seed-emulator.mjs       # test logins (see the script); add --reset to wipe data
npm run dev:emulator                 # terminal 2: portal on :3000 against the emulators
cd mobile_app && flutter run -d chrome --dart-define=USE_EMULATORS=true   # doctor app
```

Sign in to the portal as the seeded admin, then click **Load sample data**. Doctors and patients sign up in the
app. The seed script also loads the medicine, lab-test and article catalogs (`src/catalog.json`); on a real
project, load them from **Pharmacy & Lab Orders → Load sample catalog**.

## Tests

```bash
npm test                             # portal slot logic
npm run test:rules                   # 38 Firestore/Storage security-rule tests (starts its own emulators)
npm run test:functions               # Cloud Functions: voice agent (6 languages), Zego token, WhatsApp, Twilio signature
node scripts/functions-emulator-test.mjs   # functions end to end on the running emulators
npm run test:load                    # concurrent bookings: no double booking, gap-free daily tokens
cd mobile_app && flutter test test   # Dart slot logic
```

End-to-end test of the mobile app, run against the emulators in headless Chrome. Doctor: sign-up, profile,
booking, check-in, consultation, prescription, medical records, schedule. Then a patient signs up, finds that
doctor, books a free slot (the doctor's taken slot must be hidden), chats with the clinic and orders medicine.
Run `node scripts/seed-emulator.mjs --reset` first (it loads the catalogs).

```bash
npm run emulators                    # if not already running
chromedriver --port=4444             # ChromeDriver matching your Chrome version
cd mobile_app
flutter drive --driver=test_driver/integration_test.dart --target=integration_test/app_test.dart -d web-server --dart-define=USE_EMULATORS=true
```

## Production deployment

Do these steps in order. Everything after step 1 runs from this folder.

1. **Firebase project** (Blaze plan, needed for Cloud Functions), region `asia-south1` (Mumbai) for
   Firestore, Storage and Functions. Enable Authentication with Email/Password, Google and **Phone**.
2. **Config**: `.env.local` holds the Firebase web config, `VITE_ZEGO_APP_ID`, `VITE_PUBLIC_URL` and the
   `VITE_HOSPITAL_*` invoice details. Never put `VITE_ZEGO_SERVER_SECRET` in a production build.
   In `mobile_app`, run `flutterfire configure`. Build with `ZEGO_APP_ID` and `PORTAL_URL` only (no `ZEGO_APP_SIGN`).
3. **Secrets and function parameters**:
   ```bash
   npx firebase-tools functions:secrets:set ZEGO_SERVER_SECRET
   npx firebase-tools functions:secrets:set WHATSAPP_TOKEN      # optional: automatic WhatsApp confirmations
   ```
   On first deploy you are asked for `ZEGO_APP_ID`. For WhatsApp you are also asked for
   `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_API_VERSION` and `WHATSAPP_TEMPLATE`. The template is approved in Meta
   Business Manager, with body variables patient, doctor, date, time and token.
4. **Deploy**: `npm run build && npx firebase-tools deploy`. This deploys rules, indexes, functions and hosting.
5. **First admin**: create the user in Authentication, then add `users/<uid>` = `{ role: "admin" }`.
   Load the tariff and catalogs from the portal.
6. **Backups**: enable point-in-time recovery and a daily backup schedule:
   ```bash
   gcloud firestore databases update --database='(default)' --enable-pitr
   gcloud firestore backups schedules create --database='(default)' --recurrence=daily --retention=<period, e.g. 14w>
   ```
7. **Mobile**:
   - Android: `flutter build appbundle --dart-define-from-file=env.json`. Add the release SHA-1 and SHA-256 in
     Firebase project settings (needed for Google sign-in and phone auth).
   - iOS: build on a Mac (`flutter build ipa`). Add the APNs key for phone-auth silent push.
8. **Monitoring**: Cloud Logging alerts on function errors (`whatsapp send failed`, `zegoToken`) and a budget
   alert on the project.

## Known limits

- **Online payment** isn't integrated. Consultations are paid at the clinic, orders on delivery, and bills at
  the counter. Add Razorpay (or similar) with a server-side order and signature check.
- **Push notifications** (FCM) and medicine reminders aren't implemented.
- **Portal live lists** load bounded windows: appointments from 7 days ago, payments from 90 days ago, the
  first 300 patients and the latest 300 orders. Patient search and patient history query the server, so
  older data stays reachable. The windows are computed when the page loads.
- Patient-cancelled bookings keep their slot blocked for self-booking (staff can still book it).
- `flutter drive` on web reports a test that exceeds its timeout as passed. The E2E test therefore puts its
  own deadline on every wait (`within(...)`), so a hang fails loudly.
