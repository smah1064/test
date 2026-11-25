package me.ebda3.app;

import android.os.Bundle;
import android.os.SystemClock;
import androidx.core.splashscreen.SplashScreen;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.PluginHandle;
import me.ebda3.app.shell.ShellChromeClient;
import me.ebda3.app.shell.ShellPlugin;

/**
 * The app's only screen: Capacitor's web view showing the shop, with the app's own plugin (ShellPlugin).
 *
 * The launch screen (the brand mark on #FAFAF7) stays until the first page is on screen, at most a few seconds.
 * If Android stops the app in the background, coming back reopens the page that was on screen.
 */
public class MainActivity extends BridgeActivity {

    private static final long LAUNCH_SCREEN_MAX_MS = 6000;
    private static final String SAVED_URL = "ebda3.url";

    private long createdAt;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        ShellPlugin.contentShown.set(false);
        createdAt = SystemClock.uptimeMillis();
        SplashScreen splash = SplashScreen.installSplashScreen(this);
        splash.setKeepOnScreenCondition(
            () -> !ShellPlugin.contentShown.get() && SystemClock.uptimeMillis() - createdAt < LAUNCH_SCREEN_MAX_MS
        );

        registerPlugin(ShellPlugin.class);
        super.onCreate(savedInstanceState);
        if (bridge == null) return; // no usable web view on this phone: Capacitor shows its own message

        // Replaces Capacitor's file picker with one that also offers the camera (see ShellChromeClient).
        bridge.getWebView().setWebChromeClient(new ShellChromeClient(bridge));

        if (savedInstanceState != null) {
            ShellPlugin shell = shell();
            String url = savedInstanceState.getString(SAVED_URL);
            if (shell != null && url != null) shell.restorePage(url);
        }
    }

    @Override
    public void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (bridge != null && bridge.getWebView() != null) {
            String url = bridge.getWebView().getUrl();
            if (url != null) outState.putString(SAVED_URL, url);
        }
    }

    private ShellPlugin shell() {
        PluginHandle handle = bridge.getPlugin("Ebda3Shell");
        return handle != null && handle.getInstance() instanceof ShellPlugin ? (ShellPlugin) handle.getInstance() : null;
    }
}
