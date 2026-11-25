package me.ebda3.app.shell;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.net.URI;
import java.util.Arrays;
import java.util.HashSet;
import me.ebda3.app.shell.LinkPolicy.Action;
import me.ebda3.app.shell.LinkPolicy.Decision;
import org.junit.Before;
import org.junit.Test;

public class LinkPolicyTest {

    private LinkPolicy policy;

    @Before
    public void setUp() {
        policy = new LinkPolicy("https", "ebda3.me", -1, "https", "localhost");
    }

    /** Parses like the app does (android.net.Uri gives the same parts) and asks the policy. */
    static Decision decide(LinkPolicy p, String url, boolean mainFrame) {
        URI u = URI.create(url);
        String rest = u.getRawSchemeSpecificPart() == null ? "" : DeepLinks.rest(u);
        if (u.getHost() == null) rest = "";
        return p.decide(url, u.getScheme(), u.getHost(), u.getPort(), rest, mainFrame);
    }

    private Decision main(String url) {
        return decide(policy, url, true);
    }

    @Test
    public void shopPagesLoadInTheApp() {
        assertEquals(Action.LOAD, main("https://ebda3.me/").action);
        assertEquals(Action.LOAD, main("https://ebda3.me/order?id=1&k=2").action);
        assertEquals(Action.LOAD, main("https://EBDA3.me/editor").action);
        assertEquals(Action.LOAD, main("https://ebda3.me:443/cart").action);
    }

    @Test
    public void wwwAndPlainHttpBecomeTheShopAddress() {
        Decision d = main("https://www.ebda3.me/proof?t=abc&k=def#top");
        assertEquals(Action.REWRITE, d.action);
        assertEquals("https://ebda3.me/proof?t=abc&k=def#top", d.url);

        d = main("http://ebda3.me/s/AbCdEfGhIjKl");
        assertEquals(Action.REWRITE, d.action);
        assertEquals("https://ebda3.me/s/AbCdEfGhIjKl", d.url);

        d = main("http://www.ebda3.me");
        assertEquals(Action.REWRITE, d.action);
        assertEquals("https://ebda3.me/", d.url);
    }

    @Test
    public void lookAlikeHostsAreNotTheShop() {
        assertEquals(Action.IN_APP_BROWSER, main("https://ebda3.me.evil.com/").action);
        assertEquals(Action.IN_APP_BROWSER, main("https://notebda3.me/").action);
        assertEquals(Action.IN_APP_BROWSER, main("https://ebda3.me:8443/").action);
        assertFalse(policy.isSite("https", "ebda3.me", 8443));
    }

    @Test
    public void theAppsOwnPagesLoad() {
        assertEquals(Action.LOAD, main("https://localhost/offline.html?from=https%3A%2F%2Febda3.me%2F").action);
        assertEquals(Action.IN_APP_BROWSER, main("http://localhost/offline.html").action);
    }

    @Test
    public void socialAppsAndStoresOpenTheirApp() {
        assertEquals(Action.EXTERNAL, main("https://wa.me/201000000000?text=hi").action);
        assertEquals(Action.EXTERNAL, main("https://api.whatsapp.com/send?phone=20100").action);
        assertEquals(Action.EXTERNAL, main("https://www.instagram.com/ebda3").action);
        assertEquals(Action.EXTERNAL, main("https://play.google.com/store/apps/details?id=me.ebda3.app").action);
    }

    @Test
    public void signInPagesStayInABrowserTab() {
        assertEquals(Action.IN_APP_BROWSER, main("https://accounts.google.com/o/oauth2/v2/auth?client_id=x").action);
        assertEquals(Action.IN_APP_BROWSER, main("https://www.facebook.com/v19.0/dialog/oauth?client_id=x").action);
        assertEquals(Action.EXTERNAL, main("https://www.facebook.com/ebda3").action);
    }

    @Test
    public void otherSitesOpenInABrowserTab() {
        assertEquals(Action.IN_APP_BROWSER, main("https://bosta.co/tracking/123").action);
        assertEquals(Action.IN_APP_BROWSER, main("http://example.com/").action);
    }

    @Test
    public void otherSchemesGoToThePhone() {
        assertEquals(Action.EXTERNAL, main("tel:+201000000000").action);
        assertEquals(Action.EXTERNAL, main("mailto:info@example.com").action);
        assertEquals(Action.EXTERNAL, main("whatsapp://send?text=hi").action);
        assertEquals(Action.EXTERNAL, main("intent://scan/#Intent;scheme=zxing;end").action);
    }

    @Test
    public void dangerousSchemesAreBlocked() {
        assertEquals(Action.BLOCK, main("file:///data/data/me.ebda3.app/x").action);
        assertEquals(Action.BLOCK, main("content://me.ebda3.app.fileprovider/x").action);
        assertEquals(Action.BLOCK, main("chrome://settings").action);
    }

    @Test
    public void pageInternalUrlsAreLeftToTheWebView() {
        assertEquals(Action.LOAD, main("about:blank").action);
        assertEquals(Action.LOAD, main("blob:https://ebda3.me/1234").action);
        assertEquals(Action.LOAD, main("data:text/plain,hi").action);
    }

    @Test
    public void framesLoadButNeverOpenApps() {
        assertEquals(Action.LOAD, decide(policy, "https://challenges.cloudflare.com/turnstile/x", false).action);
        assertEquals(Action.BLOCK, decide(policy, "intent://x#Intent;end", false).action);
        assertEquals(Action.BLOCK, decide(policy, "tel:123", false).action);
    }

    @Test
    public void remoteConfigCanAllowAPaymentPageInTheApp() {
        assertEquals(Action.IN_APP_BROWSER, main("https://accept.paymob.com/api/acceptance/iframes/1").action);
        policy.setInAppHosts(new HashSet<>(Arrays.asList("accept.paymob.com", "*.evil.com", "ebda3.me", "", "localhost", "a b")));
        assertEquals(new HashSet<>(Arrays.asList("accept.paymob.com")), policy.getInAppHosts());
        assertEquals(Action.LOAD, main("https://accept.paymob.com/api/acceptance/iframes/1").action);
        // https only
        assertEquals(Action.IN_APP_BROWSER, main("http://accept.paymob.com/x").action);
        policy.setInAppHosts(null);
        assertTrue(policy.getInAppHosts().isEmpty());
    }

    @Test
    public void aTestCopyOfTheShopOnAnotherPort() {
        LinkPolicy test = new LinkPolicy("http", "10.0.2.2", 3600, "https", "localhost");
        assertEquals("http://10.0.2.2:3600", test.siteOrigin());
        assertEquals(Action.LOAD, decide(test, "http://10.0.2.2:3600/editor", true).action);
        assertEquals(Action.IN_APP_BROWSER, decide(test, "http://10.0.2.2/editor", true).action);
        assertEquals(Action.IN_APP_BROWSER, decide(test, "https://ebda3.me/", true).action);
    }

    @Test
    public void aShopOnWwwRewritesTheBareHost() {
        LinkPolicy www = new LinkPolicy("https", "www.example.com", -1, "https", "localhost");
        Decision d = decide(www, "https://example.com/a?b=1", true);
        assertEquals(Action.REWRITE, d.action);
        assertEquals("https://www.example.com/a?b=1", d.url);
    }

    @Test
    public void hostNames() {
        assertTrue(LinkPolicy.isHostName("accept.paymob.com"));
        assertFalse(LinkPolicy.isHostName("localhost"));
        assertFalse(LinkPolicy.isHostName("*.paymob.com"));
        assertFalse(LinkPolicy.isHostName("-bad.com"));
        assertFalse(LinkPolicy.isHostName("a..b"));
    }
}
