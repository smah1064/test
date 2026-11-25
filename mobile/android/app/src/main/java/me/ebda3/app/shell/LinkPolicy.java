package me.ebda3.app.shell;

import java.util.Collections;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;

/**
 * Where a link opens: inside the app, in an in-app browser tab, or in another app (WhatsApp, the dialer…).
 *
 * Pure Java (no Android classes) so it is unit tested on the computer: the caller passes the parts of the URL
 * it already parsed with android.net.Uri.
 *
 * - The shop itself (same scheme, host and port as server.url) loads in the app's web view.
 * - www.<shop> and http://<shop> are rewritten to the shop's own address (one origin = one set of cookies, and
 *   the app's features are only given to that origin).
 * - The app's own local pages (https://localhost/…, e.g. the "no connection" page) load in the web view.
 * - Hosts the shop allows through its remote config (e.g. a payment page) load in the web view.
 * - Social apps and stores open in their own app; every other web address opens in an in-app browser tab.
 * - Frames inside a page (e.g. the CAPTCHA) load normally; frames never open other apps.
 */
public final class LinkPolicy {

    public enum Action {
        /** Let the web view load it. */
        LOAD,
        /** Load {@link Decision#url} in the web view instead. */
        REWRITE,
        /** Open in an in-app browser tab (Custom Tab). */
        IN_APP_BROWSER,
        /** Hand to the phone (another app or the browser). */
        EXTERNAL,
        /** Do nothing. */
        BLOCK
    }

    public static final class Decision {

        public final Action action;
        public final String url;

        Decision(Action action, String url) {
            this.action = action;
            this.url = url;
        }

        @Override
        public String toString() {
            return action + " " + url;
        }
    }

    /** Hosts whose links are better in their own app than in a browser tab. */
    static final Set<String> APP_HOSTS = Collections.unmodifiableSet(
        new HashSet<>(
            java.util.Arrays.asList(
                "wa.me",
                "api.whatsapp.com",
                "chat.whatsapp.com",
                "whatsapp.com",
                "www.whatsapp.com",
                "facebook.com",
                "www.facebook.com",
                "m.facebook.com",
                "fb.com",
                "fb.me",
                "m.me",
                "instagram.com",
                "www.instagram.com",
                "instagr.am",
                "tiktok.com",
                "www.tiktok.com",
                "vm.tiktok.com",
                "youtube.com",
                "www.youtube.com",
                "m.youtube.com",
                "youtu.be",
                "x.com",
                "twitter.com",
                "t.me",
                "telegram.me",
                "maps.google.com",
                "maps.app.goo.gl",
                "goo.gl",
                "play.google.com",
                "apps.apple.com",
                "itunes.apple.com"
            )
        )
    );

    /** Schemes that must never be opened from a page. */
    static final Set<String> BLOCKED_SCHEMES = Collections.unmodifiableSet(
        new HashSet<>(java.util.Arrays.asList("file", "content", "chrome", "chrome-extension", "android-app", "jar", "ftp"))
    );

    private final String siteScheme;
    private final String siteHost;
    private final int sitePort;
    private final String localScheme;
    private final String localHost;
    private volatile Set<String> inAppHosts = Collections.emptySet();

    /**
     * @param siteScheme "https" (or "http" for a test copy of the shop)
     * @param siteHost e.g. "ebda3.me"
     * @param sitePort -1 for the scheme's default port
     * @param localScheme the scheme of the app's own pages ("https")
     * @param localHost the host of the app's own pages ("localhost")
     */
    public LinkPolicy(String siteScheme, String siteHost, int sitePort, String localScheme, String localHost) {
        this.siteScheme = lower(siteScheme);
        this.siteHost = lower(siteHost);
        this.sitePort = normalPort(this.siteScheme, sitePort);
        this.localScheme = lower(localScheme);
        this.localHost = lower(localHost);
    }

    /** Hosts the shop's remote config allows inside the app (exact host names, https only). */
    public void setInAppHosts(Set<String> hosts) {
        Set<String> clean = new HashSet<>();
        if (hosts != null) {
            for (String h : hosts) {
                String host = lower(h);
                if (isHostName(host) && !host.equals(siteHost) && !host.equals(localHost)) clean.add(host);
            }
        }
        inAppHosts = Collections.unmodifiableSet(clean);
    }

    public Set<String> getInAppHosts() {
        return inAppHosts;
    }

    /** True when the URL is one of the shop's own pages (as the app loads them). */
    public boolean isSite(String scheme, String host, int port) {
        String s = lower(scheme);
        return s.equals(siteScheme) && lower(host).equals(siteHost) && normalPort(s, port) == sitePort;
    }

    public boolean isLocal(String scheme, String host, int port) {
        String s = lower(scheme);
        return s.equals(localScheme) && lower(host).equals(localHost) && normalPort(s, port) == normalPort(localScheme, -1);
    }

    /**
     * @param url the full URL as the web view gave it
     * @param scheme its scheme (may be null)
     * @param host its host (may be null)
     * @param port its port (-1 when not given)
     * @param pathAndRest everything after the authority: path, query and fragment ("" or "/…")
     * @param mainFrame false for a frame inside the page
     */
    public Decision decide(String url, String scheme, String host, int port, String pathAndRest, boolean mainFrame) {
        String s = lower(scheme);
        String h = lower(host);
        if (s.isEmpty()) return new Decision(Action.BLOCK, url);
        if (s.equals("about") || s.equals("data") || s.equals("blob") || s.equals("javascript")) {
            return new Decision(Action.LOAD, url);
        }
        boolean web = s.equals("http") || s.equals("https");
        if (!mainFrame) {
            return new Decision(web ? Action.LOAD : Action.BLOCK, url);
        }
        if (BLOCKED_SCHEMES.contains(s)) return new Decision(Action.BLOCK, url);
        if (!web) return new Decision(Action.EXTERNAL, url);
        if (h.isEmpty()) return new Decision(Action.BLOCK, url);

        if (isSite(s, h, port)) return new Decision(Action.LOAD, url);
        if (isLocal(s, h, port)) return new Decision(Action.LOAD, url);

        boolean sameHost = h.equals(siteHost) && normalPort(s, port) == normalPort(s, -1) && sitePort == normalPort(siteScheme, -1);
        boolean wwwHost = isWwwTwin(h) && normalPort(s, port) == normalPort(s, -1);
        if (sameHost || wwwHost) {
            return new Decision(Action.REWRITE, siteOrigin() + (pathAndRest == null ? "" : pathAndRest));
        }

        if (s.equals("https") && inAppHosts.contains(h)) return new Decision(Action.LOAD, url);

        if (APP_HOSTS.contains(h) && !isOAuthDialog(h, pathAndRest)) return new Decision(Action.EXTERNAL, url);
        return new Decision(Action.IN_APP_BROWSER, url);
    }

    /** The shop's origin, e.g. "https://ebda3.me". */
    public String siteOrigin() {
        boolean defaultPort = sitePort == normalPort(siteScheme, -1);
        return siteScheme + "://" + siteHost + (defaultPort ? "" : ":" + sitePort);
    }

    public String getSiteHost() {
        return siteHost;
    }

    /** "www.ebda3.me" for "ebda3.me" and the other way round. */
    public boolean isWwwTwin(String host) {
        String h = lower(host);
        if (h.isEmpty() || h.equals(siteHost)) return false;
        return h.equals("www." + siteHost) || (siteHost.startsWith("www.") && h.equals(siteHost.substring(4)));
    }

    // Facebook's sign-in page must stay in a browser tab, not jump to the Facebook app.
    private static boolean isOAuthDialog(String host, String pathAndRest) {
        if (pathAndRest == null) return false;
        String p = pathAndRest.toLowerCase(Locale.ROOT);
        return host.contains("facebook.com") && (p.startsWith("/dialog/oauth") || p.matches("^/v[0-9.]+/dialog/oauth.*"));
    }

    static boolean isHostName(String host) {
        return host != null && host.length() <= 253 && host.matches("^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$");
    }

    static int normalPort(String scheme, int port) {
        if (port > 0) return port;
        if ("https".equals(scheme)) return 443;
        if ("http".equals(scheme)) return 80;
        return -1;
    }

    private static String lower(String s) {
        return s == null ? "" : s.toLowerCase(Locale.ROOT);
    }
}
