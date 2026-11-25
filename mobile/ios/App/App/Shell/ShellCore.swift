import Foundation

// The app's decisions about links, in plain Swift (Foundation only), so they are tested on their own
// (ios/ShellCoreTests, `swift test`). They match the Android app's LinkPolicy.java and DeepLinks.java.

/// Where a link opens.
public enum LinkAction: Equatable {
    /// Let the web view load it.
    case load
    /// Load this address in the web view instead (the shop's own address for www. or http: links).
    case rewrite(URL)
    /// Open in an in-app browser tab (SFSafariViewController).
    case inAppBrowser
    /// Hand to the phone (another app, the phone app, mail…).
    case external
    /// Do nothing.
    case block
}

/// Links that open the app.
public enum DeepLink: Equatable {
    /// Open this shop page in the app.
    case open(URL)
    /// The answer of a sign-in done in the phone's browser.
    case auth(URL)
    case none
}

public final class LinkPolicy {
    /// Hosts whose links are better in their own app than in a browser tab.
    static let appHosts: Set<String> = [
        "wa.me", "api.whatsapp.com", "chat.whatsapp.com", "whatsapp.com", "www.whatsapp.com",
        "facebook.com", "www.facebook.com", "m.facebook.com", "fb.com", "fb.me", "m.me",
        "instagram.com", "www.instagram.com", "instagr.am",
        "tiktok.com", "www.tiktok.com", "vm.tiktok.com",
        "youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be",
        "x.com", "twitter.com", "t.me", "telegram.me",
        "maps.google.com", "maps.app.goo.gl", "goo.gl",
        "play.google.com", "apps.apple.com", "itunes.apple.com"
    ]

    /// Schemes a page must never open.
    static let blockedSchemes: Set<String> = ["file", "content", "chrome", "chrome-extension", "android-app", "jar", "ftp"]

    public let siteScheme: String
    public let siteHost: String
    public let sitePort: Int
    public let localScheme: String
    public let localHost: String
    public private(set) var inAppHosts: Set<String> = []

    /// - Parameters:
    ///   - site: the shop (server.url), e.g. https://ebda3.me
    ///   - localScheme/localHost: the app's own pages, e.g. capacitor://localhost
    public init(site: URL, localScheme: String, localHost: String) {
        siteScheme = (site.scheme ?? "https").lowercased()
        siteHost = (site.host ?? "").lowercased()
        sitePort = LinkPolicy.normalPort(scheme: siteScheme, port: site.port)
        self.localScheme = localScheme.lowercased()
        self.localHost = localHost.lowercased()
    }

    /// Hosts the shop's remote config allows inside the app (exact host names, https only).
    public func setInAppHosts(_ hosts: [String]) {
        var clean = Set<String>()
        for host in hosts.prefix(20) {
            let h = host.lowercased()
            if LinkPolicy.isHostName(h), h != siteHost, h != localHost { clean.insert(h) }
        }
        inAppHosts = clean
    }

    /// The shop's origin, e.g. "https://ebda3.me".
    public var siteOrigin: String {
        let defaultPort = sitePort == LinkPolicy.normalPort(scheme: siteScheme, port: nil)
        return "\(siteScheme)://\(siteHost)" + (defaultPort ? "" : ":\(sitePort)")
    }

    public func isSite(_ url: URL) -> Bool {
        let scheme = (url.scheme ?? "").lowercased()
        return scheme == siteScheme && (url.host ?? "").lowercased() == siteHost
            && LinkPolicy.normalPort(scheme: scheme, port: url.port) == sitePort
    }

    public func isLocal(_ url: URL) -> Bool {
        return (url.scheme ?? "").lowercased() == localScheme && (url.host ?? "").lowercased() == localHost
            && url.port == nil
    }

    public func isInAppHost(_ url: URL) -> Bool {
        return (url.scheme ?? "").lowercased() == "https" && inAppHosts.contains((url.host ?? "").lowercased())
    }

    /// "www.ebda3.me" for "ebda3.me" and the other way round.
    public func isWwwTwin(_ host: String) -> Bool {
        let h = host.lowercased()
        if h.isEmpty || h == siteHost { return false }
        return h == "www." + siteHost || (siteHost.hasPrefix("www.") && h == String(siteHost.dropFirst(4)))
    }

    public func decide(_ url: URL, mainFrame: Bool) -> LinkAction {
        let scheme = (url.scheme ?? "").lowercased()
        let host = (url.host ?? "").lowercased()
        if scheme.isEmpty { return .block }
        if ["about", "data", "blob", "javascript"].contains(scheme) { return .load }
        if isLocal(url) { return .load }
        let web = scheme == "http" || scheme == "https"
        if !mainFrame { return web ? .load : .block }
        if LinkPolicy.blockedSchemes.contains(scheme) { return .block }
        if !web { return .external }
        if host.isEmpty { return .block }

        if isSite(url) { return .load }

        let defaultPort = LinkPolicy.normalPort(scheme: scheme, port: url.port) == LinkPolicy.normalPort(scheme: scheme, port: nil)
        let siteOnDefaultPort = sitePort == LinkPolicy.normalPort(scheme: siteScheme, port: nil)
        if defaultPort && ((host == siteHost && siteOnDefaultPort) || isWwwTwin(host)) {
            if let rewritten = URL(string: siteOrigin + LinkPolicy.rest(of: url)) { return .rewrite(rewritten) }
            return .block
        }

        if isInAppHost(url) { return .load }
        if LinkPolicy.appHosts.contains(host) && !LinkPolicy.isOAuthDialog(host: host, url: url) { return .external }
        return .inAppBrowser
    }

    /// Path, query and fragment, as they were written ("/" when empty).
    static func rest(of url: URL) -> String {
        guard let c = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return "/" }
        var s = c.percentEncodedPath.isEmpty ? "/" : c.percentEncodedPath
        if let q = c.percentEncodedQuery { s += "?" + q }
        if let f = c.percentEncodedFragment { s += "#" + f }
        return s
    }

    // Facebook's sign-in page must stay in a browser tab, not jump to the Facebook app.
    static func isOAuthDialog(host: String, url: URL) -> Bool {
        guard host.contains("facebook.com") else { return false }
        let path = url.path.lowercased()
        return path.hasPrefix("/dialog/oauth") || path.range(of: "^/v[0-9.]+/dialog/oauth", options: .regularExpression) != nil
    }

    static func isHostName(_ host: String) -> Bool {
        guard host.count <= 253 else { return false }
        let pattern = "^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$"
        return host.range(of: pattern, options: .regularExpression) != nil
    }

    static func normalPort(scheme: String, port: Int?) -> Int {
        if let p = port, p > 0 { return p }
        switch scheme {
        case "https": return 443
        case "http": return 80
        default: return -1
        }
    }
}

/// Parses links that open the app:
/// - https://ebda3.me/… and https://www.ebda3.me/… (universal links, e.g. an order link in WhatsApp);
/// - me.ebda3.app://open?url=<a shop address>;
/// - me.ebda3.app://auth?… (the answer of a sign-in in the phone's browser).
public struct DeepLinks {
    public let policy: LinkPolicy
    public let appScheme: String

    public init(policy: LinkPolicy, appScheme: String) {
        self.policy = policy
        self.appScheme = appScheme.lowercased()
    }

    public func parse(_ url: URL?) -> DeepLink {
        guard let url = url, let scheme = url.scheme?.lowercased() else { return .none }
        if scheme == appScheme {
            switch (url.host ?? "").lowercased() {
            case "auth":
                return .auth(url)
            case "open":
                let target = URLComponents(url: url, resolvingAgainstBaseURL: false)?
                    .queryItems?.first(where: { $0.name == "url" })?.value
                guard let t = target, let u = URL(string: t) else { return .none }
                return shopPage(u)
            default:
                return .none
            }
        }
        if scheme == "http" || scheme == "https" { return shopPage(url) }
        return .none
    }

    /// The shop page an address points to (as the app loads it), or none.
    public func shopPage(_ url: URL) -> DeepLink {
        let scheme = (url.scheme ?? "").lowercased()
        let host = (url.host ?? "").lowercased()
        guard scheme == "http" || scheme == "https", !host.isEmpty, url.user == nil, url.password == nil else { return .none }
        if policy.isSite(url) { return .open(url) }
        let defaultPort = LinkPolicy.normalPort(scheme: scheme, port: url.port) == LinkPolicy.normalPort(scheme: scheme, port: nil)
        if defaultPort && (host == policy.siteHost || policy.isWwwTwin(host)),
           let u = URL(string: policy.siteOrigin + LinkPolicy.rest(of: url)) {
            return .open(u)
        }
        return .none
    }
}

/// Finishing a sign-in done in the phone's browser (see ShellPlugin.signIn).
public enum SignInHandoff {
    /// The page the app opens with the shop's answer: /auth/app?code=…&verifier=… when the answer has a code and the
    /// app still holds the secret (verifier) from less than 15 minutes ago; otherwise the account page with the reason.
    public static func target(callback: URL, verifier: String?, next: String?, startedAt: Date?, siteOrigin: String,
                              now: Date = Date()) -> URL? {
        let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems ?? []
        let code = items.first(where: { $0.name == "code" })?.value
        let error = items.first(where: { $0.name == "error" })?.value
        let back = next == "cart" ? "&next=cart" : ""
        let fresh = startedAt.map { now.timeIntervalSince($0) < 15 * 60 } ?? false
        if let code = code, matches(code, "^[A-Za-z0-9_-]{16,256}$"), let verifier = verifier,
           matches(verifier, "^[A-Za-z0-9_-]{43,128}$"), fresh {
            return URL(string: "\(siteOrigin)/auth/app?code=\(code)&verifier=\(verifier)\(back)")
        }
        let reason = error.flatMap { matches($0, "^[a-z_]{1,32}$") ? $0 : nil } ?? "failed"
        return URL(string: "\(siteOrigin)/account?oauth=\(reason)\(back)")
    }

    static func matches(_ s: String, _ pattern: String) -> Bool {
        return s.range(of: pattern, options: .regularExpression) != nil
    }
}

/// Is this error a connection problem (show the "no connection" page), or something else (leave it)?
public enum ConnectionErrors {
    static let codes: Set<Int> = [
        NSURLErrorNotConnectedToInternet, NSURLErrorNetworkConnectionLost, NSURLErrorTimedOut,
        NSURLErrorCannotFindHost, NSURLErrorCannotConnectToHost, NSURLErrorDNSLookupFailed,
        NSURLErrorInternationalRoamingOff, NSURLErrorDataNotAllowed, NSURLErrorCallIsActive,
        NSURLErrorSecureConnectionFailed, NSURLErrorServerCertificateUntrusted,
        NSURLErrorServerCertificateHasBadDate, NSURLErrorServerCertificateHasUnknownRoot,
        NSURLErrorServerCertificateNotYetValid, NSURLErrorCannotLoadFromNetwork,
        NSURLErrorBadServerResponse, NSURLErrorZeroByteResource
    ]

    public static func isConnectionError(_ error: Error) -> Bool {
        let e = error as NSError
        return e.domain == NSURLErrorDomain && codes.contains(e.code)
    }
}
