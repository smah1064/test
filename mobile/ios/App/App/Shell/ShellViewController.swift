import Capacitor
import UIKit
import WebKit

/// The shop's background colour (#FAFAF7), used around the web view.
let shellPaper = UIColor(red: 250 / 255, green: 250 / 255, blue: 247 / 255, alpha: 1)

extension Notification.Name {
    /// Posted when a page (or the "no connection" page) is on screen.
    static let ebda3ContentShown = Notification.Name("Ebda3ContentShown")
}

/// The app's screen: the shop's web view (AppBridgeViewController) kept inside the safe area, so the notch, the
/// status bar and the home indicator never cover the shop's pages (which aren't made for that), on the shop's
/// background colour. The launch logo stays on top until the first page is shown (at most a few seconds).
final class ShellViewController: UIViewController {
    let bridgeController = AppBridgeViewController()
    private var launchCover: UIView?
    private var contentObserver: NSObjectProtocol?

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = shellPaper

        addChild(bridgeController)
        let content: UIView = bridgeController.view
        content.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(content)
        let safe = view.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            content.topAnchor.constraint(equalTo: safe.topAnchor),
            content.bottomAnchor.constraint(equalTo: safe.bottomAnchor),
            content.leadingAnchor.constraint(equalTo: safe.leadingAnchor),
            content.trailingAnchor.constraint(equalTo: safe.trailingAnchor)
        ])
        bridgeController.didMove(toParent: self)

        showLaunchCover()
    }

    override var preferredStatusBarStyle: UIStatusBarStyle {
        return .darkContent
    }

    // MARK: - launch cover

    private func showLaunchCover() {
        let cover = UIView()
        cover.backgroundColor = shellPaper
        cover.translatesAutoresizingMaskIntoConstraints = false
        let logo = UIImageView(image: UIImage(named: "LaunchLogo"))
        logo.contentMode = .scaleAspectFit
        logo.translatesAutoresizingMaskIntoConstraints = false
        cover.addSubview(logo)
        view.addSubview(cover)
        NSLayoutConstraint.activate([
            cover.topAnchor.constraint(equalTo: view.topAnchor),
            cover.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            cover.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            cover.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            // Same place and size as the launch screen (LaunchScreen.storyboard), so the switch can't be seen.
            logo.centerXAnchor.constraint(equalTo: cover.centerXAnchor),
            logo.centerYAnchor.constraint(equalTo: cover.centerYAnchor),
            logo.widthAnchor.constraint(equalToConstant: 128),
            logo.heightAnchor.constraint(equalToConstant: 128)
        ])
        launchCover = cover
        contentObserver = NotificationCenter.default.addObserver(forName: .ebda3ContentShown, object: nil, queue: .main) { [weak self] _ in
            self?.hideLaunchCover()
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 6) { [weak self] in
            self?.hideLaunchCover()
        }
    }

    private func hideLaunchCover() {
        if let observer = contentObserver {
            NotificationCenter.default.removeObserver(observer)
            contentObserver = nil
        }
        guard let cover = launchCover else { return }
        launchCover = nil
        UIView.animate(withDuration: 0.2, animations: { cover.alpha = 0 }, completion: { _ in cover.removeFromSuperview() })
    }
}

/// Capacitor's screen with the app's additions: the app's plugin, the page glue in front of every page, swipe to go
/// back, and the "no connection" page for connection errors (ShellNavigationProxy).
final class AppBridgeViewController: CAPBridgeViewController {
    private let shell = ShellPlugin()
    private var navigationProxy: ShellNavigationProxy?

    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        bridge?.registerPluginInstance(shell)
        guard let webView = webView else { return }

        webView.allowsBackForwardNavigationGestures = true
        webView.isOpaque = false
        webView.backgroundColor = shellPaper
        webView.scrollView.backgroundColor = shellPaper

        if let script = shell.glueScript() {
            webView.configuration.userContentController.addUserScript(
                WKUserScript(source: script, injectionTime: .atDocumentStart, forMainFrameOnly: true)
            )
        }

        if let capacitorDelegate = webView.navigationDelegate {
            let proxy = ShellNavigationProxy(capacitor: capacitorDelegate, shell: shell)
            navigationProxy = proxy // the web view only keeps a weak reference
            webView.navigationDelegate = proxy
        }

        // The "no connection" page asks the app whether the shop can be reached again (it can't see the shop's
        // answers itself: another site).
        if let config = bridge?.config {
            webView.configuration.userContentController.addScriptMessageHandler(
                OnlineCheck(site: config.serverURL, local: config.localURL), contentWorld: .page, name: OnlineCheck.name
            )
        }

        // Capacitor's message channel ("bridge") is open to every frame of a page on iOS; let only the page itself
        // (the main frame) talk to the app, like Capacitor does on Android. Capacitor's own clean-up removes it by name.
        if let handler = (bridge as? CapacitorBridge)?.webViewDelegationHandler {
            let contents = webView.configuration.userContentController
            contents.removeScriptMessageHandler(forName: "bridge")
            contents.add(MainFrameOnlyMessages(target: handler), name: "bridge")
        }
    }
}

/// Passes on the bridge's messages only when they come from the page itself, never from a frame inside it.
final class MainFrameOnlyMessages: NSObject, WKScriptMessageHandler {
    private weak var target: WKScriptMessageHandler?

    init(target: WKScriptMessageHandler) {
        self.target = target
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame else { return }
        target?.userContentController(userContentController, didReceive: message)
    }
}

/// Answers the "no connection" page (www/offline.html) when it asks "can the shop be reached again?": true once the
/// shop answers at all (any answer, even an error page, means the connection is back). The page can't find out
/// itself: the shop is another site and doesn't let other sites read its answers. Only the app's own page, as the
/// page itself (not a frame inside it), gets an answer.
final class OnlineCheck: NSObject, WKScriptMessageHandlerWithReply {
    static let name = "ebda3Online"
    private let site: URL
    private let local: URL
    private let session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 6
        config.timeoutIntervalForResource = 8
        config.requestCachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        config.waitsForConnectivity = false
        return URLSession(configuration: config)
    }()

    init(site: URL, local: URL) {
        self.site = site
        self.local = local
    }

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage,
        replyHandler: @escaping (Any?, String?) -> Void
    ) {
        let origin = message.frameInfo.securityOrigin
        guard message.frameInfo.isMainFrame, origin.protocol == local.scheme, origin.host == local.host else {
            return replyHandler(nil, "Not allowed here")
        }
        var probe = URLComponents(url: site, resolvingAgainstBaseURL: false)
        probe?.path = "/favicon.svg"
        probe?.fragment = nil
        probe?.queryItems = [URLQueryItem(name: "online", value: String(Int(Date().timeIntervalSince1970 * 1000)))]
        guard let url = probe?.url else { return replyHandler(false, nil) }
        var request = URLRequest(url: url)
        request.httpMethod = "HEAD"
        session.dataTask(with: request) { _, response, error in
            let online = response is HTTPURLResponse
            if !online { shellLog("shop not reachable yet (\((error as NSError?)?.code ?? 0))") }
            DispatchQueue.main.async { replyHandler(online, nil) }
        }.resume()
    }
}

/// Sits in front of Capacitor's navigation delegate: passes everything on, and on a connection error for a shop page
/// shows the app's "no connection" page (Capacitor's own error page would also come for cancelled loads and replace
/// the shop's own error pages).
final class ShellNavigationProxy: NSObject, WKNavigationDelegate {
    private weak var capacitor: WKNavigationDelegate?
    private weak var shell: ShellPlugin?
    // Capacitor's delegate is also the web view's UI delegate and the bridge's message handler, so it lives as long
    // as the web view; it is kept weakly here to avoid a cycle.

    init(capacitor: WKNavigationDelegate, shell: ShellPlugin) {
        self.capacitor = capacitor
        self.shell = shell
    }

    override func responds(to aSelector: Selector!) -> Bool {
        return super.responds(to: aSelector) || (capacitor?.responds(to: aSelector) ?? false)
    }

    // Everything this class doesn't implement (deciding which links load, sign-in challenges, a crashed web
    // process…) goes straight to Capacitor's delegate.
    override func forwardingTarget(for aSelector: Selector!) -> Any? {
        if let capacitor = capacitor, capacitor.responds(to: aSelector) { return capacitor }
        return super.forwardingTarget(for: aSelector)
    }

    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        capacitor?.webView?(webView, didCommit: navigation)
        NotificationCenter.default.post(name: .ebda3ContentShown, object: nil)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        capacitor?.webView?(webView, didFinish: navigation)
        NotificationCenter.default.post(name: .ebda3ContentShown, object: nil)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        capacitor?.webView?(webView, didFailProvisionalNavigation: navigation, withError: error)
        handle(error)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        capacitor?.webView?(webView, didFail: navigation, withError: error)
        handle(error)
    }

    private func handle(_ error: Error) {
        guard ConnectionErrors.isConnectionError(error) else { return }
        let failed = (error as NSError).userInfo[NSURLErrorFailingURLErrorKey] as? URL
        shell?.showOffline(failed: failed)
        NotificationCenter.default.post(name: .ebda3ContentShown, object: nil)
    }
}
