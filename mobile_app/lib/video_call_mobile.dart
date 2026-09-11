import 'package:flutter/material.dart';
import 'package:zego_uikit_prebuilt_call/zego_uikit_prebuilt_call.dart';

import 'config.dart';

/// Full-screen 1:1 video call; returns when the call ends. Room id = appointment id, so the
/// patient joins from the portal link and lands in the same room.
Future<void> openVideoRoom(BuildContext context, {required String roomId, required String userId, required String userName}) {
  if (zegoAppId == 0 || zegoAppSign.isEmpty) {
    throw Exception('Video calls are not configured (ZEGO_APP_ID / ZEGO_APP_SIGN)');
  }
  return Navigator.of(context).push(MaterialPageRoute(
    builder: (_) => SafeArea(
      child: ZegoUIKitPrebuiltCall(
        appID: zegoAppId,
        appSign: zegoAppSign,
        userID: userId,
        userName: userName,
        callID: roomId,
        config: ZegoUIKitPrebuiltCallConfig.oneOnOneVideoCall(),
      ),
    ),
  ));
}
