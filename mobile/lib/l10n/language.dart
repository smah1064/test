import 'dart:ui' show PlatformDispatcher;

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:material_ui/material_ui.dart';

/// The app language: the phone's language by default (Arabic if the phone is
/// in Arabic, otherwise English), or whatever the user picked in the app.
class LanguageController extends ValueNotifier<Locale> {
  LanguageController._(super.value);

  static const _key = 'language';
  static const _storage = FlutterSecureStorage();
  static late LanguageController instance;

  static Future<void> load() async {
    String? saved;
    try {
      saved = await _storage.read(key: _key);
    } catch (_) {}
    final code = saved ?? (PlatformDispatcher.instance.locale.languageCode == 'ar' ? 'ar' : 'en');
    instance = LanguageController._(Locale(code));
  }

  String get code => value.languageCode;

  Future<void> toggle() => set(code == 'ar' ? 'en' : 'ar');

  Future<void> set(String code) async {
    value = Locale(code);
    try {
      await _storage.write(key: _key, value: code);
    } catch (_) {}
  }
}
