package me.ebda3.app.shell;

import android.net.Uri;
import android.net.http.SslError;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.SslErrorHandler;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;
import com.getcapacitor.Logger;

/**
 * Capacitor's web view client plus the app's rules: links (LinkPolicy), the app's own local pages, the
 * "no connection" page for connection errors only (the shop's own error pages are shown as they are), and
 * recovery when Android stops the web view's process.
 */
public class ShellWebViewClient extends BridgeWebViewClient {

    private final ShellPlugin shell;

    public ShellWebViewClient(Bridge bridge, ShellPlugin shell) {
        super(bridge);
        this.shell = shell;
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        Uri url = request.getUrl();
        if (shell.isLocalFile(url)) return shell.localFile(url);
        return super.shouldInterceptRequest(view, request);
    }

    @Override
    public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
        return shell.handleNavigation(view, request.getUrl(), request.isForMainFrame());
    }

    @Override
    public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
        super.onReceivedError(view, request, error);
        if (request.isForMainFrame()) {
            Logger.warn(ShellPlugin.TAG, "Page failed (" + error.getErrorCode() + "): " + request.getUrl());
            shell.showOffline(view, request.getUrl());
        }
    }

    @Override
    public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
        // Never continue on a bad certificate. A shop page with one (e.g. behind a Wi-Fi sign-in page) gets the
        // "no connection" page, which tries again by itself.
        handler.cancel();
        Uri url = error.getUrl() == null ? null : Uri.parse(error.getUrl());
        Uri current = view.getUrl() == null ? null : Uri.parse(view.getUrl());
        if (url != null && shell.isShopOrLocal(url) && (current == null || url.equals(current) || !shell.isShopOrLocal(current))) {
            shell.showOffline(view, url);
        }
    }

    @Override
    public void onPageCommitVisible(WebView view, String url) {
        super.onPageCommitVisible(view, url);
        shell.onContentVisible(url);
    }

    @Override
    public void onPageFinished(WebView view, String url) {
        super.onPageFinished(view, url);
        shell.onContentVisible(url);
        String fallback = shell.fallbackScript();
        if (fallback != null && url != null) {
            Uri u = Uri.parse(url);
            if (shell.getPolicy().isSite(u.getScheme(), u.getHost(), u.getPort())) view.evaluateJavascript(fallback, null);
        }
    }

    @Override
    public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
        if (super.onRenderProcessGone(view, detail)) return true;
        // The web view can't be used any more: start the screen again (it reopens the page it was on).
        Logger.error(ShellPlugin.TAG, "Web view process gone (crash: " + detail.didCrash() + ")", null);
        shell.getActivity().recreate();
        return true;
    }
}
