import 'package:flutter/material.dart';
import 'package:zego_uikit_prebuilt_call/zego_uikit_prebuilt_call.dart';

import 'config.dart';

/// Full-screen 1:1 video call; returns when the call ends. Room id = appointment id, so the
/// patient joins from the portal link and lands in the same room.
/// Production: the `zegoToken` Cloud Function issues a room-scoped token (no secret in the app).
/// Local development only: pass ZEGO_APP_SIGN to skip the function.
Future<void> openVideoRoom(BuildContext context, {required String roomId, required String userId, required String userName, String? callKey}) async {
  if (zegoAppId == 0) throw Exception('Video calls are not configured (ZEGO_APP_ID)');
  var token = '';
  var callUserId = userId;
  if (zegoAppSign.isEmpty) {
    final r = await functions.httpsCallable('zegoToken').call<Map<String, dynamic>>({'roomId': roomId, 'userName': userName});
    token = r.data['token'] as String;
    callUserId = r.data['userId'] as String;
  }
  if (!context.mounted) return;
  await Navigator.of(context).push(MaterialPageRoute(
    builder: (_) => SafeArea(
      child: ZegoUIKitPrebuiltCall(
        appID: zegoAppId,
        appSign: zegoAppSign,
        token: token,
        userID: callUserId,
        userName: userName,
        callID: roomId,
        config: ZegoUIKitPrebuiltCallConfig.oneOnOneVideoCall(),
      ),
    ),
  ));
}
