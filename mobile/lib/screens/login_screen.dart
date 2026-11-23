import 'package:material_ui/material_ui.dart';

import '../l10n/language.dart';
import '../l10n/strings.dart';

import '../services/api.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key, required this.onLoggedIn, this.message});
  final VoidCallback onLoggedIn;
  final String? message;

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _code = TextEditingController();
  final _password = TextEditingController();
  final _form = GlobalKey<FormState>();
  bool _busy = false;
  bool _hide = true;
  late String? _error = widget.message;

  Future<void> _submit() async {
    if (!_form.currentState!.validate()) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await Api.instance.login(_code.text, _password.text);
      widget.onLoggedIn();
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.text(S.of(context)));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final s = S.of(context);
    return Scaffold(
      appBar: AppBar(
        actions: [
          TextButton.icon(
            onPressed: LanguageController.instance.toggle,
            icon: const Icon(Icons.translate),
            label: Text(s.switchLanguageLabel),
          ),
          const SizedBox(width: 8),
        ],
      ),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: Form(
              key: _form,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Icon(Icons.fact_check_outlined, size: 64, color: scheme.primary),
                  const SizedBox(height: 12),
                  Text(s.appTitle, textAlign: TextAlign.center, style: Theme.of(context).textTheme.headlineMedium),
                  const SizedBox(height: 4),
                  Text(s.loginSubtitle,
                      textAlign: TextAlign.center, style: TextStyle(color: scheme.onSurfaceVariant)),
                  const SizedBox(height: 32),
                  TextFormField(
                    controller: _code,
                    decoration: InputDecoration(labelText: s.employeeCode, border: const OutlineInputBorder()),
                    textInputAction: TextInputAction.next,
                    autocorrect: false,
                    validator: (v) => (v == null || v.trim().isEmpty) ? s.enterEmployeeCode : null,
                  ),
                  const SizedBox(height: 16),
                  TextFormField(
                    controller: _password,
                    obscureText: _hide,
                    decoration: InputDecoration(
                      labelText: s.password,
                      border: const OutlineInputBorder(),
                      suffixIcon: IconButton(
                        icon: Icon(_hide ? Icons.visibility : Icons.visibility_off),
                        onPressed: () => setState(() => _hide = !_hide),
                      ),
                    ),
                    onFieldSubmitted: (_) => _submit(),
                    validator: (v) => (v == null || v.isEmpty) ? s.enterPassword : null,
                  ),
                  if (_error != null) ...[
                    const SizedBox(height: 16),
                    Text(_error!, style: TextStyle(color: scheme.error), textAlign: TextAlign.center),
                  ],
                  const SizedBox(height: 24),
                  FilledButton(
                    style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(52)),
                    onPressed: _busy ? null : _submit,
                    child: _busy
                        ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2))
                        : Text(s.logIn),
                  ),
                  const SizedBox(height: 16),
                  Text(
                    s.deviceLinkNote,
                    textAlign: TextAlign.center,
                    style: TextStyle(fontSize: 12, color: scheme.onSurfaceVariant),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
