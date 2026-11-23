import 'dart:io';

import 'package:camera/camera.dart';
import 'package:geolocator/geolocator.dart';
import 'package:material_ui/material_ui.dart';

import '../l10n/strings.dart';

class Selfie {
  Selfie(this.file, this.takenAt);
  final File file;
  final DateTime takenAt;
}

/// Live front-camera capture. There is deliberately no gallery picker and no
/// hand-off to the phone's own camera app, so beauty filters, edited photos
/// and old pictures can't be used — the raw camera frame is what's uploaded.
class SelfieScreen extends StatefulWidget {
  const SelfieScreen({super.key, required this.checkIn});
  final bool checkIn;

  @override
  State<SelfieScreen> createState() => _SelfieScreenState();
}

class _SelfieScreenState extends State<SelfieScreen> with WidgetsBindingObserver {
  CameraController? _controller;
  String? _error;
  bool _permissionDenied = false;
  bool _taking = false;
  Selfie? _shot;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _start();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _controller?.dispose();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    final c = _controller;
    if (state == AppLifecycleState.inactive) {
      _controller = null;
      c?.dispose();
      if (mounted) setState(() {});
    } else if (state == AppLifecycleState.resumed && c == null && _shot == null) {
      _start();
    }
  }

  Future<void> _start() async {
    setState(() {
      _error = null;
      _permissionDenied = false;
    });
    try {
      final cameras = await availableCameras();
      final front = cameras.where((c) => c.lensDirection == CameraLensDirection.front).toList();
      if (front.isEmpty) {
        setState(() => _error = S.of(context).noFrontCamera);
        return;
      }
      final controller = CameraController(
        front.first,
        ResolutionPreset.high,
        enableAudio: false,
        imageFormatGroup: ImageFormatGroup.jpeg,
      );
      await controller.initialize();
      await controller.setFlashMode(FlashMode.off);
      if (!mounted) {
        await controller.dispose();
        return;
      }
      setState(() => _controller = controller);
    } on CameraException catch (e) {
      final denied = e.code.contains('AccessDenied') || e.code.contains('Restricted');
      if (!mounted) return;
      final s = S.of(context);
      setState(() {
        _permissionDenied = denied;
        _error = denied ? s.cameraPermissionNeeded : s.cameraError(e.description ?? e.code);
      });
    }
  }

  Future<void> _take() async {
    final c = _controller;
    if (c == null || !c.value.isInitialized || _taking) return;
    setState(() => _taking = true);
    try {
      final x = await c.takePicture();
      final shot = Selfie(File(x.path), DateTime.now());
      _controller = null;
      await c.dispose();
      setState(() => _shot = shot);
    } on CameraException catch (e) {
      if (mounted) setState(() => _error = S.of(context).photoError(e.description ?? e.code));
    } finally {
      if (mounted) setState(() => _taking = false);
    }
  }

  void _retake() {
    try {
      _shot?.file.deleteSync();
    } catch (_) {}
    setState(() => _shot = null);
    _start();
  }

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final s = S.of(context);
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.black,
        foregroundColor: Colors.white,
        title: Text(s.selfieTitle(checkIn: widget.checkIn)),
      ),
      body: SafeArea(
        child: Column(
          children: [
            Expanded(child: Center(child: _body())),
            Padding(
              padding: const EdgeInsets.fromLTRB(24, 12, 24, 24),
              child: _shot != null
                  ? Row(
                      children: [
                        Expanded(
                          child: OutlinedButton.icon(
                            style: OutlinedButton.styleFrom(
                              foregroundColor: Colors.white,
                              side: const BorderSide(color: Colors.white54),
                              minimumSize: const Size.fromHeight(52),
                            ),
                            onPressed: _retake,
                            icon: const Icon(Icons.refresh),
                            label: Text(s.retake),
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: FilledButton.icon(
                            style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(52)),
                            onPressed: () => Navigator.pop(context, _shot),
                            icon: const Icon(Icons.check),
                            label: Text(s.usePhoto),
                          ),
                        ),
                      ],
                    )
                  : _controller != null
                      ? Column(
                          children: [
                            Text(s.lookAtCamera,
                                style: const TextStyle(color: Colors.white70), textAlign: TextAlign.center),
                            const SizedBox(height: 16),
                            GestureDetector(
                              onTap: _take,
                              child: Container(
                                width: 76,
                                height: 76,
                                decoration: BoxDecoration(
                                  shape: BoxShape.circle,
                                  border: Border.all(color: Colors.white, width: 4),
                                ),
                                padding: const EdgeInsets.all(5),
                                child: DecoratedBox(
                                  decoration: BoxDecoration(
                                    shape: BoxShape.circle,
                                    color: _taking ? scheme.primary : Colors.white,
                                  ),
                                ),
                              ),
                            ),
                          ],
                        )
                      : const SizedBox(height: 76),
            ),
          ],
        ),
      ),
    );
  }

  Widget _body() {
    if (_shot != null) {
      return ClipRRect(
        borderRadius: BorderRadius.circular(16),
        child: Image.file(_shot!.file, fit: BoxFit.contain),
      );
    }
    if (_error != null) {
      return Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.no_photography_outlined, color: Colors.white70, size: 48),
            const SizedBox(height: 12),
            Text(_error!, style: const TextStyle(color: Colors.white), textAlign: TextAlign.center),
            const SizedBox(height: 16),
            FilledButton(
              onPressed: _permissionDenied ? Geolocator.openAppSettings : _start,
              child: Text(_permissionDenied ? S.of(context).openAppSettings : S.of(context).tryAgain),
            ),
          ],
        ),
      );
    }
    final c = _controller;
    if (c == null || !c.value.isInitialized) {
      return const CircularProgressIndicator(color: Colors.white);
    }
    return Stack(
      alignment: Alignment.center,
      children: [
        ClipRRect(borderRadius: BorderRadius.circular(16), child: CameraPreview(c)),
        // Face guide
        IgnorePointer(
          child: Container(
            width: 220,
            height: 290,
            decoration: BoxDecoration(
              border: Border.all(color: Colors.white70, width: 2),
              borderRadius: const BorderRadius.all(Radius.elliptical(110, 145)),
            ),
          ),
        ),
      ],
    );
  }
}
