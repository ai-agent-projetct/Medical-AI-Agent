import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';

import 'db.dart';
import 'firebase_options.dart';
import 'screens/auth.dart';
import 'screens/home.dart';
import 'screens/profile.dart';
import 'ui.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  try {
    await Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform);
  } catch (e) {
    runApp(MaterialApp(home: Scaffold(body: Center(child: Padding(padding: const EdgeInsets.all(24), child: Text('$e'))))));
    return;
  }
  runApp(const App());
}

class App extends StatelessWidget {
  const App({super.key});

  @override
  Widget build(BuildContext context) => MaterialApp(
        title: 'AI Hospital Agent',
        debugShowCheckedModeBanner: false,
        theme: appTheme,
        home: StreamBuilder<User?>(
          stream: FirebaseAuth.instance.authStateChanges(),
          builder: (context, auth) {
            if (auth.connectionState == ConnectionState.waiting) return const SplashScreen();
            if (auth.data == null) return const LoginScreen();
            return StreamBuilder(
              key: ValueKey(auth.data!.uid),
              stream: Db.doctor().snapshots(),
              builder: (context, doc) {
                if (!doc.hasData) return const SplashScreen();
                if (doc.data!.data()?['profileComplete'] != true) return const EditProfileScreen(firstTime: true);
                return const HomeShell();
              },
            );
          },
        ),
      );
}
