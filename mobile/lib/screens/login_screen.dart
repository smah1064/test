import 'package:material_ui/material_ui.dart';

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
      setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Scaffold(
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
                  Text('Attendance', textAlign: TextAlign.center, style: Theme.of(context).textTheme.headlineMedium),
                  const SizedBox(height: 4),
                  Text('Log in with the code your admin gave you',
                      textAlign: TextAlign.center, style: TextStyle(color: scheme.onSurfaceVariant)),
                  const SizedBox(height: 32),
                  TextFormField(
                    controller: _code,
                    decoration: const InputDecoration(labelText: 'Employee code', border: OutlineInputBorder()),
                    textInputAction: TextInputAction.next,
                    autocorrect: false,
                    validator: (v) => (v == null || v.trim().isEmpty) ? 'Enter your employee code' : null,
                  ),
                  const SizedBox(height: 16),
                  TextFormField(
                    controller: _password,
                    obscureText: _hide,
                    decoration: InputDecoration(
                      labelText: 'Password',
                      border: const OutlineInputBorder(),
                      suffixIcon: IconButton(
                        icon: Icon(_hide ? Icons.visibility : Icons.visibility_off),
                        onPressed: () => setState(() => _hide = !_hide),
                      ),
                    ),
                    onFieldSubmitted: (_) => _submit(),
                    validator: (v) => (v == null || v.isEmpty) ? 'Enter your password' : null,
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
                        : const Text('Log in'),
                  ),
                  const SizedBox(height: 16),
                  Text(
                    'Your account will be linked to this phone the first time you log in.',
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
