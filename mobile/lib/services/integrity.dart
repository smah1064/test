import 'dart:io';

import 'package:flutter/services.dart';
import 'package:safe_device/safe_device.dart';

import '../config.dart';
import '../l10n/strings.dart';

class IntegrityReport {
  IntegrityReport({required this.problems, required this.devMode, required this.rooted});
  final List<IntegrityCode> problems;
  final bool devMode;
  final bool rooted;
  bool get ok => problems.isEmpty;
}

/// Checks that the phone hasn't been set up to fake attendance:
///  * Android Developer options / USB debugging off (needed for fake-GPS apps)
///  * not rooted / jailbroken (root-level GPS spoofers)
///  * a real phone, not an emulator
class Integrity {
  static const _channel = MethodChannel('attendance/integrity');

  static Future<IntegrityReport> check() async {
    final problems = <IntegrityCode>[];
    var devMode = false;

    if (Platform.isAndroid) {
      try {
        final status = await _channel.invokeMapMethod<String, dynamic>('developerStatus');
        devMode = status?['developerOptions'] == true || status?['adb'] == true;
      } catch (_) {
        devMode = true; // fail closed: if we can't verify, don't allow
      }
      if (devMode && !allowDevModeForTesting) {
        problems.add(IntegrityCode.devMode);
      }
    }

    final rooted = await SafeDevice.isJailBroken;
    if (rooted) {
      problems.add(IntegrityCode.rooted);
    }

    if (!allowDevModeForTesting && !await SafeDevice.isRealDevice) {
      problems.add(IntegrityCode.emulator);
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
