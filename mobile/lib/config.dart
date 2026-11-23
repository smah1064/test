import 'package:flutter/foundation.dart';

/// Server address. Set it when building:
///   flutter build apk --release --dart-define=API_URL=https://attendance.yourcompany.com
/// The default points an Android emulator at a server running on your computer.
const String apiBaseUrl = String.fromEnvironment('API_URL', defaultValue: 'http://10.0.2.2:3000');

/// Developers need Developer options on to debug the app over USB. Only debug
/// builds started with --dart-define=ALLOW_DEV_MODE=true skip that check;
/// release builds always enforce it (kDebugMode is a compile-time constant).
const bool allowDevModeForTesting = kDebugMode && bool.fromEnvironment('ALLOW_DEV_MODE');

/// Only accept GPS fixes at least this precise (metres). The server enforces
/// its own limit too (MAX_GPS_ACCURACY_M, default 100).
const double targetAccuracyM = 30;
const double maxAccuracyM = 100;
