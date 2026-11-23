// Small date/time formatting helpers (avoids pulling in the intl package).

const _months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const _weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

String _two(int n) => n.toString().padLeft(2, '0');

String formatTime(DateTime d) {
  final h = d.hour % 12 == 0 ? 12 : d.hour % 12;
  return '$h:${_two(d.minute)} ${d.hour < 12 ? 'AM' : 'PM'}';
}

String formatLongDate(DateTime d) => '${_weekdays[d.weekday - 1]}, ${d.day} ${_months[d.month - 1]} ${d.year}';

String formatMonth(DateTime d) => '${_months[d.month - 1]} ${d.year}';

String monthKey(DateTime d) => '${d.year}-${_two(d.month)}';

String formatDayHeader(String ymd) {
  final d = DateTime.parse(ymd);
  return '${_weekdays[d.weekday - 1].substring(0, 3)} ${d.day} ${_months[d.month - 1].substring(0, 3)}';
}
