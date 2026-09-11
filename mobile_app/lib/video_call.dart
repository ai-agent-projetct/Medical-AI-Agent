// Zego's Flutter call kit is Android/iOS only; the web build joins the same room via the portal.
export 'video_call_mobile.dart' if (dart.library.js_interop) 'video_call_web.dart';
