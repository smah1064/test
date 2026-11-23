import 'package:attendance_app/format.dart';
import 'package:attendance_app/screens/login_screen.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';

void main() {
  test('time and date formatting', () {
    expect(formatTime(DateTime(2026, 11, 23, 9, 5)), '9:05 AM');
    expect(formatTime(DateTime(2026, 11, 23, 0, 30)), '12:30 AM');
    expect(formatTime(DateTime(2026, 11, 23, 17, 45)), '5:45 PM');
    expect(formatLongDate(DateTime(2026, 11, 23)), 'Monday, 23 November 2026');
    expect(monthKey(DateTime(2026, 3, 9)), '2026-03');
    expect(formatDayHeader('2026-11-23'), 'Mon 23 Nov');
  });

  testWidgets('login form validates empty fields', (tester) async {
    await tester.pumpWidget(MaterialApp(home: LoginScreen(onLoggedIn: () {})));
    expect(find.text('Employee code'), findsOneWidget);
    await tester.tap(find.widgetWithText(FilledButton, 'Log in'));
    await tester.pump();
    expect(find.text('Enter your employee code'), findsOneWidget);
    expect(find.text('Enter your password'), findsOneWidget);
  });
}
