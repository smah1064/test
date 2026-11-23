package com.yourcompany.attendance_app

import android.annotation.SuppressLint
import android.content.Intent
import android.provider.Settings
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

/**
 * Native integrity checks used by the attendance flow.
 *
 * On Android a fake-GPS app can only be used after the user turns on
 * Developer options and selects it as the "mock location app", so refusing
 * to work while Developer options are on blocks that whole class of cheat.
 */
class MainActivity : FlutterActivity() {
    private val channelName = "attendance/integrity"

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, channelName)
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "developerStatus" -> {
                        try {
                            result.success(
                                mapOf(
                                    "developerOptions" to globalFlag(Settings.Global.DEVELOPMENT_SETTINGS_ENABLED),
                                    "adb" to globalFlag(Settings.Global.ADB_ENABLED),
                                )
                            )
                        } catch (e: Exception) {
                            result.error("CHECK_FAILED", e.message, null)
                        }
                    }
                    "deviceId" -> result.success(androidId())
                    "openDeveloperSettings" -> {
                        result.success(openSettings(Settings.ACTION_APPLICATION_DEVELOPMENT_SETTINGS))
                    }
                    else -> result.notImplemented()
                }
            }
    }

    private fun globalFlag(name: String): Boolean {
        val resolver = contentResolver
        // Some OEMs mirror the flag in Secure settings; treat either as "on".
        val global = Settings.Global.getInt(resolver, name, 0) != 0
        val secure = try {
            @Suppress("DEPRECATION")
            Settings.Secure.getInt(resolver, name, 0) != 0
        } catch (_: Exception) {
            false
        }
        return global || secure
    }

    /** Stable per-device, per-app-signing-key ID. Survives app reinstalls. */
    @SuppressLint("HardwareIds")
    private fun androidId(): String? =
        Settings.Secure.getString(contentResolver, Settings.Secure.ANDROID_ID)

    private fun openSettings(action: String): Boolean {
        return try {
            startActivity(Intent(action).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            true
        } catch (_: Exception) {
            try {
                startActivity(Intent(Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                true
            } catch (_: Exception) {
                false
            }
        }
    }
}
