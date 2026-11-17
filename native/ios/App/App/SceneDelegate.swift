import UIKit
import WebKit
import Capacitor

// ScoreAtlas's one screen: the web app (in public/) in Capacitor's web view, plus what only the app itself can do:
// open files sent to ScoreAtlas (Files, AirDrop, Mail), and keep the screen on while the music is up.
class ScoreAtlasViewController: CAPBridgeViewController, WKScriptMessageHandler {
    private var pageReady = false
    private var waiting: [(URL, String)] = []

    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        // messages from the web app: { ready: true } once it can open files, { keepAwake: Bool }
        bridge?.webView?.configuration.userContentController.add(self, name: "scoreAtlas")
        UIApplication.shared.isIdleTimerDisabled = true // the screen stays on (the web app can change this in Settings)
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any] else { return }
        if let awake = body["keepAwake"] as? Bool { UIApplication.shared.isIdleTimerDisabled = awake }
        if body["ready"] as? Bool == true {
            pageReady = true
            let files = waiting
            waiting = []
            for (url, name) in files { hand(url, name) }
        }
    }

    // A file sent to ScoreAtlas: copied where the web view may read it, then handed to the web app
    func open(_ url: URL) {
        let reading = url.startAccessingSecurityScopedResource()
        defer { if reading { url.stopAccessingSecurityScopedResource() } }
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("Opened", isDirectory: true)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let name = url.lastPathComponent
        let copy = folder.appendingPathComponent(UUID().uuidString + "-" + name)
        do { try FileManager.default.copyItem(at: url, to: copy) } catch { return }
        if pageReady { hand(copy, name) } else { waiting.append((copy, name)) }
    }

    private func hand(_ url: URL, _ name: String) {
        let quote = { (s: String) -> String in
            let data = try? JSONSerialization.data(withJSONObject: [s])
            let text = data.flatMap { String(data: $0, encoding: .utf8) } ?? "[\"\"]"
            return String(text.dropFirst().dropLast())
        }
        bridge?.webView?.evaluateJavaScript("window.scoreAtlasOpen(\(quote(url.absoluteString)), \(quote(name)))", completionHandler: nil)
    }
}

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?
    private let screen = ScoreAtlasViewController()

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = screen
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
        // opened by tapping a file (ScoreAtlas wasn't running yet)
        for context in connectionOptions.urlContexts where context.url.isFileURL { screen.open(context.url) }
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        for context in URLContexts where context.url.isFileURL { screen.open(context.url) }
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
