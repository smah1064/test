import 'package:material_ui/material_ui.dart';

import '../services/integrity.dart';

/// Shown when the phone fails a security check. "Check again" pops with
/// `true` once the problem is fixed.
class BlockedScreen extends StatefulWidget {
  const BlockedScreen({super.key, required this.problems});
  final List<IntegrityProblem> problems;

  @override
  State<BlockedScreen> createState() => _BlockedScreenState();
}

class _BlockedScreenState extends State<BlockedScreen> {
  late List<IntegrityProblem> _problems = widget.problems;
  bool _checking = false;

  Future<void> _recheck() async {
    setState(() => _checking = true);
    final report = await Integrity.check();
    if (!mounted) return;
    if (report.ok) {
      Navigator.pop(context, true);
    } else {
      setState(() {
        _problems = report.problems;
        _checking = false;
      });
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Still not fixed.')));
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final devMode = _problems.any((p) => p.code == 'DEV_MODE');
    return Scaffold(
      appBar: AppBar(title: const Text('Attendance blocked')),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(20),
          children: [
            Icon(Icons.gpp_bad_outlined, size: 64, color: scheme.error),
            const SizedBox(height: 12),
            Text(
              'This phone can\'t record attendance right now',
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.titleLarge,
            ),
            const SizedBox(height: 20),
            for (final p in _problems)
              Card(
                color: scheme.errorContainer,
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(p.title,
                          style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16, color: scheme.onErrorContainer)),
                      const SizedBox(height: 8),
                      Text(p.message, style: TextStyle(color: scheme.onErrorContainer)),
                    ],
                  ),
                ),
              ),
            const SizedBox(height: 8),
            Text(
              'This attempt has been reported to your admin.',
              textAlign: TextAlign.center,
              style: TextStyle(color: scheme.onSurfaceVariant),
            ),
            const SizedBox(height: 24),
            if (devMode)
              OutlinedButton.icon(
                style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(50)),
                onPressed: Integrity.openDeveloperSettings,
                icon: const Icon(Icons.settings),
                label: const Text('Open Developer options'),
              ),
            const SizedBox(height: 12),
            FilledButton.icon(
              style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(50)),
              onPressed: _checking ? null : _recheck,
              icon: _checking
                  ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                  : const Icon(Icons.refresh),
              label: const Text('Check again'),
            ),
          ],
        ),
      ),
    );
  }
}
