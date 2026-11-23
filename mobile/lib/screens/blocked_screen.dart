import 'dart:io';

import 'package:material_ui/material_ui.dart';

import '../l10n/strings.dart';
import '../services/integrity.dart';

/// Shown when the phone fails a security check. "Check again" pops with
/// `true` once the problem is fixed.
class BlockedScreen extends StatefulWidget {
  const BlockedScreen({super.key, required this.problems});
  final List<IntegrityCode> problems;

  @override
  State<BlockedScreen> createState() => _BlockedScreenState();
}

class _BlockedScreenState extends State<BlockedScreen> {
  late List<IntegrityCode> _problems = widget.problems;
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
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(S.of(context).stillNotFixed)));
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final s = S.of(context);
    final devMode = _problems.contains(IntegrityCode.devMode);
    return Scaffold(
      appBar: AppBar(title: Text(s.attendanceBlocked)),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(20),
          children: [
            Icon(Icons.gpp_bad_outlined, size: 64, color: scheme.error),
            const SizedBox(height: 12),
            Text(
              s.blockedHeadline,
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
                      Text(s.integrityTitle(p, ios: Platform.isIOS),
                          style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16, color: scheme.onErrorContainer)),
                      const SizedBox(height: 8),
                      Text(s.integrityMessage(p), style: TextStyle(color: scheme.onErrorContainer)),
                    ],
                  ),
                ),
              ),
            const SizedBox(height: 8),
            Text(
              s.reportedToAdmin,
              textAlign: TextAlign.center,
              style: TextStyle(color: scheme.onSurfaceVariant),
            ),
            const SizedBox(height: 24),
            if (devMode)
              OutlinedButton.icon(
                style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(50)),
                onPressed: Integrity.openDeveloperSettings,
                icon: const Icon(Icons.settings),
                label: Text(s.openDeveloperOptions),
              ),
            const SizedBox(height: 12),
            FilledButton.icon(
              style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(50)),
              onPressed: _checking ? null : _recheck,
              icon: _checking
                  ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                  : const Icon(Icons.refresh),
              label: Text(s.checkAgain),
            ),
          ],
        ),
      ),
    );
  }
}
