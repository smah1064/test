package me.ebda3.app.shell;

import java.net.URI;
import java.net.URISyntaxException;
import java.util.List;

/**
 * What the Android Back button does (pure Java, unit tested): go back to the previous real page, skipping the
 * app's "no connection" page, the page that failed to load just before it, and repeats of the page on screen.
 * When there is nothing to go back to, the app goes to the background (it isn't closed, so the page and the
 * cart stay as they were).
 */
public final class BackNavigator {

    private BackNavigator() {}

    /**
     * @param urls the web view's history, oldest first
     * @param current the index of the page on screen
     * @param offlinePage the address of the app's "no connection" page without its query (e.g.
     *     "https://localhost/offline.html")
     * @return how many steps to go back; 0 when there is no page to go back to
     */
    public static int stepsBack(List<String> urls, int current, String offlinePage) {
        if (urls == null || current <= 0 || current >= urls.size()) return 0;
        String here = urls.get(current);
        for (int i = current - 1; i >= 0; i--) {
            String u = urls.get(i);
            if (u == null || isOffline(u, offlinePage)) continue;
            if (u.equals(here)) continue;
            String next = urls.get(i + 1);
            if (next != null && isOffline(next, offlinePage) && u.equals(failedPage(next))) continue;
            return current - i;
        }
        return 0;
    }

    public static boolean isOffline(String url, String offlinePage) {
        if (url == null || offlinePage == null) return false;
        return url.equals(offlinePage) || url.startsWith(offlinePage + "?") || url.startsWith(offlinePage + "#");
    }

    /** The page an offline page stands for (its "from" parameter), or null. */
    public static String failedPage(String offlineUrl) {
        try {
            return DeepLinks.queryParam(new URI(offlineUrl).getRawQuery(), "from");
        } catch (URISyntaxException e) {
            return null;
        }
    }
}
