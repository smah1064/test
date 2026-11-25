package me.ebda3.app.shell;

import static org.junit.Assert.assertEquals;

import java.util.Arrays;
import java.util.List;
import org.junit.Test;

public class BackNavigatorTest {

    private static final String OFFLINE = "https://localhost/offline.html";

    private static String offlineFor(String page) {
        try {
            return OFFLINE + "?from=" + java.net.URLEncoder.encode(page, "UTF-8");
        } catch (java.io.UnsupportedEncodingException e) {
            throw new AssertionError(e);
        }
    }

    private static int back(int current, String... urls) {
        List<String> list = Arrays.asList(urls);
        return BackNavigator.stepsBack(list, current, OFFLINE);
    }

    @Test
    public void normalPages() {
        assertEquals(1, back(2, "https://ebda3.me/", "https://ebda3.me/designs", "https://ebda3.me/design?id=1"));
        assertEquals(0, back(0, "https://ebda3.me/"));
        assertEquals(0, back(0));
    }

    @Test
    public void skipsTheOfflinePageAndThePageThatFailed() {
        String a = "https://ebda3.me/cart";
        String b = "https://ebda3.me/order?id=1&k=2";
        assertEquals(2, back(2, a, b, offlineFor(b)));
        assertEquals(1, back(1, a, offlineFor(b)));
        assertEquals(0, back(1, b, offlineFor(b)));
    }

    @Test
    public void afterTryingAgainTheFailedCopyIsSkipped() {
        String a = "https://ebda3.me/";
        String b = "https://ebda3.me/editor?product=mug";
        // The offline page was replaced by the page once the connection came back.
        assertEquals(2, back(2, a, b, b));
    }

    @Test
    public void severalOfflinePagesInARow() {
        String a = "https://ebda3.me/";
        String b = "https://ebda3.me/account";
        assertEquals(4, back(4, a, b, offlineFor(b), b, offlineFor(b)));
    }

    @Test
    public void offlineAddresses() {
        assertEquals(true, BackNavigator.isOffline(OFFLINE, OFFLINE));
        assertEquals(true, BackNavigator.isOffline(offlineFor("https://ebda3.me/"), OFFLINE));
        assertEquals(false, BackNavigator.isOffline("https://localhost/offline.html.evil", OFFLINE));
        assertEquals("https://ebda3.me/x?a=1&b=2", BackNavigator.failedPage(offlineFor("https://ebda3.me/x?a=1&b=2")));
    }
}
