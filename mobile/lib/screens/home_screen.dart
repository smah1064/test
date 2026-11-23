import 'dart:async';

import 'package:geolocator/geolocator.dart';
import 'package:material_ui/material_ui.dart';

import '../format.dart';
import '../l10n/language.dart';
import '../l10n/strings.dart';
import '../services/api.dart';
import '../services/integrity.dart';
import '../services/location.dart';
import 'blocked_screen.dart';
import 'history_screen.dart';
import 'selfie_screen.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key, required this.onLoggedOut});
  final void Function(String? message) onLoggedOut;

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> with WidgetsBindingObserver {
  Map<String, dynamic>? _me;
  String? _loadError;
  IntegrityReport? _integrity;
  String? _step; // non-null while a punch is in progress
  Timer? _clock;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _refresh();
    _clock = Timer.periodic(const Duration(seconds: 30), (_) => setState(() {}));
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _clock?.cancel();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // Re-check whenever the user comes back (e.g. from Settings).
    if (state == AppLifecycleState.resumed && _step == null) _refresh();
  }

  Future<void> _refresh() async {
    final integrity = await Integrity.check();
    if (mounted) setState(() => _integrity = integrity);
    try {
      final me = await Api.instance.me();
      if (mounted) {
        setState(() {
          _me = me;
          _loadError = null;
        });
      }
    } on ApiException catch (e) {
      if (e.mustLogin) return widget.onLoggedOut(mounted ? e.text(S.of(context)) : null);
      if (mounted) setState(() => _loadError = e.text(S.of(context)));
    }
  }

  Future<bool> _showBlocked(IntegrityReport report) async {
    final fixed = await Navigator.push<bool>(
      context,
      MaterialPageRoute(builder: (_) => BlockedScreen(problems: report.problems)),
    );
    await _refresh();
    return fixed == true;
  }

  void _fail(String message, {String? fix}) {
    if (!mounted) return;
    final s = S.of(context);
    showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        icon: const Icon(Icons.error_outline),
        title: Text(s.notRecorded),
        content: Text(message),
        actions: [
          if (fix == 'location_settings')
            TextButton(onPressed: () => Geolocator.openLocationSettings(), child: Text(s.locationSettings)),
          if (fix == 'app_settings')
            TextButton(onPressed: () => Geolocator.openAppSettings(), child: Text(s.openAppSettings)),
          FilledButton(onPressed: () => Navigator.pop(ctx), child: Text(s.ok)),
        ],
      ),
    );
  }

  Future<void> _punch(String type) async {
    final s = S.of(context);
    try {
      // 1. Phone security
      setState(() => _step = s.stepSecurity);
      var integrity = await Integrity.check();
      if (!integrity.ok) {
        unawaited(Api.instance.reportBlocked(type, await Geolocator.getLastKnownPosition(), integrity));
        setState(() => _step = null);
        await _showBlocked(integrity);
        return;
      }

      // 2. GPS
      setState(() => _step = s.stepLocation);
      var position = await Locator.bestFix();
      if (position.isMocked) {
        await Api.instance.reportBlocked(type, position, integrity, mocked: true);
        _fail(s.mockLocationDetected);
        return;
      }

      // 3. Selfie
      if (!mounted) return;
      setState(() => _step = s.stepSelfie);
      final selfie = await Navigator.push<Selfie>(
        context,
        MaterialPageRoute(builder: (_) => SelfieScreen(checkIn: type == 'in')),
      );
      if (selfie == null) return;

      // 4. Re-check right before sending (settings could change while the camera was open)
      setState(() => _step = s.stepVerifying);
      integrity = await Integrity.check();
      if (!integrity.ok) {
        unawaited(Api.instance.reportBlocked(type, position, integrity));
        setState(() => _step = null);
        await _showBlocked(integrity);
        return;
      }
      if (DateTime.now().difference(position.timestamp).inSeconds > 90) {
        position = await Locator.bestFix();
        if (position.isMocked) {
          await Api.instance.reportBlocked(type, position, integrity, mocked: true);
          _fail(s.mockLocationDetected);
          return;
        }
      }

      // 5. Upload
      setState(() => _step = s.stepSending);
      final res = await Api.instance.punch(
        type: type,
        position: position,
        selfie: selfie.file,
        selfieTakenAt: selfie.takenAt,
        integrity: integrity,
      );
      try {
        selfie.file.deleteSync();
      } catch (_) {}
      await _refresh();
      if (!mounted) return;
      final ts = DateTime.parse(res['ts'] as String).toLocal();
      showDialog<void>(
        context: context,
        builder: (ctx) => AlertDialog(
          icon: Icon(Icons.check_circle, color: Colors.green.shade600, size: 48),
          title: Text(type == 'in' ? s.checkedIn : s.checkedOut),
          content: Text(s.punchedAt(formatTime(s, ts), '${res['site']}'), textAlign: TextAlign.center),
          actions: [FilledButton(onPressed: () => Navigator.pop(ctx), child: Text(s.done))],
        ),
      );
    } on LocationProblem catch (e) {
      _fail(s.locationIssue(e.issue, e.detail), fix: e.fix);
    } on ApiException catch (e) {
      if (e.mustLogin) return widget.onLoggedOut(e.text(s));
      _fail(e.text(s));
    } catch (e) {
      _fail(s.somethingWentWrong('$e'));
    } finally {
      if (mounted) setState(() => _step = null);
    }
  }

  Future<void> _logout() async {
    final s = S.of(context);
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(s.logOutQuestion),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: Text(s.cancel)),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: Text(s.logOut)),
        ],
      ),
    );
    if (ok == true) {
      await Api.instance.logout();
      widget.onLoggedOut(null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;
    final s = S.of(context);
    final me = _me;
    final now = DateTime.now();
    final checkedIn = me?['checked_in'] == true;
    final today = (me?['today'] as List<dynamic>?) ?? const [];
    final blocked = _integrity != null && !_integrity!.ok;

    return Scaffold(
      appBar: AppBar(
        title: Text(me?['company_name'] as String? ?? s.appTitle),
        actions: [
          IconButton(
            tooltip: s.changeLanguage,
            icon: const Icon(Icons.translate),
            onPressed: LanguageController.instance.toggle,
          ),
          IconButton(
            tooltip: s.myHistory,
            icon: const Icon(Icons.calendar_month_outlined),
            onPressed: () => Navigator.push(context, MaterialPageRoute(builder: (_) => const HistoryScreen())),
          ),
          IconButton(tooltip: s.logOut, icon: const Icon(Icons.logout), onPressed: _logout),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _refresh,
        child: ListView(
          padding: const EdgeInsets.all(20),
          children: [
            if (me != null) ...[
              Text(s.hello('${me['user']['name']}'), style: text.titleLarge),
              const SizedBox(height: 2),
              Text(
                me['site'] != null ? s.workLocation('${me['site']['name']}') : s.workLocationAny,
                style: TextStyle(color: scheme.onSurfaceVariant),
              ),
            ],
            if (_loadError != null)
              Card(
                color: scheme.errorContainer,
                child: ListTile(
                  leading: const Icon(Icons.wifi_off),
                  title: Text(_loadError!),
                  trailing: TextButton(onPressed: _refresh, child: Text(s.retry)),
                ),
              ),
            if (blocked)
              Card(
                color: scheme.errorContainer,
                margin: const EdgeInsets.only(top: 16),
                child: ListTile(
                  leading: Icon(Icons.gpp_bad, color: scheme.onErrorContainer),
                  title: Text(s.integrityTitle(_integrity!.problems.first, ios: Theme.of(context).platform == TargetPlatform.iOS),
                      style: TextStyle(color: scheme.onErrorContainer, fontWeight: FontWeight.bold)),
                  subtitle: Text(s.fixBeforeCheckIn, style: TextStyle(color: scheme.onErrorContainer)),
                  trailing: Icon(Icons.chevron_right, color: scheme.onErrorContainer),
                  onTap: () => _showBlocked(_integrity!),
                ),
              ),
            const SizedBox(height: 28),
            Center(child: Text(formatTime(s, now), style: text.displayMedium?.copyWith(fontWeight: FontWeight.w600))),
            Center(child: Text(formatLongDate(s, now), style: TextStyle(color: scheme.onSurfaceVariant))),
            const SizedBox(height: 28),
            Center(
              child: Chip(
                avatar: Icon(checkedIn ? Icons.work : Icons.work_off_outlined, size: 18),
                label: Text(me == null ? '…' : checkedIn ? s.youAreCheckedIn : s.youAreNotCheckedIn),
                backgroundColor: checkedIn ? Colors.green.withValues(alpha: 0.15) : null,
              ),
            ),
            const SizedBox(height: 20),
            SizedBox(
              height: 64,
              child: FilledButton.icon(
                style: FilledButton.styleFrom(
                  backgroundColor: checkedIn ? Colors.orange.shade800 : null,
                  textStyle: const TextStyle(fontSize: 18, fontWeight: FontWeight.w600),
                ),
                onPressed: (me == null || _step != null) ? null : () => _punch(checkedIn ? 'out' : 'in'),
                icon: _step != null
                    ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.5))
                    : Icon(checkedIn ? Icons.logout : Icons.login),
                label: Text(_step ?? (checkedIn ? s.checkOut : s.checkIn)),
              ),
            ),
            const SizedBox(height: 32),
            Text(s.today, style: text.titleMedium),
            const SizedBox(height: 8),
            if (today.isEmpty)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 12),
                child: Text(s.noPunchesToday, style: TextStyle(color: scheme.onSurfaceVariant)),
              )
            else
              Card(
                child: Column(
                  children: [
                    for (final r in today.reversed)
                      ListTile(
                        leading: Icon(
                          r['type'] == 'in' ? Icons.login : Icons.logout,
                          color: r['type'] == 'in' ? Colors.green.shade600 : Colors.orange.shade800,
                        ),
                        title: Text(r['type'] == 'in' ? s.checkedIn : s.checkedOut),
                        trailing: Text(formatTime(s, DateTime.parse(r['ts'] as String).toLocal()),
                            style: const TextStyle(fontWeight: FontWeight.w600)),
                      ),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }
}
