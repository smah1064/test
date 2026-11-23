import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:device_info_plus/device_info_plus.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:geolocator/geolocator.dart';
import 'package:http/http.dart' as http;
import 'package:package_info_plus/package_info_plus.dart';
import 'package:uuid/uuid.dart';

import '../config.dart';
import 'integrity.dart';

class ApiException implements Exception {
  ApiException(this.message, {this.status = 0, this.code});
  final String message;
  final int status;
  final String? code;

  /// The session is no longer valid — send the user back to login.
  bool get mustLogin => status == 401 || code == 'DEVICE_MISMATCH';
  @override
  String toString() => message;
}

class Api {
  Api._();
  static final Api instance = Api._();

  final _storage = const FlutterSecureStorage();
  final _client = http.Client();
  String? _token;
  String? _deviceId;
  String _deviceModel = 'unknown';
  String _appVersion = '';

  bool get loggedIn => _token != null;

  Future<void> init() async {
    _token = await _storage.read(key: 'token');
    _deviceId = await _resolveDeviceId();
    try {
      final info = DeviceInfoPlugin();
      if (Platform.isAndroid) {
        final a = await info.androidInfo;
        _deviceModel = '${a.manufacturer} ${a.model} (Android ${a.version.release})';
      } else if (Platform.isIOS) {
        final i = await info.iosInfo;
        _deviceModel = '${i.utsname.machine} (iOS ${i.systemVersion})';
      }
      _appVersion = (await PackageInfo.fromPlatform()).version;
    } catch (_) {}
  }

  /// A stable ID for this phone. The server binds each employee to one phone,
  /// so a colleague can't check in for them from another device.
  Future<String> _resolveDeviceId() async {
    String? id;
    if (Platform.isAndroid) {
      id = await Integrity.androidId();
    } else if (Platform.isIOS) {
      try {
        id = (await DeviceInfoPlugin().iosInfo).identifierForVendor;
      } catch (_) {}
    }
    if (id != null && id.isNotEmpty) return '${Platform.operatingSystem}:$id';
    var stored = await _storage.read(key: 'device_id');
    if (stored == null) {
      stored = 'gen:${const Uuid().v4()}';
      await _storage.write(key: 'device_id', value: stored);
    }
    return stored;
  }

  Map<String, String> get _headers => {
        if (_token != null) 'authorization': 'Bearer $_token',
        'x-device-id': ?_deviceId,
        'user-agent': 'AttendanceApp/$_appVersion ($_deviceModel)',
      };

  Uri _u(String path, [Map<String, String>? q]) => Uri.parse('$apiBaseUrl$path').replace(queryParameters: q);

  Future<dynamic> _send(Future<http.Response> req) async {
    http.Response res;
    try {
      res = await req.timeout(const Duration(seconds: 45));
    } on TimeoutException {
      throw ApiException('The server took too long to answer. Check your internet and try again.');
    } on SocketException {
      throw ApiException('No connection to the server. Check your internet and try again.');
    } on http.ClientException {
      throw ApiException('No connection to the server. Check your internet and try again.');
    }
    dynamic body;
    try {
      body = jsonDecode(utf8.decode(res.bodyBytes));
    } catch (_) {
      body = null;
    }
    if (res.statusCode >= 400) {
      final msg = body is Map && body['error'] is String ? body['error'] as String : 'Server error (${res.statusCode})';
      final code = body is Map ? body['code'] as String? : null;
      if (res.statusCode == 401 || code == 'DEVICE_MISMATCH') await logout();
      throw ApiException(msg, status: res.statusCode, code: code);
    }
    return body;
  }

  Future<Map<String, dynamic>> login(String empCode, String password) async {
    final body = await _send(_client.post(
      _u('/api/auth/login'),
      headers: {..._headers, 'content-type': 'application/json'},
      body: jsonEncode({
        'emp_code': empCode.trim(),
        'password': password,
        'device_id': _deviceId,
        'device_model': _deviceModel,
      }),
    ));
    final user = body['user'] as Map<String, dynamic>;
    if (user['role'] != 'employee') {
      throw ApiException('Admins use the web dashboard, not the app.');
    }
    _token = body['token'] as String;
    await _storage.write(key: 'token', value: _token);
    return user;
  }

  Future<void> logout() async {
    _token = null;
    await _storage.delete(key: 'token');
  }

  Future<Map<String, dynamic>> me() async =>
      (await _send(_client.get(_u('/api/attendance/me'), headers: _headers))) as Map<String, dynamic>;

  Future<List<dynamic>> history(String month) async {
    final body = await _send(_client.get(_u('/api/attendance/history', {'month': month}), headers: _headers));
    return body['records'] as List<dynamic>;
  }

  Map<String, String> _punchFields(String type, Position? pos, IntegrityReport integrity) => {
        'type': type,
        if (pos != null) ...{
          'lat': pos.latitude.toString(),
          'lng': pos.longitude.toString(),
          'accuracy': pos.accuracy.toString(),
          'is_mocked': pos.isMocked.toString(),
        },
        'dev_mode': integrity.devMode.toString(),
        'rooted': integrity.rooted.toString(),
        'app_version': _appVersion,
      };

  /// Records a check-in or check-out with the selfie and GPS fix.
  Future<Map<String, dynamic>> punch({
    required String type,
    required Position position,
    required File selfie,
    required DateTime selfieTakenAt,
    required IntegrityReport integrity,
  }) async {
    final req = http.MultipartRequest('POST', _u('/api/attendance'))
      ..headers.addAll(_headers)
      ..fields.addAll(_punchFields(type, position, integrity))
      ..fields['capture_age_sec'] = DateTime.now().difference(selfieTakenAt).inSeconds.toString()
      ..files.add(await http.MultipartFile.fromPath('photo', selfie.path, filename: 'selfie.jpg'));
    final streamed = _client.send(req).then(http.Response.fromStream);
    return (await _send(streamed)) as Map<String, dynamic>;
  }

  /// Tells the server about a blocked attempt (developer mode, fake GPS, root)
  /// so it appears in the admins' security alerts. Errors are ignored.
  Future<void> reportBlocked(String type, Position? position, IntegrityReport integrity, {bool mocked = false}) async {
    try {
      final fields = _punchFields(type, position, integrity);
      if (mocked) fields['is_mocked'] = 'true';
      final req = http.MultipartRequest('POST', _u('/api/attendance'))
        ..headers.addAll(_headers)
        ..fields.addAll(fields);
      await _client.send(req).timeout(const Duration(seconds: 15));
    } catch (_) {}
  }
}
