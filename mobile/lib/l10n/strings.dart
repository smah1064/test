import 'package:flutter/foundation.dart';
import 'package:material_ui/material_ui.dart';

/// Problems found by the phone checks / location service, translated in the UI.
enum IntegrityCode { devMode, rooted, emulator }

enum LocationIssue { serviceOff, permissionDenied, permissionDeniedForever, reducedAccuracy, noFix, error }

/// All text shown in the app. Each language implements every getter, so a
/// missing translation is a compile error.
abstract class S {
  const S();

  static S of(BuildContext context) => Localizations.of<S>(context, S)!;
  static const LocalizationsDelegate<S> delegate = _SDelegate();
  static const supportedLocales = [Locale('en'), Locale('ar')];

  static S forLanguage(String code) => code == 'ar' ? const SAr() : const SEn();

  String get languageCode;

  /// Name of the *other* language, shown on the language switch button.
  String get switchLanguageLabel;

  // General
  String get appTitle;
  String get ok;
  String get cancel;
  String get retry;
  String get done;
  String get tryAgain;
  String get openAppSettings;
  String get locationSettings;

  // Login
  String get loginSubtitle;
  String get employeeCode;
  String get password;
  String get logIn;
  String get enterEmployeeCode;
  String get enterPassword;
  String get deviceLinkNote;
  String get adminsUseDashboard;

  // Home
  String hello(String name);
  String workLocation(String name);
  String get workLocationAny;
  String get youAreCheckedIn;
  String get youAreNotCheckedIn;
  String get checkIn;
  String get checkOut;
  String get today;
  String get noPunchesToday;
  String get checkedIn;
  String get checkedOut;
  String punchedAt(String time, String site);
  String get myHistory;
  String get logOut;
  String get logOutQuestion;
  String get fixBeforeCheckIn;
  String get notRecorded;
  String somethingWentWrong(String detail);
  String get stepSecurity;
  String get stepLocation;
  String get stepSelfie;
  String get stepVerifying;
  String get stepSending;
  String get mockLocationDetected;
  String get changeLanguage;

  // Blocked screen
  String get attendanceBlocked;
  String get blockedHeadline;
  String get reportedToAdmin;
  String get openDeveloperOptions;
  String get checkAgain;
  String get stillNotFixed;
  String integrityTitle(IntegrityCode code, {required bool ios});
  String integrityMessage(IntegrityCode code);

  // Location
  String locationIssue(LocationIssue issue, [String? detail]);

  // Selfie
  String selfieTitle({required bool checkIn});
  String get noFrontCamera;
  String get cameraPermissionNeeded;
  String cameraError(String detail);
  String photoError(String detail);
  String get retake;
  String get usePhoto;
  String get lookAtCamera;

  // History
  String get myAttendance;
  String daysAttended(int n);
  String get noAttendanceThisMonth;
  String get inShort;
  String get outShort;

  // Network
  String get networkError;
  String get timeoutError;
  String serverError(int status);

  // Dates
  List<String> get months;
  List<String> get weekdays; // Monday first
  String get am;
  String get pm;
}

class _SDelegate extends LocalizationsDelegate<S> {
  const _SDelegate();
  @override
  bool isSupported(Locale locale) => ['en', 'ar'].contains(locale.languageCode);
  @override
  Future<S> load(Locale locale) => SynchronousFuture(S.forLanguage(locale.languageCode));
  @override
  bool shouldReload(_SDelegate old) => false;
}

// ---------------------------------------------------------------------------
class SEn extends S {
  const SEn();
  @override
  String get languageCode => 'en';
  @override
  String get switchLanguageLabel => 'العربية';

  @override
  String get appTitle => 'Attendance';
  @override
  String get ok => 'OK';
  @override
  String get cancel => 'Cancel';
  @override
  String get retry => 'Retry';
  @override
  String get done => 'Done';
  @override
  String get tryAgain => 'Try again';
  @override
  String get openAppSettings => 'App settings';
  @override
  String get locationSettings => 'Location settings';

  @override
  String get loginSubtitle => 'Log in with the code your admin gave you';
  @override
  String get employeeCode => 'Employee code';
  @override
  String get password => 'Password';
  @override
  String get logIn => 'Log in';
  @override
  String get enterEmployeeCode => 'Enter your employee code';
  @override
  String get enterPassword => 'Enter your password';
  @override
  String get deviceLinkNote => 'Your account will be linked to this phone the first time you log in.';
  @override
  String get adminsUseDashboard => 'Admins use the web dashboard, not the app.';

  @override
  String hello(String name) => 'Hello, $name';
  @override
  String workLocation(String name) => 'Work location: $name';
  @override
  String get workLocationAny => 'Work location: any company site';
  @override
  String get youAreCheckedIn => 'You are checked in';
  @override
  String get youAreNotCheckedIn => 'You are not checked in';
  @override
  String get checkIn => 'Check in';
  @override
  String get checkOut => 'Check out';
  @override
  String get today => 'Today';
  @override
  String get noPunchesToday => 'No check-ins yet today.';
  @override
  String get checkedIn => 'Checked in';
  @override
  String get checkedOut => 'Checked out';
  @override
  String punchedAt(String time, String site) => '$time at $site';
  @override
  String get myHistory => 'My history';
  @override
  String get logOut => 'Log out';
  @override
  String get logOutQuestion => 'Log out?';
  @override
  String get fixBeforeCheckIn => 'Fix this before you can check in.';
  @override
  String get notRecorded => 'Not recorded';
  @override
  String somethingWentWrong(String detail) => 'Something went wrong: $detail';
  @override
  String get stepSecurity => 'Checking phone security…';
  @override
  String get stepLocation => 'Getting your location…';
  @override
  String get stepSelfie => 'Taking selfie…';
  @override
  String get stepVerifying => 'Verifying…';
  @override
  String get stepSending => 'Sending…';
  @override
  String get mockLocationDetected =>
      'A fake GPS / mock location app was detected. Uninstall it, turn off Developer options and try again.\n\n'
      'This attempt has been reported to your admin.';
  @override
  String get changeLanguage => 'Change language';

  @override
  String get attendanceBlocked => 'Attendance blocked';
  @override
  String get blockedHeadline => 'This phone can\'t record attendance right now';
  @override
  String get reportedToAdmin => 'This attempt has been reported to your admin.';
  @override
  String get openDeveloperOptions => 'Open Developer options';
  @override
  String get checkAgain => 'Check again';
  @override
  String get stillNotFixed => 'Still not fixed.';
  @override
  String integrityTitle(IntegrityCode code, {required bool ios}) => switch (code) {
        IntegrityCode.devMode => 'Developer options are turned on',
        IntegrityCode.rooted => ios ? 'This iPhone is jailbroken' : 'This phone is rooted',
        IntegrityCode.emulator => 'Emulator detected',
      };
  @override
  String integrityMessage(IntegrityCode code) => switch (code) {
        IntegrityCode.devMode =>
          'Attendance can\'t be recorded while Developer options are on, because they allow fake GPS apps.\n\n'
              'Open Settings → System → Developer options and turn the switch at the top OFF '
              '(on Samsung: Settings → Developer options). Then come back and tap "Check again".',
        IntegrityCode.rooted =>
          'Modified phones can fake their location, so they can\'t be used for attendance. '
              'Please use an unmodified phone or contact your admin.',
        IntegrityCode.emulator => 'Attendance must be recorded on a real phone.',
      };

  @override
  String locationIssue(LocationIssue issue, [String? detail]) => switch (issue) {
        LocationIssue.serviceOff => 'Location (GPS) is turned off. Turn it on to check in.',
        LocationIssue.permissionDenied => 'Location permission is needed to check in.',
        LocationIssue.permissionDeniedForever => 'Location permission was denied. Allow it in the app settings.',
        LocationIssue.reducedAccuracy => 'Please allow "Precise location" for this app in its settings.',
        LocationIssue.noFix => 'Couldn\'t get your location. Move near a window or outside and try again.',
        LocationIssue.error => 'Location error: ${detail ?? ''}',
      };

  @override
  String selfieTitle({required bool checkIn}) => checkIn ? 'Check-in selfie' : 'Check-out selfie';
  @override
  String get noFrontCamera => 'This phone has no front camera.';
  @override
  String get cameraPermissionNeeded => 'Camera permission is needed to take your attendance selfie.';
  @override
  String cameraError(String detail) => 'Camera error: $detail';
  @override
  String photoError(String detail) => 'Couldn\'t take the photo: $detail';
  @override
  String get retake => 'Retake';
  @override
  String get usePhoto => 'Use photo';
  @override
  String get lookAtCamera => 'Look at the camera. Your face must be clearly visible.';

  @override
  String get myAttendance => 'My attendance';
  @override
  String daysAttended(int n) => '$n day${n == 1 ? '' : 's'} attended';
  @override
  String get noAttendanceThisMonth => 'No attendance this month';
  @override
  String get inShort => 'In';
  @override
  String get outShort => 'Out';

  @override
  String get networkError => 'No connection to the server. Check your internet and try again.';
  @override
  String get timeoutError => 'The server took too long to answer. Check your internet and try again.';
  @override
  String serverError(int status) => 'Server error ($status)';

  @override
  List<String> get months => const [
        'January', 'February', 'March', 'April', 'May', 'June', //
        'July', 'August', 'September', 'October', 'November', 'December',
      ];
  @override
  List<String> get weekdays => const ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  @override
  String get am => 'AM';
  @override
  String get pm => 'PM';
}

// ---------------------------------------------------------------------------
class SAr extends S {
  const SAr();
  @override
  String get languageCode => 'ar';
  @override
  String get switchLanguageLabel => 'English';

  @override
  String get appTitle => 'الحضور';
  @override
  String get ok => 'حسنًا';
  @override
  String get cancel => 'إلغاء';
  @override
  String get retry => 'إعادة المحاولة';
  @override
  String get done => 'تم';
  @override
  String get tryAgain => 'حاول مرة أخرى';
  @override
  String get openAppSettings => 'إعدادات التطبيق';
  @override
  String get locationSettings => 'إعدادات الموقع';

  @override
  String get loginSubtitle => 'سجّل الدخول بالرمز الذي أعطاك إياه المسؤول';
  @override
  String get employeeCode => 'رمز الموظف';
  @override
  String get password => 'كلمة المرور';
  @override
  String get logIn => 'تسجيل الدخول';
  @override
  String get enterEmployeeCode => 'أدخل رمز الموظف';
  @override
  String get enterPassword => 'أدخل كلمة المرور';
  @override
  String get deviceLinkNote => 'سيتم ربط حسابك بهذا الجوال عند أول تسجيل دخول.';
  @override
  String get adminsUseDashboard => 'يستخدم المسؤولون لوحة التحكم على الويب وليس التطبيق.';

  @override
  String hello(String name) => 'مرحبًا، $name';
  @override
  String workLocation(String name) => 'موقع العمل: $name';
  @override
  String get workLocationAny => 'موقع العمل: أي موقع للشركة';
  @override
  String get youAreCheckedIn => 'أنت مسجّل حضور';
  @override
  String get youAreNotCheckedIn => 'لم تسجّل حضورك';
  @override
  String get checkIn => 'تسجيل الحضور';
  @override
  String get checkOut => 'تسجيل الانصراف';
  @override
  String get today => 'اليوم';
  @override
  String get noPunchesToday => 'لا يوجد تسجيل اليوم بعد.';
  @override
  String get checkedIn => 'تم تسجيل الحضور';
  @override
  String get checkedOut => 'تم تسجيل الانصراف';
  @override
  String punchedAt(String time, String site) => '$time في $site';
  @override
  String get myHistory => 'سجلّي';
  @override
  String get logOut => 'تسجيل الخروج';
  @override
  String get logOutQuestion => 'تسجيل الخروج؟';
  @override
  String get fixBeforeCheckIn => 'يجب إصلاح هذا قبل تسجيل الحضور.';
  @override
  String get notRecorded => 'لم يتم التسجيل';
  @override
  String somethingWentWrong(String detail) => 'حدث خطأ: $detail';
  @override
  String get stepSecurity => 'جارٍ فحص أمان الجوال…';
  @override
  String get stepLocation => 'جارٍ تحديد موقعك…';
  @override
  String get stepSelfie => 'التقاط صورة السيلفي…';
  @override
  String get stepVerifying => 'جارٍ التحقق…';
  @override
  String get stepSending => 'جارٍ الإرسال…';
  @override
  String get mockLocationDetected =>
      'تم اكتشاف تطبيق موقع وهمي (GPS مزيف). احذفه وأوقف خيارات المطوّر ثم حاول مرة أخرى.\n\n'
      'تم إبلاغ المسؤول بهذه المحاولة.';
  @override
  String get changeLanguage => 'تغيير اللغة';

  @override
  String get attendanceBlocked => 'تم إيقاف تسجيل الحضور';
  @override
  String get blockedHeadline => 'لا يمكن تسجيل الحضور من هذا الجوال حاليًا';
  @override
  String get reportedToAdmin => 'تم إبلاغ المسؤول بهذه المحاولة.';
  @override
  String get openDeveloperOptions => 'فتح خيارات المطوّر';
  @override
  String get checkAgain => 'تحقق مرة أخرى';
  @override
  String get stillNotFixed => 'لم يتم الإصلاح بعد.';
  @override
  String integrityTitle(IntegrityCode code, {required bool ios}) => switch (code) {
        IntegrityCode.devMode => 'خيارات المطوّر مفعّلة',
        IntegrityCode.rooted => ios ? 'هذا الآيفون مكسور الحماية (جيلبريك)' : 'هذا الجوال مكسور الحماية (روت)',
        IntegrityCode.emulator => 'تم اكتشاف محاكي',
      };
  @override
  String integrityMessage(IntegrityCode code) => switch (code) {
        IntegrityCode.devMode =>
          'لا يمكن تسجيل الحضور وخيارات المطوّر مفعّلة، لأنها تسمح باستخدام تطبيقات الموقع الوهمي.\n\n'
              'افتح الإعدادات ← النظام ← خيارات المطوّر وأوقف المفتاح في الأعلى '
              '(في سامسونج: الإعدادات ← خيارات المطوّر). ثم عُد واضغط «تحقق مرة أخرى».',
        IntegrityCode.rooted =>
          'الأجهزة المعدّلة يمكنها تزييف الموقع، لذلك لا يمكن استخدامها لتسجيل الحضور. '
              'يرجى استخدام جوال غير معدّل أو التواصل مع المسؤول.',
        IntegrityCode.emulator => 'يجب تسجيل الحضور من جوال حقيقي.',
      };

  @override
  String locationIssue(LocationIssue issue, [String? detail]) => switch (issue) {
        LocationIssue.serviceOff => 'خدمة الموقع (GPS) متوقفة. شغّلها لتسجيل الحضور.',
        LocationIssue.permissionDenied => 'يلزم السماح بالوصول إلى الموقع لتسجيل الحضور.',
        LocationIssue.permissionDeniedForever => 'تم رفض إذن الموقع. اسمح به من إعدادات التطبيق.',
        LocationIssue.reducedAccuracy => 'يرجى تفعيل «الموقع الدقيق» لهذا التطبيق من إعداداته.',
        LocationIssue.noFix => 'تعذّر تحديد موقعك. اقترب من نافذة أو اخرج وحاول مرة أخرى.',
        LocationIssue.error => 'خطأ في الموقع: ${detail ?? ''}',
      };

  @override
  String selfieTitle({required bool checkIn}) => checkIn ? 'سيلفي الحضور' : 'سيلفي الانصراف';
  @override
  String get noFrontCamera => 'لا توجد كاميرا أمامية في هذا الجوال.';
  @override
  String get cameraPermissionNeeded => 'يلزم السماح باستخدام الكاميرا لالتقاط صورة الحضور.';
  @override
  String cameraError(String detail) => 'خطأ في الكاميرا: $detail';
  @override
  String photoError(String detail) => 'تعذّر التقاط الصورة: $detail';
  @override
  String get retake => 'إعادة الالتقاط';
  @override
  String get usePhoto => 'استخدام الصورة';
  @override
  String get lookAtCamera => 'انظر إلى الكاميرا. يجب أن يظهر وجهك بوضوح.';

  @override
  String get myAttendance => 'سجل حضوري';
  @override
  String daysAttended(int n) => switch (n) {
        0 => 'لا توجد أيام حضور',
        1 => 'يوم حضور واحد',
        2 => 'يوما حضور',
        >= 3 && <= 10 => '$n أيام حضور',
        _ => '$n يوم حضور',
      };
  @override
  String get noAttendanceThisMonth => 'لا يوجد حضور هذا الشهر';
  @override
  String get inShort => 'حضور';
  @override
  String get outShort => 'انصراف';

  @override
  String get networkError => 'لا يوجد اتصال بالخادم. تحقق من الإنترنت وحاول مرة أخرى.';
  @override
  String get timeoutError => 'استغرق الخادم وقتًا طويلًا للرد. تحقق من الإنترنت وحاول مرة أخرى.';
  @override
  String serverError(int status) => 'خطأ في الخادم ($status)';

  @override
  List<String> get months => const [
        'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', //
        'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
      ];
  @override
  List<String> get weekdays => const ['الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت', 'الأحد'];
  @override
  String get am => 'ص';
  @override
  String get pm => 'م';
}
