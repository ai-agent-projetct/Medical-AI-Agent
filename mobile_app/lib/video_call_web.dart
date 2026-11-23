import 'package:flutter/widgets.dart';
import 'package:url_launcher/url_launcher.dart';

import 'config.dart';

/// Opens the portal's ZegoCloud room in a new tab (the portal gets the room token from the
/// `zegoToken` function using the appointment's call key). Returns once the tab is opened.
Future<void> openVideoRoom(BuildContext context, {required String roomId, required String userId, required String userName, String? callKey}) async {
  if (callKey == null) throw Exception('The video link is still being prepared. Try again in a few seconds.');
  final url = Uri.parse('${callLink(roomId, callKey)}&name=${Uri.encodeComponent(userName)}');
  if (!await launchUrl(url, webOnlyWindowName: '_blank')) throw Exception('Could not open the video room');
}
