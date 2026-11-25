package me.ebda3.app.shell;

import android.app.Activity;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.ActivityNotFoundException;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.View;
import android.view.Window;
import android.webkit.CookieManager;
import android.webkit.WebBackForwardList;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import androidx.annotation.RequiresApi;
import androidx.browser.customtabs.CustomTabColorSchemeParams;
import androidx.browser.customtabs.CustomTabsIntent;
import androidx.core.content.FileProvider;
import androidx.core.content.pm.PackageInfoCompat;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Logger;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.atomic.AtomicBoolean;
import me.ebda3.app.R;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * The app around the shop (JS name "Ebda3Shell").
 *
 * Set up when the app starts (load): the shop's page glue (www/app-glue.js) is injected into the shop's pages,
 * the web view is kept inside the status and navigation bars, links are routed by {@link LinkPolicy}, the
 * "no connection" page replaces pages that can't be reached, the Back button follows {@link BackNavigator},
 * and links that open the app ({@link DeepLinks}) load their page.
 *
 * Methods for the glue: open, print, saveFile, setRemoteConfig, signIn, getInfo.
 */
@CapacitorPlugin(name = "Ebda3Shell")
public class ShellPlugin extends Plugin {

    static final String TAG = "Ebda3Shell";
    static final String APP_SCHEME = "me.ebda3.app";
    static final String OFFLINE_FILE = "offline.html";
    /** Files of the app's own pages that may be shown at https://localhost/… (from assets/public). */
    static final String[] LOCAL_FILES = { "offline.html", "brand-mark.svg" };
    static final long MAX_SAVE_BYTES = 60L * 1024 * 1024;
    private static final String PREFS = "ebda3_shell";
    private static final String PREF_IN_APP_HOSTS = "inAppHosts";
    private static final String PREF_SIGN_IN = "signIn";

    /** Set once something is on screen (a page or the "no connection" page): the launch screen can go. */
    public static final AtomicBoolean contentShown = new AtomicBoolean(false);

    private LinkPolicy policy;
    private DeepLinks deepLinks;
    private SharedPreferences prefs;
    private String localOrigin;
    private PluginCall pendingSignIn;
    private boolean signInTabOpen;
    private final Handler main = new Handler(Looper.getMainLooper());

    // ---------- start ----------

    @Override
    public void load() {
        prefs = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        Uri site = Uri.parse(siteUrl());
        policy = new LinkPolicy(site.getScheme(), site.getHost(), site.getPort(), getBridge().getScheme(), getBridge().getHost());
        policy.setInAppHosts(loadInAppHosts());
        deepLinks = new DeepLinks(policy, APP_SCHEME);
        localOrigin = getBridge().getScheme() + "://" + getBridge().getHost();

        WebView webView = getBridge().getWebView();
        // Bridge.loadWebView() installs the bridge's client after the plugins load; setWebViewClient() replaces
        // the one it will install.
        getBridge().setWebViewClient(new ShellWebViewClient(getBridge(), this));
        injectGlue(webView);
        keepInsideSystemBars();
        handleBackButton();
        createNotificationChannel();
    }

    /** The "My orders" notification channel (named in the phone's language), used by the shop's notifications. */
    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = getContext().getSystemService(NotificationManager.class);
        if (nm == null) return;
        NotificationChannel channel = new NotificationChannel(
            "orders",
            getContext().getString(R.string.notification_channel_orders),
            NotificationManager.IMPORTANCE_HIGH
        );
        channel.setShowBadge(true);
        nm.createNotificationChannel(channel);
    }

    String siteUrl() {
        String url = getBridge().getServerUrl();
        return url != null ? url : "https://ebda3.me";
    }

    LinkPolicy getPolicy() {
        return policy;
    }

    String offlinePage() {
        return localOrigin + "/" + OFFLINE_FILE;
    }

    private void injectGlue(WebView webView) {
        String glue = readAsset("public/app-glue.js");
        if (glue == null) {
            Logger.error(TAG, "app-glue.js is missing from the app", null);
            return;
        }
        String script = "window.__ebda3AppConfig = " + appConfig().toString() + ";\n" + glue;
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            try {
                WebViewCompat.addDocumentStartJavaScript(webView, script, Collections.singleton(policy.siteOrigin()));
                return;
            } catch (IllegalArgumentException e) {
                Logger.error(TAG, "Could not add the page glue", e);
            }
        }
        // Very old web views: run it when each shop page has loaded (later than ideal, but the features work).
        fallbackScript = script;
    }

    private String fallbackScript;

    String fallbackScript() {
        return fallbackScript;
    }

    JSObject appConfig() {
        JSObject c = new JSObject();
        c.put("platform", "android");
        c.put("version", versionName());
        c.put("build", versionCode());
        c.put("siteOrigin", policy.siteOrigin());
        c.put("appScheme", APP_SCHEME);
        c.put("push", pushConfigured());
        c.put("sdk", Build.VERSION.SDK_INT);
        return c;
    }

    /** Push notifications need the Firebase file (google-services.json) at build time. */
    boolean pushConfigured() {
        Context ctx = getContext();
        return ctx.getResources().getIdentifier("google_app_id", "string", ctx.getPackageName()) != 0;
    }

    private String versionName() {
        PackageInfo info = packageInfo();
        return info != null && info.versionName != null ? info.versionName : "";
    }

    private long versionCode() {
        PackageInfo info = packageInfo();
        return info != null ? PackageInfoCompat.getLongVersionCode(info) : 0;
    }

    private PackageInfo packageInfo() {
        try {
            return getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0);
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * Android 15+ draws apps behind the status and navigation bars. The shop's pages aren't made for that, so the
     * web view is padded to stay between the bars (and above the keyboard), on every Android version alike.
     */
    private void keepInsideSystemBars() {
        Activity activity = getActivity();
        Window window = activity.getWindow();
        WindowCompat.setDecorFitsSystemWindows(window, false);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            window.setNavigationBarContrastEnforced(false);
            window.setStatusBarContrastEnforced(false);
        }
        View webView = getBridge().getWebView();
        View container = webView.getParent() instanceof View ? (View) webView.getParent() : webView;
        ViewCompat.setOnApplyWindowInsetsListener(container, (v, insets) -> {
            Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());
            v.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, ime.bottom));
            return WindowInsetsCompat.CONSUMED;
        });
        ViewCompat.requestApplyInsets(container);
    }

    // ---------- the Back button ----------

    private void handleBackButton() {
        OnBackPressedCallback callback = new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView webView = getBridge().getWebView();
                WebBackForwardList history = webView.copyBackForwardList();
                List<String> urls = new ArrayList<>();
                for (int i = 0; i < history.getSize(); i++) urls.add(history.getItemAtIndex(i).getUrl());
                int steps = BackNavigator.stepsBack(urls, history.getCurrentIndex(), offlinePage());
                if (steps > 0) webView.goBackOrForward(-steps);
                else getActivity().moveTaskToBack(true);
            }
        };
        getActivity().getOnBackPressedDispatcher().addCallback(getActivity(), callback);
    }

    // ---------- navigation (called by ShellWebViewClient) ----------

    /** @return true when the web view must not load the URL itself. */
    boolean handleNavigation(WebView view, Uri url, boolean mainFrame) {
        LinkPolicy.Decision d = decide(url, mainFrame);
        switch (d.action) {
            case LOAD:
                return false;
            case REWRITE:
                view.loadUrl(d.url);
                return true;
            case IN_APP_BROWSER:
                openInAppBrowser(url);
                return true;
            case EXTERNAL:
                openExternal(url);
                return true;
            case BLOCK:
            default:
                Logger.warn(TAG, "Blocked " + url);
                return true;
        }
    }

    LinkPolicy.Decision decide(Uri url, boolean mainFrame) {
        String rest = url.getEncodedPath() == null ? "" : url.getEncodedPath();
        if (url.getEncodedQuery() != null) rest += "?" + url.getEncodedQuery();
        if (url.getEncodedFragment() != null) rest += "#" + url.getEncodedFragment();
        if (url.isHierarchical() && rest.isEmpty()) rest = "/";
        return policy.decide(url.toString(), url.getScheme(), url.isHierarchical() ? url.getHost() : null, url.getPort(), rest, mainFrame);
    }

    boolean isShopOrLocal(Uri url) {
        if (url == null) return false;
        return (
            policy.isSite(url.getScheme(), url.getHost(), url.getPort()) ||
            policy.isLocal(url.getScheme(), url.getHost(), url.getPort()) ||
            ("https".equals(url.getScheme()) && url.getHost() != null && policy.getInAppHosts().contains(url.getHost().toLowerCase(Locale.ROOT)))
        );
    }

    void openInAppBrowser(Uri url) {
        Activity activity = getActivity();
        try {
            CustomTabColorSchemeParams colors = new CustomTabColorSchemeParams.Builder()
                .setToolbarColor(0xFFFAFAF7)
                .setNavigationBarColor(0xFFFAFAF7)
                .build();
            CustomTabsIntent tab = new CustomTabsIntent.Builder()
                .setDefaultColorSchemeParams(colors)
                .setShowTitle(true)
                .setShareState(CustomTabsIntent.SHARE_STATE_ON)
                .build();
            tab.launchUrl(activity, url);
        } catch (ActivityNotFoundException e) {
            openExternal(url);
        }
    }

    void openExternal(Uri url) {
        Activity activity = getActivity();
        String scheme = url.getScheme() == null ? "" : url.getScheme().toLowerCase(Locale.ROOT);
        Intent intent;
        String fallback = null;
        try {
            if (scheme.equals("intent")) {
                intent = Intent.parseUri(url.toString(), Intent.URI_INTENT_SCHEME);
                fallback = intent.getStringExtra("browser_fallback_url");
                // Only what a browser would allow: a viewable link, never a named component.
                intent.setComponent(null);
                intent.setSelector(null);
                intent.addCategory(Intent.CATEGORY_BROWSABLE);
            } else {
                intent = new Intent(Intent.ACTION_VIEW, url);
                intent.addCategory(Intent.CATEGORY_BROWSABLE);
            }
            activity.startActivity(intent);
        } catch (ActivityNotFoundException | java.net.URISyntaxException e) {
            if (fallback != null && (fallback.startsWith("https://") || fallback.startsWith("http://"))) {
                openInAppBrowser(Uri.parse(fallback));
            } else if (scheme.equals("http") || scheme.equals("https")) {
                openInAppBrowser(url);
            } else {
                Logger.warn(TAG, "No app can open " + scheme + ": links");
            }
        }
    }

    // ---------- the app's own pages ----------

    boolean isLocalFile(Uri url) {
        if (url == null || !policy.isLocal(url.getScheme(), url.getHost(), url.getPort())) return false;
        String path = url.getPath();
        if (path == null) return false;
        for (String f : LOCAL_FILES) if (path.equals("/" + f)) return true;
        return false;
    }

    WebResourceResponse localFile(Uri url) {
        String name = url.getPath().substring(1);
        String type = name.endsWith(".svg") ? "image/svg+xml" : "text/html";
        try {
            InputStream in = getContext().getAssets().open("public/" + name);
            WebResourceResponse res = new WebResourceResponse(type, "utf-8", in);
            java.util.Map<String, String> headers = new java.util.HashMap<>();
            headers.put("Cache-Control", "no-cache");
            res.setResponseHeaders(headers);
            return res;
        } catch (IOException e) {
            return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", null, null);
        }
    }

    private volatile String failedUrl;

    /** Shows the "no connection" page in place of a shop page that couldn't be reached. */
    void showOffline(WebView view, Uri failed) {
        if (failed == null || isLocalFile(failed) || !isShopOrLocal(failed)) {
            contentShown.set(true);
            return;
        }
        failedUrl = failed.toString();
        view.loadUrl(offlinePage() + "?from=" + Uri.encode(failedUrl));
    }

    /** A page is on screen (not the web view's own error page for a page that failed). */
    void onContentVisible(String url) {
        if (url != null && url.equals(failedUrl)) return;
        contentShown.set(true);
    }

    // ---------- links that open the app ----------

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        if (intent == null || intent.getData() == null) return;
        DeepLinks.Link link = deepLinks.parse(intent.getData().toString());
        switch (link.kind) {
            case OPEN:
                getBridge().getWebView().loadUrl(link.url);
                break;
            case AUTH:
                finishSignIn(link.url);
                break;
            default:
                break;
        }
    }

    /** Reopens the page that was on screen when Android stopped the app (only the shop's own pages). */
    public void restorePage(String url) {
        String page = BackNavigator.isOffline(url, offlinePage()) ? BackNavigator.failedPage(url) : url;
        DeepLinks.Link link = deepLinks.parse(page);
        if (link.kind == DeepLinks.Kind.OPEN) getBridge().getWebView().loadUrl(link.url);
    }

    @Override
    protected void handleOnPause() {
        super.handleOnPause();
        // Keep the sign-in and cart cookies if Android stops the app while it's in the background.
        CookieManager.getInstance().flush();
    }

    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        // Back from the sign-in tab without an answer (onNewIntent comes before onResume): the person closed it.
        if (pendingSignIn != null && signInTabOpen) {
            signInTabOpen = false;
            final PluginCall call = pendingSignIn;
            main.postDelayed(() -> {
                if (pendingSignIn == call) {
                    pendingSignIn = null;
                    prefs.edit().remove(PREF_SIGN_IN).apply();
                    call.reject("cancelled", "CANCELLED");
                }
            }, 700);
        }
    }

    // ---------- methods for the page glue ----------

    @PluginMethod
    public void getInfo(PluginCall call) {
        call.resolve(appConfig());
    }

    /** Opens a link where it belongs (see LinkPolicy). */
    @PluginMethod
    public void open(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("url is required");
            return;
        }
        Uri uri = Uri.parse(url);
        LinkPolicy.Decision d = decide(uri, true);
        main.post(() -> {
            switch (d.action) {
                case LOAD:
                case REWRITE:
                    getBridge().getWebView().loadUrl(d.action == LinkPolicy.Action.REWRITE ? d.url : url);
                    break;
                case IN_APP_BROWSER:
                    openInAppBrowser(uri);
                    break;
                case EXTERNAL:
                    openExternal(uri);
                    break;
                default:
                    call.reject("This link can't be opened", "BLOCKED");
                    return;
            }
            JSObject res = new JSObject();
            res.put("action", d.action.name().toLowerCase(Locale.ROOT));
            call.resolve(res);
        });
    }

    /** Prints the page on screen (the phone's print screen also saves as PDF). */
    @PluginMethod
    public void print(PluginCall call) {
        String name = call.getString("name", "ebda3");
        main.post(() -> {
            try {
                PrintManager pm = (PrintManager) getActivity().getSystemService(Context.PRINT_SERVICE);
                String job = name == null || name.trim().isEmpty() ? "ebda3" : name.trim();
                pm.print(
                    job,
                    getBridge().getWebView().createPrintDocumentAdapter(job),
                    new PrintAttributes.Builder().setMediaSize(PrintAttributes.MediaSize.ISO_A4).build()
                );
                call.resolve();
            } catch (Exception e) {
                call.reject("Printing is not available", e);
            }
        });
    }

    /**
     * Saves a file the page made: pictures to Photos (Pictures/ebda3), other files to Downloads (Android 10+);
     * on Android 7–9, where that needs a storage permission, the share sheet opens instead.
     */
    @PluginMethod
    public void saveFile(PluginCall call) {
        String data = call.getString("data");
        String mime = cleanMime(call.getString("mimeType"));
        String name = cleanName(call.getString("name"), mime);
        if (data == null || data.isEmpty()) {
            call.reject("data is required");
            return;
        }
        if (data.length() > MAX_SAVE_BYTES * 4 / 3 + 4) {
            call.reject("File too large", "TOO_LARGE");
            return;
        }
        byte[] bytes;
        try {
            bytes = Base64.decode(data, Base64.DEFAULT);
        } catch (IllegalArgumentException e) {
            call.reject("data is not base64", e);
            return;
        }
        boolean image = mime.startsWith("image/");
        try {
            JSObject res = new JSObject();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                saveToMediaStore(bytes, name, mime, image);
                res.put("where", image ? "photos" : "downloads");
            } else {
                shareFile(bytes, name, mime);
                res.put("where", "shared");
            }
            res.put("name", name);
            call.resolve(res);
        } catch (Exception e) {
            call.reject("Could not save the file", e);
        }
    }

    @RequiresApi(api = Build.VERSION_CODES.Q)
    private void saveToMediaStore(byte[] bytes, String name, String mime, boolean image) throws IOException {
        ContentResolver resolver = getContext().getContentResolver();
        ContentValues values = new ContentValues();
        values.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
        values.put(MediaStore.MediaColumns.MIME_TYPE, mime);
        values.put(
            MediaStore.MediaColumns.RELATIVE_PATH,
            image ? Environment.DIRECTORY_PICTURES + "/ebda3" : Environment.DIRECTORY_DOWNLOADS
        );
        values.put(MediaStore.MediaColumns.IS_PENDING, 1);
        Uri collection = image
            ? MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
            : MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
        Uri item = resolver.insert(collection, values);
        if (item == null) throw new IOException("MediaStore refused the file");
        try (OutputStream out = resolver.openOutputStream(item)) {
            if (out == null) throw new IOException("No output stream");
            out.write(bytes);
        } catch (IOException e) {
            resolver.delete(item, null, null);
            throw e;
        }
        values.clear();
        values.put(MediaStore.MediaColumns.IS_PENDING, 0);
        resolver.update(item, values, null, null);
    }

    private void shareFile(byte[] bytes, String name, String mime) throws IOException {
        File dir = new File(getContext().getCacheDir(), "shared");
        File[] old = dir.listFiles();
        if (old != null) for (File f : old) f.delete();
        if (!dir.exists() && !dir.mkdirs()) throw new IOException("No cache folder");
        File file = new File(dir, name);
        try (FileOutputStream out = new FileOutputStream(file)) {
            out.write(bytes);
        }
        Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
        Intent send = new Intent(Intent.ACTION_SEND).setType(mime).putExtra(Intent.EXTRA_STREAM, uri);
        send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        main.post(() -> getActivity().startActivity(Intent.createChooser(send, name)));
    }

    static String cleanMime(String mime) {
        if (mime == null || !mime.matches("^[a-zA-Z0-9.+-]+/[a-zA-Z0-9.+-]+$")) return "application/octet-stream";
        return mime.toLowerCase(Locale.ROOT);
    }

    static String cleanName(String name, String mime) {
        String n = name == null ? "" : name.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]+", "-").replaceAll("^[.\\s]+", "").trim();
        if (n.length() > 120) n = n.substring(n.length() - 120);
        if (n.isEmpty()) n = "ebda3" + (mime.equals("image/png") ? ".png" : "");
        return n;
    }

    /** The shop's remote config can allow a few more hosts inside the app (e.g. a payment page). */
    @PluginMethod
    public void setRemoteConfig(PluginCall call) {
        JSArray hosts = call.getArray("inAppHosts", new JSArray());
        Set<String> set = new HashSet<>();
        try {
            for (int i = 0; i < hosts.length() && i < 20; i++) set.add(hosts.getString(i));
        } catch (JSONException e) {
            call.reject("inAppHosts must be a list of host names");
            return;
        }
        policy.setInAppHosts(set);
        prefs.edit().putString(PREF_IN_APP_HOSTS, new JSONArray(policy.getInAppHosts()).toString()).apply();
        JSObject res = new JSObject();
        res.put("inAppHosts", new JSArray(policy.getInAppHosts()));
        call.resolve(res);
    }

    private Set<String> loadInAppHosts() {
        Set<String> set = new HashSet<>();
        try {
            JSONArray a = new JSONArray(prefs.getString(PREF_IN_APP_HOSTS, "[]"));
            for (int i = 0; i < a.length(); i++) set.add(a.getString(i));
        } catch (JSONException e) {
            prefs.edit().remove(PREF_IN_APP_HOSTS).apply();
        }
        return set;
    }

    /**
     * Google/Facebook sign-in in the phone's browser (Google doesn't allow it inside apps' web views). The shop
     * answers with me.ebda3.app://auth?code=… (or ?error=…); the app then finishes the sign-in in its own web
     * view with the code and the secret only it knows (verifier), so the code is useless to anyone else.
     */
    @PluginMethod
    public void signIn(PluginCall call) {
        String url = call.getString("url");
        String verifier = call.getString("verifier");
        String next = call.getString("next");
        Uri uri = url == null ? null : Uri.parse(url);
        if (
            uri == null ||
            !policy.isSite(uri.getScheme(), uri.getHost(), uri.getPort()) ||
            uri.getPath() == null ||
            !uri.getPath().startsWith("/auth/") ||
            verifier == null ||
            !verifier.matches("^[A-Za-z0-9_-]{43,128}$")
        ) {
            call.reject("Invalid sign-in request");
            return;
        }
        if (pendingSignIn != null) pendingSignIn.reject("cancelled", "CANCELLED");
        pendingSignIn = call;
        JSObject saved = new JSObject();
        saved.put("verifier", verifier);
        saved.put("next", "cart".equals(next) ? "cart" : "");
        saved.put("at", System.currentTimeMillis());
        prefs.edit().putString(PREF_SIGN_IN, saved.toString()).apply();
        main.post(() -> {
            signInTabOpen = true;
            openInAppBrowser(uri);
        });
    }

    private void finishSignIn(String callbackUrl) {
        JSONObject saved = null;
        try {
            saved = new JSONObject(prefs.getString(PREF_SIGN_IN, "{}"));
        } catch (JSONException e) {
            // nothing saved
        }
        prefs.edit().remove(PREF_SIGN_IN).apply();
        signInTabOpen = false;
        PluginCall call = pendingSignIn;
        pendingSignIn = null;

        Uri cb = Uri.parse(callbackUrl);
        String code = cb.getQueryParameter("code");
        String error = cb.getQueryParameter("error");
        String verifier = saved == null ? null : saved.optString("verifier", null);
        long at = saved == null ? 0 : saved.optLong("at", 0);
        String next = saved != null && "cart".equals(saved.optString("next")) ? "&next=cart" : "";
        boolean fresh = at > 0 && System.currentTimeMillis() - at < 15 * 60 * 1000;

        String target;
        if (code != null && code.matches("^[A-Za-z0-9_-]{16,256}$") && verifier != null && fresh) {
            target = policy.siteOrigin() + "/auth/app?code=" + Uri.encode(code) + "&verifier=" + Uri.encode(verifier) + next;
        } else {
            String reason = error != null && error.matches("^[a-z_]{1,32}$") ? error : "failed";
            target = policy.siteOrigin() + "/account?oauth=" + reason + next;
        }
        getBridge().getWebView().loadUrl(target);
        if (call != null) {
            JSObject res = new JSObject();
            res.put("done", true);
            call.resolve(res);
        }
    }

    // ---------- helpers ----------

    String readAsset(String path) {
        try (InputStream in = getContext().getAssets().open(path); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            return out.toString(StandardCharsets.UTF_8.name());
        } catch (IOException e) {
            return null;
        }
    }
}
