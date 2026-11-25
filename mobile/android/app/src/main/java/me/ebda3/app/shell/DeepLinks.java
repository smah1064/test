package me.ebda3.app.shell;

import java.io.UnsupportedEncodingException;
import java.net.URI;
import java.net.URISyntaxException;
import java.net.URLDecoder;
import java.util.Locale;

/**
 * Links that open the app (pure Java, unit tested):
 * - https://ebda3.me/… and https://www.ebda3.me/… (Android App Links, e.g. an order or proof link in WhatsApp):
 *   open that page in the app.
 * - me.ebda3.app://open?url=<a shop address>: the same, for places that can't use https links.
 * - me.ebda3.app://auth?…: the answer of a sign-in done in the phone's browser.
 * Anything else is ignored, and only the shop's own pages are ever opened.
 */
public final class DeepLinks {

    public enum Kind {
        OPEN,
        AUTH,
        NONE
    }

    public static final class Link {

        public final Kind kind;
        public final String url;

        Link(Kind kind, String url) {
            this.kind = kind;
            this.url = url;
        }

        @Override
        public String toString() {
            return kind + " " + url;
        }
    }

    static final Link NONE = new Link(Kind.NONE, null);

    private final LinkPolicy policy;
    private final String appScheme;

    public DeepLinks(LinkPolicy policy, String appScheme) {
        this.policy = policy;
        this.appScheme = appScheme.toLowerCase(Locale.ROOT);
    }

    public Link parse(String data) {
        if (data == null || data.trim().isEmpty()) return NONE;
        URI u;
        try {
            u = new URI(data.trim());
        } catch (URISyntaxException e) {
            return NONE;
        }
        String scheme = lower(u.getScheme());
        if (scheme.equals(appScheme)) {
            String host = lower(u.getHost());
            if (host.equals("auth")) return new Link(Kind.AUTH, data.trim());
            if (host.equals("open")) {
                String target = queryParam(u.getRawQuery(), "url");
                return target == null ? NONE : shopPage(target);
            }
            return NONE;
        }
        if (scheme.equals("http") || scheme.equals("https")) return shopPage(data.trim());
        return NONE;
    }

    /** The shop page an address points to (as the app loads it), or NONE. */
    Link shopPage(String url) {
        URI u;
        try {
            u = new URI(url);
        } catch (URISyntaxException e) {
            return NONE;
        }
        String scheme = lower(u.getScheme());
        String host = lower(u.getHost());
        if (!(scheme.equals("http") || scheme.equals("https")) || host.isEmpty() || u.getRawUserInfo() != null) return NONE;
        String rest = rest(u);
        if (policy.isSite(scheme, host, u.getPort())) return new Link(Kind.OPEN, url);
        boolean defaultPort = LinkPolicy.normalPort(scheme, u.getPort()) == LinkPolicy.normalPort(scheme, -1);
        if (defaultPort && (host.equals(policy.getSiteHost()) || policy.isWwwTwin(host))) {
            return new Link(Kind.OPEN, policy.siteOrigin() + rest);
        }
        return NONE;
    }

    static String rest(URI u) {
        StringBuilder b = new StringBuilder();
        String path = u.getRawPath();
        b.append(path == null || path.isEmpty() ? "/" : path);
        if (u.getRawQuery() != null) b.append('?').append(u.getRawQuery());
        if (u.getRawFragment() != null) b.append('#').append(u.getRawFragment());
        return b.toString();
    }

    /** The decoded value of a query parameter, or null. */
    public static String queryParam(String rawQuery, String name) {
        if (rawQuery == null) return null;
        for (String part : rawQuery.split("&")) {
            int eq = part.indexOf('=');
            String key = eq < 0 ? part : part.substring(0, eq);
            if (!decode(key).equals(name)) continue;
            return eq < 0 ? "" : decode(part.substring(eq + 1));
        }
        return null;
    }

    static String decode(String s) {
        try {
            return URLDecoder.decode(s, "UTF-8");
        } catch (UnsupportedEncodingException | IllegalArgumentException e) {
            return s;
        }
    }

    private static String lower(String s) {
        return s == null ? "" : s.toLowerCase(Locale.ROOT);
    }
}
