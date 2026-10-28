import AVFoundation
import UIKit

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
    ) -> Bool {
        // 播放类别：静音开关打开时也能听到语音。只设置类别，不主动激活，避免一启动就打断用户正在播放的音乐。
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default, options: [])

        let window = UIWindow(frame: UIScreen.main.bounds)
        window.rootViewController = WebViewController()
        window.makeKeyAndVisible()
        self.window = window
        return true
    }
}
