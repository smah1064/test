import AuthenticationServices
import Capacitor
import SafariServices
import UIKit
import WebKit

/// The app around the shop (JS name "Ebda3Shell"); the iPhone twin of android/…/shell/ShellPlugin.java.
///
/// It decides where links open (LinkPolicy), opens the shop pages that links to the app point to (DeepLinks),
/// shows the "no connection" page for connection errors (with ShellNavigationProxy), and gives the page glue
/// (www/app-glue.js) its methods: open, print, saveFile, setRemoteConfig, signIn, getInfo.
@objc(Ebda3ShellPlugin)
public class ShellPlugin: CAPPlugin, CAPBridgedPlugin, ASWebAuthenticationPresentationContextProviding {
    public let identifier = "Ebda3ShellPlugin"
    public let jsName = "Ebda3Shell"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getInfo", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "open", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "print", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "saveFile", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setRemoteConfig", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "signIn", returnType: CAPPluginReturnPromise)
    ]

    static let appScheme = "me.ebda3.app"
    static let offlineFile = "offline.html"
    static let maxSaveBytes = 60 * 1024 * 1024
    private static let inAppHostsKey = "ebda3.inAppHosts"

    private(set) var policy: LinkPolicy!
    private var deepLinks: DeepLinks!
    private var authSession: ASWebAuthenticationSession?
    private var observers: [NSObjectProtocol] = []

    // MARK: - start

    override public func load() {
        let site = bridge?.config.serverURL ?? URL(string: "https://ebda3.me")!
        let local = bridge?.config.localURL ?? URL(string: "capacitor://localhost")!
        policy = LinkPolicy(site: site, localScheme: local.scheme ?? "capacitor", localHost: local.host ?? "localhost")
        policy.setInAppHosts(UserDefaults.standard.stringArray(forKey: ShellPlugin.inAppHostsKey) ?? [])
        deepLinks = DeepLinks(policy: policy, appScheme: ShellPlugin.appScheme)

        // Links that open the app (custom scheme and universal links), also on a cold start: Capacitor delivers
        // those once the screen has appeared, after the plugins are loaded.
        let center = NotificationCenter.default
        for name in [Notification.Name.capacitorOpenURL, Notification.Name.capacitorOpenUniversalLink] {
            observers.append(center.addObserver(forName: name, object: nil, queue: .main) { [weak self] note in
                guard let info = note.object as? [String: Any], let url = info["url"] as? URL else { return }
                self?.openFromOutside(url)
            })
        }
    }

    deinit {
        observers.forEach { NotificationCenter.default.removeObserver($0) }
    }

    /// The script the app puts in front of every page: the app's facts, then the glue.
    func glueScript() -> String? {
        guard let url = Bundle.main.url(forResource: "app-glue", withExtension: "js", subdirectory: "public"),
              let glue = try? String(contentsOf: url, encoding: .utf8) else {
            CAPLog.print("⚡️ Ebda3Shell: public/app-glue.js is missing from the app")
            return nil
        }
        guard let data = try? JSONSerialization.data(withJSONObject: appConfig()),
              let json = String(data: data, encoding: .utf8) else { return nil }
        return "window.__ebda3AppConfig = \(json);\n" + glue
    }

    func appConfig() -> [String: Any] {
        let info = Bundle.main.infoDictionary ?? [:]
        return [
            "platform": "ios",
            "version": info["CFBundleShortVersionString"] as? String ?? "",
            "build": Int(info["CFBundleVersion"] as? String ?? "") ?? 0,
            "siteOrigin": policy.siteOrigin,
            "appScheme": ShellPlugin.appScheme,
            // Push needs the Apple push setup (entitlement and key); Info.plist says when it's done.
            "push": info["Ebda3PushEnabled"] as? Bool ?? false,
            "os": UIDevice.current.systemVersion
        ]
    }

    // MARK: - navigation

    /// Capacitor asks every plugin first; true = cancel (handled here), false = load, nil = Capacitor decides.
    override public func shouldOverrideLoad(_ navigationAction: WKNavigationAction) -> NSNumber? {
        guard let url = navigationAction.request.url else { return nil }
        // targetFrame nil = a new window (target="_blank", window.open).
        let newWindow = navigationAction.targetFrame == nil
        let mainFrame = newWindow || navigationAction.targetFrame?.isMainFrame == true
        let decision = policy.decide(url, mainFrame: mainFrame)
        // A form sent to another site (e.g. a bank's card check during a payment) stays in the app: an in-app browser
        // would open it without the form's data. Android's web view loads such forms in place too.
        if case .inAppBrowser = decision, (navigationAction.request.httpMethod ?? "GET").uppercased() == "POST", !newWindow {
            return false
        }
        switch decision {
        case .load:
            if newWindow {
                // Capacitor would send a new window of the shop to Safari: keep it in the app instead.
                webView?.load(navigationAction.request)
                return true
            }
            return false
        case .rewrite(let target):
            webView?.load(URLRequest(url: target))
            return true
        case .inAppBrowser:
            openInAppBrowser(url)
            return true
        case .external:
            openExternal(url)
            return true
        case .block:
            CAPLog.print("⚡️ Ebda3Shell: blocked \(url.absoluteString)")
            return true
        }
    }

    func openInAppBrowser(_ url: URL) {
        DispatchQueue.main.async {
            guard let presenter = self.bridge?.viewController else { return }
            let safari = SFSafariViewController(url: url)
            safari.preferredControlTintColor = UIColor(red: 0.086, green: 0.094, blue: 0.114, alpha: 1)
            safari.dismissButtonStyle = .close
            presenter.present(safari, animated: true)
        }
    }

    func openExternal(_ url: URL) {
        DispatchQueue.main.async {
            UIApplication.shared.open(url, options: [:]) { opened in
                if !opened, let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https" {
                    self.openInAppBrowser(url)
                }
            }
        }
    }

    /// A link from outside (WhatsApp, a notification, the sign-in answer…).
    func openFromOutside(_ url: URL) {
        switch deepLinks.parse(url) {
        case .open(let page):
            webView?.load(URLRequest(url: page))
        case .auth:
            break // answered inside the sign-in session (signIn)
        case .none:
            break
        }
    }

    /// True when the page on screen is one of the shop's own (iOS gives the plugin bridge to every page). Main thread.
    private func fromShop() -> Bool {
        dispatchPrecondition(condition: .onQueue(.main))
        guard let url = webView?.url else { return false }
        return policy.isSite(url) || policy.isLocal(url)
    }

    // MARK: - the "no connection" page

    var offlinePageURL: URL? {
        return bridge?.config.localURL.appendingPathComponent(ShellPlugin.offlineFile)
    }

    /// Shows the "no connection" page in place of a shop page that couldn't be reached.
    func showOffline(failed: URL?) {
        guard let failed = failed, let offline = offlinePageURL,
              policy.isSite(failed) || policy.isInAppHost(failed),
              var c = URLComponents(url: offline, resolvingAgainstBaseURL: false) else { return }
        c.queryItems = [URLQueryItem(name: "from", value: failed.absoluteString)]
        if let page = c.url { webView?.load(URLRequest(url: page)) }
    }

    // MARK: - methods for the page glue

    @objc func getInfo(_ call: CAPPluginCall) {
        call.resolve(appConfig())
    }

    // Capacitor calls these on its own queue; anything about the page or the link rules happens on the main thread.

    @objc func open(_ call: CAPPluginCall) {
        guard let s = call.getString("url"), let url = URL(string: s) else { return call.reject("url is required") }
        DispatchQueue.main.async {
            guard self.fromShop() else { return call.reject("Not allowed here") }
            switch self.policy.decide(url, mainFrame: true) {
            case .load:
                self.webView?.load(URLRequest(url: url))
                call.resolve(["action": "load"])
            case .rewrite(let target):
                self.webView?.load(URLRequest(url: target))
                call.resolve(["action": "rewrite"])
            case .inAppBrowser:
                self.openInAppBrowser(url)
                call.resolve(["action": "in_app_browser"])
            case .external:
                self.openExternal(url)
                call.resolve(["action": "external"])
            case .block:
                call.reject("This link can't be opened", "BLOCKED")
            }
        }
    }

    /// The phone's print screen for the page on screen (it can also save a PDF).
    @objc func print(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.fromShop() else { return call.reject("Not allowed here") }
            guard let webView = self.webView else { return call.reject("No page") }
            let info = UIPrintInfo(dictionary: nil)
            info.outputType = .general
            info.jobName = call.getString("name") ?? "ebda3"
            let controller = UIPrintInteractionController.shared
            controller.printInfo = info
            controller.printFormatter = webView.viewPrintFormatter()
            controller.present(animated: true) { _, completed, error in
                if let error = error {
                    call.reject(error.localizedDescription)
                } else {
                    call.resolve(["printed": completed])
                }
            }
        }
    }

    /// Saves a file the page made, through the share sheet ("Save Image", "Save to Files", WhatsApp…).
    @objc func saveFile(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.fromShop() else { return call.reject("Not allowed here") }
            DispatchQueue.global(qos: .userInitiated).async { self.writeAndShare(call) }
        }
    }

    private func writeAndShare(_ call: CAPPluginCall) {
        guard let base64 = call.getString("data"), base64.count <= ShellPlugin.maxSaveBytes * 4 / 3 + 4,
              let data = Data(base64Encoded: base64, options: .ignoreUnknownCharacters) else {
            return call.reject("data is missing, too large or not base64")
        }
        let name = ShellPlugin.cleanName(call.getString("name"))
        let shared = FileManager.default.temporaryDirectory.appendingPathComponent("shared", isDirectory: true)
        ShellPlugin.removeOld(in: shared, olderThan: 24 * 3600)
        // Each file in its own folder, kept a day: the app it was shared to may read it later.
        let dir = shared.appendingPathComponent(UUID().uuidString, isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            let file = dir.appendingPathComponent(name)
            try data.write(to: file, options: .atomic)
            DispatchQueue.main.async {
                guard let presenter = self.bridge?.viewController else { return call.reject("No screen") }
                let sheet = UIActivityViewController(activityItems: [file], applicationActivities: nil)
                sheet.completionWithItemsHandler = { _, completed, _, error in
                    if let error = error {
                        call.reject(error.localizedDescription)
                    } else if completed {
                        call.resolve(["where": "shared", "name": name])
                    } else {
                        call.reject("cancelled", "CANCELLED")
                    }
                }
                self.setCenteredPopover(sheet)
                presenter.present(sheet, animated: true)
            }
        } catch {
            call.reject("Could not save the file", nil, error)
        }
    }

    static func removeOld(in dir: URL, olderThan seconds: TimeInterval) {
        let fm = FileManager.default
        guard let items = try? fm.contentsOfDirectory(at: dir, includingPropertiesForKeys: [.contentModificationDateKey]) else { return }
        for item in items {
            let changed = (try? item.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate ?? .distantPast
            if Date().timeIntervalSince(changed) > seconds { try? fm.removeItem(at: item) }
        }
    }

    static func cleanName(_ name: String?) -> String {
        var n = (name ?? "").replacingOccurrences(of: "[\\\\/:*?\"<>|\\p{Cc}]+", with: "-", options: .regularExpression)
        n = n.replacingOccurrences(of: "^[.\\s]+", with: "", options: .regularExpression).trimmingCharacters(in: .whitespaces)
        if n.count > 120 { n = String(n.suffix(120)) }
        return n.isEmpty ? "ebda3" : n
    }

    /// The shop's remote config can allow a few more hosts inside the app (e.g. a payment page).
    @objc func setRemoteConfig(_ call: CAPPluginCall) {
        let hosts = (call.getArray("inAppHosts") ?? []).compactMap { $0 as? String }
        DispatchQueue.main.async {
            guard self.fromShop() else { return call.reject("Not allowed here") }
            self.policy.setInAppHosts(hosts)
            let kept = Array(self.policy.inAppHosts).sorted()
            UserDefaults.standard.set(kept, forKey: ShellPlugin.inAppHostsKey)
            call.resolve(["inAppHosts": kept])
        }
    }

    /// Google/Facebook sign-in in Apple's secure browser sheet (Google doesn't allow it inside apps' web views).
    /// The shop answers with me.ebda3.app://auth?code=… (or ?error=…); the app then finishes the sign-in in its web
    /// view with the code and the secret only it holds (verifier).
    @objc func signIn(_ call: CAPPluginCall) {
        guard let s = call.getString("url"), let url = URL(string: s), policy.isSite(url), url.path.hasPrefix("/auth/"),
              let verifier = call.getString("verifier"),
              SignInHandoff.matches(verifier, "^[A-Za-z0-9_-]{43,128}$") else {
            return call.reject("Invalid sign-in request")
        }
        let next = call.getString("next")
        let started = Date()
        DispatchQueue.main.async {
            guard self.fromShop() else { return call.reject("Not allowed here") }
            self.authSession?.cancel()
            let session = ASWebAuthenticationSession(url: url, callbackURLScheme: ShellPlugin.appScheme) { [weak self] callback, error in
                guard let self = self else { return }
                self.authSession = nil
                if let error = error {
                    if (error as? ASWebAuthenticationSessionError)?.code == .canceledLogin {
                        call.reject("cancelled", "CANCELLED")
                    } else {
                        call.reject(error.localizedDescription)
                    }
                    return
                }
                guard let callback = callback,
                      let target = SignInHandoff.target(callback: callback, verifier: verifier, next: next,
                                                        startedAt: started, siteOrigin: self.policy.siteOrigin) else {
                    return call.reject("No answer")
                }
                self.webView?.load(URLRequest(url: target))
                call.resolve(["done": true])
            }
            session.presentationContextProvider = self
            session.prefersEphemeralWebBrowserSession = false
            self.authSession = session
            if !session.start() {
                self.authSession = nil
                call.reject("Could not open the sign-in page")
            }
        }
    }

    public func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        return webView?.window ?? ASPresentationAnchor()
    }
}
