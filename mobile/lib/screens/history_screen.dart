import 'package:material_ui/material_ui.dart';

import '../format.dart';
import '../services/api.dart';

class HistoryScreen extends StatefulWidget {
  const HistoryScreen({super.key});

  @override
  State<HistoryScreen> createState() => _HistoryScreenState();
}

class _HistoryScreenState extends State<HistoryScreen> {
  DateTime _month = DateTime(DateTime.now().year, DateTime.now().month);
  List<dynamic>? _records;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _records = null;
      _error = null;
    });
    try {
      final r = await Api.instance.history(monthKey(_month));
      if (mounted) setState(() => _records = r);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    }
  }

  void _shift(int delta) {
    final next = DateTime(_month.year, _month.month + delta);
    if (next.isAfter(DateTime.now())) return;
    setState(() => _month = next);
    _load();
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    // Group by day (records arrive newest first)
    final byDay = <String, List<dynamic>>{};
    for (final r in _records ?? const []) {
      byDay.putIfAbsent(r['local_date'] as String, () => []).add(r);
    }
    final isCurrent = monthKey(_month) == monthKey(DateTime.now());

    return Scaffold(
      appBar: AppBar(title: const Text('My attendance')),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
            child: Row(
              children: [
                IconButton(onPressed: () => _shift(-1), icon: const Icon(Icons.chevron_left)),
                Expanded(
                  child: Text(formatMonth(_month),
                      textAlign: TextAlign.center, style: Theme.of(context).textTheme.titleMedium),
                ),
                IconButton(onPressed: isCurrent ? null : () => _shift(1), icon: const Icon(Icons.chevron_right)),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Text('${byDay.length} day${byDay.length == 1 ? '' : 's'} attended',
                style: TextStyle(color: scheme.onSurfaceVariant)),
          ),
          const Divider(height: 1),
          Expanded(
            child: _error != null
                ? Center(child: Text(_error!))
                : _records == null
                    ? const Center(child: CircularProgressIndicator())
                    : byDay.isEmpty
                        ? Center(child: Text('No attendance this month', style: TextStyle(color: scheme.onSurfaceVariant)))
                        : RefreshIndicator(
                            onRefresh: _load,
                            child: ListView(
                              children: [
                                for (final entry in byDay.entries)
                                  ListTile(
                                    title: Text(formatDayHeader(entry.key)),
                                    subtitle: Wrap(
                                      spacing: 12,
                                      children: [
                                        for (final r in entry.value.reversed)
                                          Text(
                                            '${r['type'] == 'in' ? 'In' : 'Out'} '
                                            '${formatTime(DateTime.parse(r['ts'] as String).toLocal())}',
                                            style: TextStyle(
                                              color: r['type'] == 'in' ? Colors.green.shade700 : Colors.orange.shade800,
                                            ),
                                          ),
                                      ],
                                    ),
                                  ),
                              ],
                            ),
                          ),
          ),
        ],
      ),
    );
  }
}
