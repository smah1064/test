package me.ebda3.app.shell;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import me.ebda3.app.shell.DeepLinks.Kind;
import me.ebda3.app.shell.DeepLinks.Link;
import org.junit.Test;

public class DeepLinksTest {

    private final DeepLinks links = new DeepLinks(new LinkPolicy("https", "ebda3.me", -1, "https", "localhost"), "me.ebda3.app");

    private static void assertOpen(String expected, Link link) {
        assertEquals(Kind.OPEN, link.kind);
        assertEquals(expected, link.url);
    }

    @Test
    public void shopLinksOpenInTheApp() {
        assertOpen("https://ebda3.me/order?id=abc&k=def", links.parse("https://ebda3.me/order?id=abc&k=def"));
        assertOpen("https://ebda3.me/proof?t=x&k=y", links.parse("https://www.ebda3.me/proof?t=x&k=y"));
        assertOpen("https://ebda3.me/", links.parse("http://ebda3.me"));
        assertOpen("https://ebda3.me/s/AbCdEfGhIjKl", links.parse("  https://ebda3.me/s/AbCdEfGhIjKl "));
    }

    @Test
    public void openWithAnAddress() {
        assertOpen(
            "https://ebda3.me/order?id=1&k=2",
            links.parse("me.ebda3.app://open?url=https%3A%2F%2Febda3.me%2Forder%3Fid%3D1%26k%3D2")
        );
        assertEquals(Kind.NONE, links.parse("me.ebda3.app://open?url=https%3A%2F%2Fevil.com%2F").kind);
        assertEquals(Kind.NONE, links.parse("me.ebda3.app://open").kind);
        assertEquals(Kind.NONE, links.parse("me.ebda3.app://open?url=javascript%3Aalert(1)").kind);
    }

    @Test
    public void signInAnswers() {
        Link link = links.parse("me.ebda3.app://auth?code=abc123");
        assertEquals(Kind.AUTH, link.kind);
        assertEquals("me.ebda3.app://auth?code=abc123", link.url);
        assertEquals(Kind.AUTH, links.parse("ME.EBDA3.APP://auth?error=cancelled").kind);
    }

    @Test
    public void everythingElseIsIgnored() {
        assertEquals(Kind.NONE, links.parse(null).kind);
        assertEquals(Kind.NONE, links.parse("").kind);
        assertEquals(Kind.NONE, links.parse("https://evil.com/order").kind);
        assertEquals(Kind.NONE, links.parse("https://ebda3.me.evil.com/").kind);
        assertEquals(Kind.NONE, links.parse("https://user@ebda3.me/").kind);
        assertEquals(Kind.NONE, links.parse("https://ebda3.me:8443/").kind);
        assertEquals(Kind.NONE, links.parse("me.ebda3.app://other").kind);
        assertEquals(Kind.NONE, links.parse("other.app://auth?code=1").kind);
        assertEquals(Kind.NONE, links.parse("https://ebda3.me/bad path").kind);
        assertNull(links.parse("file:///x").url);
    }

    @Test
    public void queryParameters() {
        assertEquals("a b&c", DeepLinks.queryParam("x=1&from=a+b%26c", "from"));
        assertEquals("", DeepLinks.queryParam("from", "from"));
        assertNull(DeepLinks.queryParam("x=1", "from"));
        assertNull(DeepLinks.queryParam(null, "from"));
    }
}
