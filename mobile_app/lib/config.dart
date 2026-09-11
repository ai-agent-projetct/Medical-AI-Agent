// Build-time settings. Pass with: flutter run --dart-define-from-file=env.json  (see env.example.json)

/// ZegoCloud console → AppID / AppSign. AppSign is Zego's test-mode auth; switch to server-issued
/// tokens (ZegoUIKitPrebuiltCall.token) before production.
const zegoAppId = int.fromEnvironment('ZEGO_APP_ID');
const zegoAppSign = String.fromEnvironment('ZEGO_APP_SIGN');

/// Public URL of the React portal. Patients join video calls at `$portalUrl/#/call/<appointmentId>`,
/// and the Flutter web build opens the same page for the doctor (Zego's Flutter kit is mobile-only).
const portalUrl = String.fromEnvironment('PORTAL_URL', defaultValue: 'http://localhost:3000');

String callLink(String appointmentId) => '$portalUrl/#/call/$appointmentId';
