// Small date/time formatting helpers (avoids pulling in the intl package).
// Digits stay Western (0-9) in both languages, as is common in Gulf apps.
import 'l10n/strings.dart';

String _two(int n) => n.toString().padLeft(2, '0');

String formatTime(S s, DateTime d) {
  final h = d.hour % 12 == 0 ? 12 : d.hour % 12;
  return '$h:${_two(d.minute)} ${d.hour < 12 ? s.am : s.pm}';
}

String formatLongDate(S s, DateTime d) =>
    s.languageCode == 'ar'
        ? '${s.weekdays[d.weekday - 1]}، ${d.day} ${s.months[d.month - 1]} ${d.year}'
        : '${s.weekdays[d.weekday - 1]}, ${d.day} ${s.months[d.month - 1]} ${d.year}';

String formatMonth(S s, DateTime d) => '${s.months[d.month - 1]} ${d.year}';

String monthKey(DateTime d) => '${d.year}-${_two(d.month)}';

String formatDayHeader(S s, String ymd) {
  final d = DateTime.parse(ymd);
  if (s.languageCode == 'ar') return '${s.weekdays[d.weekday - 1]} ${d.day} ${s.months[d.month - 1]}';
  return '${s.weekdays[d.weekday - 1].substring(0, 3)} ${d.day} ${s.months[d.month - 1].substring(0, 3)}';
}
