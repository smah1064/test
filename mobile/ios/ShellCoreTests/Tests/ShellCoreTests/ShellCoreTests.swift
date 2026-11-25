import XCTest
@testable import ShellCore

// The same cases as the Android app's LinkPolicyTest / DeepLinksTest, so both apps behave alike.
final class LinkPolicyTests: XCTestCase {
    private var policy: LinkPolicy!

    override func setUp() {
        policy = LinkPolicy(site: URL(string: "https://ebda3.me")!, localScheme: "capacitor", localHost: "localhost")
    }

    private func main(_ s: String) -> LinkAction {
        return policy.decide(URL(string: s)!, mainFrame: true)
    }

    func testShopPagesLoadInTheApp() {
        XCTAssertEqual(main("https://ebda3.me/"), .load)
        XCTAssertEqual(main("https://ebda3.me/order?id=1&k=2"), .load)
        XCTAssertEqual(main("https://EBDA3.me/editor"), .load)
        XCTAssertEqual(main("https://ebda3.me:443/cart"), .load)
    }

    func testWwwAndPlainHttpBecomeTheShopAddress() {
        XCTAssertEqual(main("https://www.ebda3.me/proof?t=abc&k=def#top"), .rewrite(URL(string: "https://ebda3.me/proof?t=abc&k=def#top")!))
        XCTAssertEqual(main("http://ebda3.me/s/AbCdEfGhIjKl"), .rewrite(URL(string: "https://ebda3.me/s/AbCdEfGhIjKl")!))
        XCTAssertEqual(main("http://www.ebda3.me"), .rewrite(URL(string: "https://ebda3.me/")!))
    }

    func testLookAlikeHostsAreNotTheShop() {
        XCTAssertEqual(main("https://ebda3.me.evil.com/"), .inAppBrowser)
        XCTAssertEqual(main("https://notebda3.me/"), .inAppBrowser)
        XCTAssertEqual(main("https://ebda3.me:8443/"), .inAppBrowser)
    }

    func testTheAppsOwnPagesLoad() {
        XCTAssertEqual(main("capacitor://localhost/offline.html?from=https%3A%2F%2Febda3.me%2F"), .load)
    }

    func testSocialAppsAndStoresOpenTheirApp() {
        XCTAssertEqual(main("https://wa.me/201000000000?text=hi"), .external)
        XCTAssertEqual(main("https://api.whatsapp.com/send?phone=20100"), .external)
        XCTAssertEqual(main("https://www.instagram.com/ebda3"), .external)
        XCTAssertEqual(main("https://apps.apple.com/app/id1"), .external)
    }

    func testSignInPagesStayInABrowserTab() {
        XCTAssertEqual(main("https://accounts.google.com/o/oauth2/v2/auth?client_id=x"), .inAppBrowser)
        XCTAssertEqual(main("https://www.facebook.com/v19.0/dialog/oauth?client_id=x"), .inAppBrowser)
        XCTAssertEqual(main("https://www.facebook.com/ebda3"), .external)
    }

    func testOtherSitesOpenInABrowserTab() {
        XCTAssertEqual(main("https://bosta.co/tracking/123"), .inAppBrowser)
    }

    func testOtherSchemesGoToThePhoneAndDangerousOnesAreBlocked() {
        XCTAssertEqual(main("tel:+201000000000"), .external)
        XCTAssertEqual(main("mailto:info@example.com"), .external)
        XCTAssertEqual(main("whatsapp://send?text=hi"), .external)
        XCTAssertEqual(main("file:///etc/passwd"), .block)
        XCTAssertEqual(main("about:blank"), .load)
        XCTAssertEqual(main("blob:https://ebda3.me/1234"), .load)
    }

    func testFramesLoadButNeverOpenApps() {
        XCTAssertEqual(policy.decide(URL(string: "https://challenges.cloudflare.com/x")!, mainFrame: false), .load)
        XCTAssertEqual(policy.decide(URL(string: "tel:123")!, mainFrame: false), .block)
    }

    func testRemoteConfigCanAllowAPaymentPageInTheApp() {
        XCTAssertEqual(main("https://accept.paymob.com/x"), .inAppBrowser)
        policy.setInAppHosts(["accept.paymob.com", "*.evil.com", "ebda3.me", "", "localhost", "a b"])
        XCTAssertEqual(policy.inAppHosts, ["accept.paymob.com"])
        XCTAssertEqual(main("https://accept.paymob.com/x"), .load)
        XCTAssertEqual(main("http://accept.paymob.com/x"), .inAppBrowser)
    }

    func testATestCopyOfTheShopOnAnotherPort() {
        let test = LinkPolicy(site: URL(string: "http://localhost:3600")!, localScheme: "capacitor", localHost: "localhost")
        XCTAssertEqual(test.siteOrigin, "http://localhost:3600")
        XCTAssertEqual(test.decide(URL(string: "http://localhost:3600/editor")!, mainFrame: true), .load)
        XCTAssertEqual(test.decide(URL(string: "capacitor://localhost/offline.html")!, mainFrame: true), .load)
        XCTAssertEqual(test.decide(URL(string: "https://ebda3.me/")!, mainFrame: true), .inAppBrowser)
    }
}

final class DeepLinksTests: XCTestCase {
    private let links = DeepLinks(
        policy: LinkPolicy(site: URL(string: "https://ebda3.me")!, localScheme: "capacitor", localHost: "localhost"),
        appScheme: "me.ebda3.app"
    )

    func testShopLinksOpenInTheApp() {
        XCTAssertEqual(links.parse(URL(string: "https://ebda3.me/order?id=abc&k=def")), .open(URL(string: "https://ebda3.me/order?id=abc&k=def")!))
        XCTAssertEqual(links.parse(URL(string: "https://www.ebda3.me/proof?t=x&k=y")), .open(URL(string: "https://ebda3.me/proof?t=x&k=y")!))
        XCTAssertEqual(links.parse(URL(string: "http://ebda3.me")), .open(URL(string: "https://ebda3.me/")!))
    }

    func testOpenWithAnAddress() {
        XCTAssertEqual(
            links.parse(URL(string: "me.ebda3.app://open?url=https%3A%2F%2Febda3.me%2Forder%3Fid%3D1%26k%3D2")),
            .open(URL(string: "https://ebda3.me/order?id=1&k=2")!)
        )
        XCTAssertEqual(links.parse(URL(string: "me.ebda3.app://open?url=https%3A%2F%2Fevil.com%2F")), .none)
        XCTAssertEqual(links.parse(URL(string: "me.ebda3.app://open")), .none)
    }

    func testSignInAnswers() {
        let url = URL(string: "me.ebda3.app://auth?code=abc123")!
        XCTAssertEqual(links.parse(url), .auth(url))
    }

    func testEverythingElseIsIgnored() {
        XCTAssertEqual(links.parse(nil), .none)
        XCTAssertEqual(links.parse(URL(string: "https://evil.com/order")), .none)
        XCTAssertEqual(links.parse(URL(string: "https://ebda3.me.evil.com/")), .none)
        XCTAssertEqual(links.parse(URL(string: "https://user@ebda3.me/")), .none)
        XCTAssertEqual(links.parse(URL(string: "https://ebda3.me:8443/")), .none)
        XCTAssertEqual(links.parse(URL(string: "me.ebda3.app://other")), .none)
        XCTAssertEqual(links.parse(URL(string: "other.app://auth?code=1")), .none)
    }
}

final class SignInHandoffTests: XCTestCase {
    private let verifier = String(repeating: "v", count: 43)
    private let origin = "https://ebda3.me"

    func testACodeWithTheSecretFinishesTheSignIn() {
        let url = SignInHandoff.target(callback: URL(string: "me.ebda3.app://auth?code=abcdefghijklmnop")!, verifier: verifier,
                                       next: "cart", startedAt: Date(), siteOrigin: origin)
        XCTAssertEqual(url?.absoluteString, "https://ebda3.me/auth/app?code=abcdefghijklmnop&verifier=\(verifier)&next=cart")
    }

    func testErrorsAndStaleOrBrokenAnswersGoToTheAccountPage() {
        let error = SignInHandoff.target(callback: URL(string: "me.ebda3.app://auth?error=cancelled")!, verifier: verifier,
                                         next: nil, startedAt: Date(), siteOrigin: origin)
        XCTAssertEqual(error?.absoluteString, "https://ebda3.me/account?oauth=cancelled")
        let stale = SignInHandoff.target(callback: URL(string: "me.ebda3.app://auth?code=abcdefghijklmnop")!, verifier: verifier,
                                         next: nil, startedAt: Date(timeIntervalSinceNow: -3600), siteOrigin: origin)
        XCTAssertEqual(stale?.absoluteString, "https://ebda3.me/account?oauth=failed")
        let odd = SignInHandoff.target(callback: URL(string: "me.ebda3.app://auth?code=%3Cscript%3E&error=%3Cx%3E")!,
                                       verifier: verifier, next: nil, startedAt: Date(), siteOrigin: origin)
        XCTAssertEqual(odd?.absoluteString, "https://ebda3.me/account?oauth=failed")
    }

    func testConnectionErrors() {
        XCTAssertTrue(ConnectionErrors.isConnectionError(NSError(domain: NSURLErrorDomain, code: NSURLErrorNotConnectedToInternet)))
        XCTAssertTrue(ConnectionErrors.isConnectionError(NSError(domain: NSURLErrorDomain, code: NSURLErrorTimedOut)))
        XCTAssertFalse(ConnectionErrors.isConnectionError(NSError(domain: NSURLErrorDomain, code: NSURLErrorCancelled)))
        XCTAssertFalse(ConnectionErrors.isConnectionError(NSError(domain: "WebKitErrorDomain", code: 102)))
    }
}
