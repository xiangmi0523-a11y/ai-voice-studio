import Foundation

enum AppConfig {
    /// App 加载的线上地址。前端用相对路径 /api/* 请求后端，
    /// 因为页面本身来自这个域名，所以请求是同源的，不涉及跨域，也不需要改前端。
    static let startURL = URL(string: "https://ai-voice-studio-git-feat-framework-xiangmi0523-4826.vercel.app")!
}
