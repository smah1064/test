import 'dart:async';
import 'dart:io';

import 'package:geolocator/geolocator.dart';

import '../config.dart';
import '../l10n/strings.dart';

class LocationProblem implements Exception {
  LocationProblem(this.issue, [this.detail]);
  final LocationIssue issue;
  final String? detail;

  /// 'location_settings' or 'app_settings' — what the user should open to fix it.
  String? get fix => switch (issue) {
        LocationIssue.serviceOff => 'location_settings',
        LocationIssue.permissionDeniedForever || LocationIssue.reducedAccuracy => 'app_settings',
        _ => null,
      };
  @override
  String toString() => '$issue ${detail ?? ''}';
}

class Locator {
  static LocationSettings _settings() {
    if (Platform.isAndroid) {
      return AndroidSettings(
        accuracy: LocationAccuracy.best,
        distanceFilter: 0,
        intervalDuration: const Duration(seconds: 1),
        maxUpdateAge: Duration.zero, // never use a cached fix
      );
    }
    return AppleSettings(accuracy: LocationAccuracy.best, distanceFilter: 0, allowBackgroundLocationUpdates: false);
  }

  static Future<void> ensureReady() async {
    if (!await Geolocator.isLocationServiceEnabled()) {
      throw LocationProblem(LocationIssue.serviceOff);
    }
    var perm = await Geolocator.checkPermission();
    if (perm == LocationPermission.denied) perm = await Geolocator.requestPermission();
    if (perm == LocationPermission.denied) {
      throw LocationProblem(LocationIssue.permissionDenied);
    }
    if (perm == LocationPermission.deniedForever) {
      throw LocationProblem(LocationIssue.permissionDeniedForever);
    }
    if (await Geolocator.getLocationAccuracy() == LocationAccuracyStatus.reduced) {
      throw LocationProblem(LocationIssue.reducedAccuracy);
    }
  }

  /// Listens to live GPS updates and returns the first fix that is precise
  /// enough, or the best one seen when [timeout] passes.
  static Future<Position> bestFix({Duration timeout = const Duration(seconds: 25)}) async {
    await ensureReady();
    Position? best;
    final done = Completer<Position>();
    late final StreamSubscription<Position> sub;
    final timer = Timer(timeout, () {
      if (!done.isCompleted) {
        if (best != null) {
          done.complete(best!);
        } else {
          done.completeError(LocationProblem(LocationIssue.noFix));
        }
      }
    });
    sub = Geolocator.getPositionStream(locationSettings: _settings()).listen(
      (p) {
        // A mocked fix is returned immediately so it can be blocked and reported.
        if (p.isMocked) {
          if (!done.isCompleted) done.complete(p);
          return;
        }
        if (best == null || p.accuracy < best!.accuracy) best = p;
        if (p.accuracy <= targetAccuracyM && !done.isCompleted) done.complete(p);
      },
      onError: (Object e) {
        if (!done.isCompleted) done.completeError(LocationProblem(LocationIssue.error, '$e'));
      },
    );
    try {
      return await done.future;
    } finally {
      timer.cancel();
      await sub.cancel();
    }
  }
}
