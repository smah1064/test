import 'dart:async';
import 'dart:io';

import 'package:geolocator/geolocator.dart';

import '../config.dart';

class LocationProblem implements Exception {
  LocationProblem(this.message, {this.fix});
  final String message;

  /// 'location_settings' or 'app_settings' — what the user should open to fix it.
  final String? fix;
  @override
  String toString() => message;
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
      throw LocationProblem('Location (GPS) is turned off. Turn it on to check in.', fix: 'location_settings');
    }
    var perm = await Geolocator.checkPermission();
    if (perm == LocationPermission.denied) perm = await Geolocator.requestPermission();
    if (perm == LocationPermission.denied) {
      throw LocationProblem('Location permission is needed to check in.');
    }
    if (perm == LocationPermission.deniedForever) {
      throw LocationProblem('Location permission was denied. Allow it in the app settings.', fix: 'app_settings');
    }
    if (await Geolocator.getLocationAccuracy() == LocationAccuracyStatus.reduced) {
      throw LocationProblem('Please allow "Precise location" for this app in its settings.', fix: 'app_settings');
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
          done.completeError(LocationProblem('Couldn\'t get your location. Move near a window or outside and try again.'));
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
        if (!done.isCompleted) done.completeError(LocationProblem('Location error: $e'));
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
