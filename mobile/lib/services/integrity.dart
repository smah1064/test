import 'dart:io';

import 'package:flutter/services.dart';
import 'package:safe_device/safe_device.dart';

import '../config.dart';

class IntegrityProblem {
  const IntegrityProblem(this.code, this.title, this.message);
  final String code;
  final String title;
  final String message;
}

class IntegrityReport {
  IntegrityReport({required this.problems, required this.devMode, required this.rooted});
  final List<IntegrityProblem> problems;
  final bool devMode;
  final bool rooted;
  bool get ok => problems.isEmpty;
  bool get hasDevMode => problems.any((p) => p.code == 'DEV_MODE');
}

/// Checks that the phone hasn't been set up to fake attendance:
///  * Android Developer options / USB debugging off (needed for fake-GPS apps)
///  * not rooted / jailbroken (root-level GPS spoofers)
///  * a real phone, not an emulator
class Integrity {
  static const _channel = MethodChannel('attendance/integrity');

  static Future<IntegrityReport> check() async {
    final problems = <IntegrityProblem>[];
    var devMode = false;

    if (Platform.isAndroid) {
      try {
        final status = await _channel.invokeMapMethod<String, dynamic>('developerStatus');
        devMode = status?['developerOptions'] == true || status?['adb'] == true;
      } catch (_) {
        devMode = true; // fail closed: if we can't verify, don't allow
      }
      if (devMode && !allowDevModeForTesting) {
        problems.add(const IntegrityProblem(
          'DEV_MODE',
          'Developer options are turned on',
          'Attendance can\'t be recorded while Developer options are on, because they allow fake GPS apps.\n\n'
              'Open Settings → System → Developer options and turn the switch at the top OFF '
              '(on Samsung: Settings → Developer options). Then come back and tap "Check again".',
        ));
      }
    }

    final rooted = await SafeDevice.isJailBroken;
    if (rooted) {
      problems.add(IntegrityProblem(
        'ROOTED',
        Platform.isIOS ? 'This iPhone is jailbroken' : 'This phone is rooted',
        'Modified phones can fake their location, so they can\'t be used for attendance. '
            'Please use an unmodified phone or contact your admin.',
      ));
    }

    if (!allowDevModeForTesting && !await SafeDevice.isRealDevice) {
      problems.add(const IntegrityProblem(
        'EMULATOR',
        'Emulator detected',
        'Attendance must be recorded on a real phone.',
      ));
    }

    return IntegrityReport(problems: problems, devMode: devMode && !allowDevModeForTesting, rooted: rooted);
  }

  static Future<void> openDeveloperSettings() async {
    try {
      await _channel.invokeMethod('openDeveloperSettings');
    } catch (_) {}
  }

  static Future<String?> androidId() async {
    try {
      return await _channel.invokeMethod<String>('deviceId');
    } catch (_) {
      return null;
    }
  }
}
