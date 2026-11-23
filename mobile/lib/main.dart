import 'package:flutter/services.dart';
import 'package:material_ui/material_ui.dart';
import 'package:safe_device/safe_device.dart';
import 'package:safe_device/safe_device_config.dart';

import 'l10n/language.dart';
import 'l10n/strings.dart';
import 'screens/home_screen.dart';
import 'screens/login_screen.dart';
import 'services/api.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // We read the mock flag from each GPS fix ourselves (geolocator), so the
  // plugin's own background location listener isn't needed.
  SafeDevice.init(const SafeDeviceConfig(mockLocationCheckEnabled: false));
  await SystemChrome.setPreferredOrientations([DeviceOrientation.portraitUp]);
  await LanguageController.load();
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
    // Rebuilds the whole app (and flips it to right-to-left for Arabic)
    // whenever the language changes.
    return ValueListenableBuilder<Locale>(
      valueListenable: LanguageController.instance,
      builder: (context, locale, _) => _app(locale, seed),
    );
  }

  Widget _app(Locale locale, Color seed) {
    return MaterialApp(
      onGenerateTitle: (context) => S.of(context).appTitle,
      locale: locale,
      supportedLocales: S.supportedLocales,
      localizationsDelegates: const [S.delegate, ...GlobalMaterialLocalizations.delegates],
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
