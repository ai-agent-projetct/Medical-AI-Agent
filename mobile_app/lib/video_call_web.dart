import 'package:flutter/widgets.dart';
import 'package:url_launcher/url_launcher.dart';

import 'config.dart';

/// Opens the portal's ZegoCloud room in a new tab. Returns once the tab is opened.
Future<void> openVideoRoom(BuildContext context, {required String roomId, required String userId, required String userName}) async {
  final url = Uri.parse('${callLink(roomId)}?name=${Uri.encodeComponent(userName)}');
  if (!await launchUrl(url, webOnlyWindowName: '_blank')) throw Exception('Could not open the video room');
}
