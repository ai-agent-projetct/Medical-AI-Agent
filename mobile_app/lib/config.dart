// Build-time settings. Pass with: flutter run --dart-define-from-file=env.json  (see env.example.json)

import 'package:cloud_functions/cloud_functions.dart';

/// ZegoCloud console → AppID. Calls use room-scoped tokens from the `zegoToken` Cloud Function.
/// ZEGO_APP_SIGN is for local development only: never ship it (it would expose the project key).
const zegoAppId = int.fromEnvironment('ZEGO_APP_ID');
const zegoAppSign = String.fromEnvironment('ZEGO_APP_SIGN');

/// Cloud Functions are deployed to Mumbai (functions/index.js).
final functions = FirebaseFunctions.instanceFor(region: 'asia-south1');

/// Public URL of the React portal. Patients join video calls at `$portalUrl/#/call/<appointmentId>`,
/// and the Flutter web build opens the same page for the doctor (Zego's Flutter kit is mobile-only).
const portalUrl = String.fromEnvironment('PORTAL_URL', defaultValue: 'http://localhost:3000');

/// Patient join link. [callKey] (set on online appointments by the server) lets someone without an
/// account get a token for this one room only.
String callLink(String appointmentId, [String? callKey]) => '$portalUrl/#/call/$appointmentId?k=${callKey ?? ''}';

/// `--dart-define=USE_EMULATORS=true`: run against the local Firebase Emulator Suite
/// (`npm run emulators` in the portal folder) with a demo project — no real keys needed.
const useEmulators = bool.fromEnvironment('USE_EMULATORS');

/// Emulator host for a physical phone on the same Wi-Fi (the PC's LAN IP). Default: 10.0.2.2 on the
/// Android emulator, localhost elsewhere.
const emulatorHost = String.fromEnvironment('EMULATOR_HOST');

/// Version of the Terms & Privacy notice users consent to (DPDP Act 2023). Bump when the text changes.
const consentVersion = '2026-11';
