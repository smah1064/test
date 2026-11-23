import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';
import 'package:safe_device/safe_device.dart';
import 'package:safe_device/safe_device_config.dart';

import 'screens/home_screen.dart';
import 'screens/login_screen.dart';
import 'services/api.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // We read the mock flag from each GPS fix ourselves (geolocator), so the
  // plugin's own background location listener isn't needed.
  SafeDevice.init(const SafeDeviceConfig(mockLocationCheckEnabled: false));
  await SystemChrome.setPreferredOrientations([DeviceOrientation.portraitUp]);
  await Api.instance.init();
  runApp(const AttendanceApp());
}

class AttendanceApp extends StatefulWidget {
  const AttendanceApp({super.key});

  @override
  State<AttendanceApp> createState() => _AttendanceAppState();
}

class _AttendanceAppState extends State<AttendanceApp> {
  bool _loggedIn = Api.instance.loggedIn;
  String? _loginMessage;

  @override
  Widget build(BuildContext context) {
    const seed = Color(0xFF1F5FBF);
    return MaterialApp(
      title: 'Attendance',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(colorScheme: ColorScheme.fromSeed(seedColor: seed)),
      darkTheme: ThemeData(colorScheme: ColorScheme.fromSeed(seedColor: seed, brightness: Brightness.dark)),
      home: _loggedIn
          ? HomeScreen(
              onLoggedOut: (msg) => setState(() {
                _loggedIn = false;
                _loginMessage = msg;
              }),
            )
          : LoginScreen(
              message: _loginMessage,
              onLoggedIn: () => setState(() {
                _loggedIn = true;
                _loginMessage = null;
              }),
            ),
    );
  }
}
