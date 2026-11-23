import 'package:attendance_app/format.dart';
import 'package:attendance_app/l10n/language.dart';
import 'package:attendance_app/l10n/strings.dart';
import 'package:attendance_app/main.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';

void main() {
  const en = SEn();
  const ar = SAr();

  test('English time and date formatting', () {
    expect(formatTime(en, DateTime(2026, 11, 23, 9, 5)), '9:05 AM');
    expect(formatTime(en, DateTime(2026, 11, 23, 0, 30)), '12:30 AM');
    expect(formatTime(en, DateTime(2026, 11, 23, 17, 45)), '5:45 PM');
    expect(formatLongDate(en, DateTime(2026, 11, 23)), 'Monday, 23 November 2026');
    expect(formatDayHeader(en, '2026-11-23'), 'Mon 23 Nov');
    expect(monthKey(DateTime(2026, 3, 9)), '2026-03');
  });

  test('Arabic time and date formatting', () {
    expect(formatTime(ar, DateTime(2026, 11, 23, 9, 5)), '9:05 ص');
    expect(formatTime(ar, DateTime(2026, 11, 23, 17, 45)), '5:45 م');
    expect(formatLongDate(ar, DateTime(2026, 11, 23)), 'الاثنين، 23 نوفمبر 2026');
    expect(formatDayHeader(ar, '2026-11-27'), 'الجمعة 27 نوفمبر');
    expect(formatMonth(ar, DateTime(2026, 1)), 'يناير 2026');
  });

  test('Arabic day counts use the right plural form', () {
    expect(ar.daysAttended(1), 'يوم حضور واحد');
    expect(ar.daysAttended(2), 'يوما حضور');
    expect(ar.daysAttended(5), '5 أيام حضور');
    expect(ar.daysAttended(15), '15 يوم حضور');
    expect(en.daysAttended(1), '1 day attended');
  });

  testWidgets('login screen switches between English and Arabic (RTL)', (tester) async {
    FlutterSecureStorage.setMockInitialValues({});
    await tester.runAsync(LanguageController.load); // test device locale is English
    await tester.pumpWidget(const AttendanceApp());
    await tester.pumpAndSettle();

    expect(find.text('Employee code'), findsOneWidget);
    expect(Directionality.of(tester.element(find.text('Employee code'))), TextDirection.ltr);

    await tester.tap(find.text('العربية'));
    await tester.pumpAndSettle();

    expect(find.text('رمز الموظف'), findsOneWidget);
    expect(find.text('English'), findsOneWidget);
    expect(Directionality.of(tester.element(find.text('رمز الموظف'))), TextDirection.rtl);

    // Validation messages are translated too
    await tester.tap(find.widgetWithText(FilledButton, 'تسجيل الدخول'));
    await tester.pump();
    expect(find.text('أدخل رمز الموظف'), findsOneWidget);
    expect(find.text('أدخل كلمة المرور'), findsOneWidget);
  });
}
