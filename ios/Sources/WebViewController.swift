import UIKit
import WebKit

/// 极简原生外壳：一个全屏 WKWebView，加载线上站点。
final class WebViewController: UIViewController, WKNavigationDelegate, WKUIDelegate {
    private var webView: WKWebView!
    private let errorView = UIStackView()
    private let errorLabel = UILabel()

    override func loadView() {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        // 生成语音后由页面脚本加载播放器，不一定处在点击手势内，所以放开自动播放限制
        config.mediaTypesRequiringUserActionForPlayback = []

        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.backgroundColor = .systemBackground
        webView.scrollView.contentInsetAdjustmentBehavior = .automatic

        errorLabel.numberOfLines = 0
        errorLabel.textAlignment = .center
        errorLabel.textColor = .secondaryLabel
        let retry = UIButton(type: .system)
        retry.setTitle("重试", for: .normal)
        retry.addTarget(self, action: #selector(reload), for: .touchUpInside)
        errorView.axis = .vertical
        errorView.spacing = 16
        errorView.alignment = .center
        errorView.isHidden = true
        errorView.addArrangedSubview(errorLabel)
        errorView.addArrangedSubview(retry)
        errorView.translatesAutoresizingMaskIntoConstraints = false

        let root = UIView()
        root.backgroundColor = .systemBackground
        webView.translatesAutoresizingMaskIntoConstraints = false
        root.addSubview(webView)
        root.addSubview(errorView)
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: root.topAnchor),
            webView.bottomAnchor.constraint(equalTo: root.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            errorView.centerXAnchor.constraint(equalTo: root.centerXAnchor),
            errorView.centerYAnchor.constraint(equalTo: root.centerYAnchor),
            errorView.leadingAnchor.constraint(greaterThanOrEqualTo: root.leadingAnchor, constant: 32),
            errorView.trailingAnchor.constraint(lessThanOrEqualTo: root.trailingAnchor, constant: -32),
        ])
        view = root
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        load()
    }

    private func load() {
        errorView.isHidden = true
        webView.load(URLRequest(url: AppConfig.startURL, cachePolicy: .useProtocolCachePolicy, timeoutInterval: 30))
    }

    @objc private func reload() {
        if webView.url == nil { load() } else { webView.reload(); errorView.isHidden = true }
    }

    private func showError(_ error: Error) {
        let code = (error as NSError).code
        if code == NSURLErrorCancelled { return }
        errorLabel.text = "无法加载页面，请检查网络后重试。\n（错误码 \(code)）"
        errorView.isHidden = false
    }

    // MARK: - WKNavigationDelegate

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        errorView.isHidden = true
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        showError(error)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        showError(error)
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        webView.reload()
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = navigationAction.request.url else { return decisionHandler(.cancel) }
        switch url.scheme?.lowercased() {
        case "http", "https", "about", "blob", "data":
            // 页内导航都留在 App 内（包括 Vercel 的登录跳转，否则受保护的预览地址无法登录）
            decisionHandler(.allow)
        default:
            // tel: mailto: 等交给系统处理
            UIApplication.shared.open(url)
            decisionHandler(.cancel)
        }
    }

    // MARK: - WKUIDelegate

    // target=_blank 的链接用系统浏览器打开，不在 App 里新开窗口
    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if navigationAction.targetFrame == nil, let url = navigationAction.request.url {
            UIApplication.shared.open(url)
        }
        return nil
    }

    // 麦克风：以后页面录音时，只对本应用自己的域名授权
    @available(iOS 15.0, *)
    func webView(
        _ webView: WKWebView,
        requestMediaCapturePermissionFor origin: WKSecurityOrigin,
        initiatedByFrame frame: WKFrameInfo,
        type: WKMediaCaptureType,
        decisionHandler: @escaping (WKPermissionDecision) -> Void
    ) {
        decisionHandler(origin.host == AppConfig.startURL.host ? .prompt : .deny)
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptAlertPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping () -> Void
    ) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "好", style: .default) { _ in completionHandler() })
        present(alert, animated: true)
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptConfirmPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping (Bool) -> Void
    ) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "取消", style: .cancel) { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: "确定", style: .default) { _ in completionHandler(true) })
        present(alert, animated: true)
    }
}
