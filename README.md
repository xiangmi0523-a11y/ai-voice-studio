# AI Voice Studio / 声音工作室

轻量级 AI 文字转语音工具：输入文字、选择音色，生成有表现力的语音，并可试听、下载和查看历史。

> **当前阶段：第一阶段 · 基础框架（v0.1.0）**
> 界面和接口骨架已完成，可直接预览；ElevenLabs 音色与语音生成已在服务端接入（Stage B，尚未验收上线）；**尚未接入** Supabase 登录 / 数据库 / 存储。
> 历史、收藏、音频接口返回统一格式的 `NOT_IMPLEMENTED`；`/api/voices` 与 `/api/generate` 已接入 ElevenLabs（Stage B），页面中的音色和历史示例均带 **DEMO** 标记，只存在本机浏览器中。

## 技术栈

| 层 | 选型 |
| --- | --- |
| 前端 | 原生 HTML / CSS / JavaScript（ES Modules，无框架、无构建步骤） |
| 后端 | Vercel Serverless Functions（Node.js ≥ 20） |
| 数据 | Supabase PostgreSQL、Auth、Storage（第二阶段接入） |
| 语音 | ElevenLabs API（第二阶段接入，只在服务端调用） |

项目 **零依赖**：不需要 `npm install`，手机上通过 GitHub + Vercel 即可完成预览和部署。

## 目录结构

```
ai-voice-studio/
├── public/                     # 前端静态资源（Vercel 输出目录）
│   ├── index.html              # 单页应用外壳：创作 / 历史 / 收藏 / 设置
│   ├── favicon.svg
│   ├── css/
│   │   ├── tokens.css          # 设计变量（颜色、字号、间距、圆角）
│   │   ├── base.css            # 重置与全局样式、减少动效支持
│   │   ├── components.css      # 按钮、卡片、表单、弹层、状态、提示等组件
│   │   └── views.css           # 顶栏、底部导航、各页面布局
│   └── js/
│       ├── main.js             # 入口：创建状态与服务，挂载各页面
│       ├── config.js           # 前端展示配置（模型、参数、字数上限、存储键）
│       ├── core/
│       │   ├── state.js        # 极简状态容器
│       │   ├── dom.js          # DOM 工具（只用 textContent 写入用户内容）
│       │   ├── format.js       # 格式化纯函数
│       │   └── local-store.js  # localStorage 安全封装
│       ├── services/
│       │   ├── api-client.js   # 唯一的 /api 访问入口，统一返回格式
│       │   ├── demo-data.js    # DEMO 音色与示例历史（isDemo 标记）
│       │   ├── voices.js       # 音色加载（请求失败时回退 DEMO；服务端无公开音色时清空并提示）与筛选
│       │   ├── favorites-store.js  # 收藏（本地适配器，预留云端适配器）
│       │   ├── history-store.js    # DEMO 历史（本地）+ 云端历史（接口）
│       │   └── generation.js   # 生成请求组装、前端校验、幂等键、单次生成流程（不自动重试）
│       └── ui/
│           ├── router.js       # 底部 Tab 路由（基于 hash）
│           ├── create-view.js  # 创作页
│           ├── voice-picker.js # 音色选择弹层
│           ├── voice-item.js   # 音色条目（共用）
│           ├── voice-preview.js# 音色试听
│           ├── player.js       # 播放器
│           ├── history-view.js # 历史页
│           ├── favorites-view.js # 收藏页
│           ├── settings-view.js  # 设置页
│           ├── sheet.js        # 底部弹层
│           ├── chips.js        # 筛选标签
│           └── toast.js        # 轻提示
├── api/                        # Vercel Serverless Functions
│   ├── health.js               # GET    /api/health
│   ├── voices.js               # GET    /api/voices
│   ├── generate.js             # POST   /api/generate
│   ├── history/index.js        # GET    /api/history
│   ├── history/[id].js         # DELETE /api/history/:id
│   ├── favorites/index.js      # GET / POST /api/favorites
│   ├── favorites/[voiceId].js  # DELETE /api/favorites/:voiceId
│   └── audio/[id].js           # GET    /api/audio/:id
├── lib/                        # 服务端共享模块（不会被发布为静态文件）
│   ├── config.js               # 字数上限、模型白名单、参数范围、时间预算、音频大小上限
│   ├── http.js                 # 统一响应格式、错误码、异常兜底
│   ├── validation.js           # 输入校验（UUID、音色 ID、文本、参数）
│   ├── auth.js                 # 身份校验（占位）
│   ├── rate-limit.js           # 进程内限流（尽力而为，跨实例不可靠）
│   ├── idempotency.js          # 进程内幂等（尽力而为，只在同一实例内去重）
│   ├── deadline.js             # 请求总时间预算
│   ├── tts.js                  # ElevenLabs 文字转语音（服务端，固定地址，不重试）
│   ├── voice-catalog.js        # ElevenLabs 音色目录：拉取 + 短期缓存 + 公开过滤
│   ├── public-voices.js        # PUBLIC_VOICE_IDS 解析（默认不公开任何音色）
│   ├── demo-voices.js          # DEMO 音色 ID（服务端拦截）
│   ├── storage.js              # 私有桶路径约定
│   └── logger.js               # 自动脱敏日志
├── supabase/migrations/
│   └── 20261028000000_init_schema.sql   # 数据库迁移（本阶段不执行）
├── scripts/
│   ├── dev-server.mjs          # 本地预览服务器（静态 + /api 路由）
│   └── check-project.mjs       # 静态检查
├── tests/                      # node:test 自动化测试
├── .env.example                # 环境变量示例（只有占位值）
├── vercel.json                 # 输出目录、函数配置、安全响应头
└── package.json
```

## 预览

### 手机端（推荐，无需电脑）

1. 在 Vercel 中 **Add New → Project**，导入本 GitHub 仓库。
2. Framework Preset 选 **Other**；Build Command 留空；Output Directory 已由 `vercel.json` 指定为 `public`。
3. 不需要配置任何环境变量。
4. Vercel 会为 `feat/framework` 等非生产分支自动生成 **Preview 部署**，在手机浏览器打开预览链接即可。

> 注意：合并到 `main` 后 Vercel 会触发 **生产部署**。第一阶段验收前请只使用 Preview 链接。

### 电脑本地

```bash
npm run dev          # http://localhost:3000，同一局域网手机可访问 http://<电脑IP>:3000
```

本地服务器零依赖，按 Vercel 规则把 `/api/*` 路由到 `api/` 下的函数，并附带与 `vercel.json` 相同的安全响应头。
也可以使用 `vercel dev`（需要安装 Vercel CLI）。

直接用任意静态服务器打开 `public/` 也能浏览界面，此时设置页会显示“后端接口不可连接”，生成会提示“后端接口不可用”——这是预期行为。

## 检查与测试

```bash
npm run check    # 语法检查、文件引用、import 路径、路由完整性、前端密钥扫描、.env.example 校验
npm test         # 自动化测试（接口格式、输入校验、脱敏、DEMO 隔离与保护、前端逻辑、本地服务器）
npm run verify   # 以上两项
```

## 接口约定

所有接口返回统一格式：

```jsonc
// 成功
{ "ok": true, "data": { ... }, "requestId": "..." }
// 失败
{ "ok": false, "error": { "code": "NOT_IMPLEMENTED", "message": "该功能尚未接入，将在后续阶段开放。", "details": { ... } }, "requestId": "..." }
```

| 方法 | 路径 | 当前行为 |
| --- | --- | --- |
| GET | `/api/health` | 返回阶段、版本、各功能是否已接入、服务端变量是否已配置（仅布尔值） |
| GET | `/api/voices` | 返回 `PUBLIC_VOICE_IDS` 中公开、且在 ElevenLabs 账号中真实存在的音色（不含 cloned）；未配置时返回空列表 |
| POST | `/api/generate` | 依次校验请求体大小（16KB）、输入（含“字数 ÷ 语速”限制）、DEMO 音色、公开音色允许列表、进程内幂等、进程内限流，通过后调用 ElevenLabs，成功返回 `audio/mpeg` 二进制（不保存、不缓存）。请求有 26 秒总预算（函数上限 30 秒） |
| GET | `/api/history?limit=` | 校验分页参数，之后 501 |
| DELETE | `/api/history/:id` | 校验 UUID，之后 501 |
| GET / POST | `/api/favorites` | POST 校验 `voiceId` / `voiceName`，之后 501 |
| DELETE | `/api/favorites/:voiceId` | 校验音色 ID，之后 501 |
| GET | `/api/audio/:id` | 校验 UUID，之后 501 |

错误码：`NOT_IMPLEMENTED` 501、`METHOD_NOT_ALLOWED` 405、`VALIDATION_ERROR` 400、`UNAUTHORIZED` 401、`FORBIDDEN` 403、`NOT_FOUND` 404、`IDEMPOTENCY_CONFLICT` 409、`RATE_LIMITED` 429、`PAYLOAD_TOO_LARGE` 413、`SERVICE_UNAVAILABLE` 503、`UPSTREAM_ERROR` 502、`UPSTREAM_TIMEOUT` 504、`STORAGE_ERROR` / `INTERNAL_ERROR` 500。

## 环境变量

复制 `.env.example` 查看全部变量名。真实值只在 **Vercel → Project → Settings → Environment Variables** 中配置，不要提交到仓库（`.gitignore` 已忽略 `.env*`）。

| 变量 | 位置 | 说明 |
| --- | --- | --- |
| `ELEVENLABS_API_KEY` | 仅服务端 | ElevenLabs 密钥 |
| `PUBLIC_VOICE_IDS` | 仅服务端 | 公开音色允许列表（逗号分隔 voice_id）；未配置或无效时不公开任何音色，生成也被拒绝 |
| `SUPABASE_URL` | 服务端 | Supabase 项目地址 |
| `SUPABASE_SERVICE_ROLE_KEY` | 仅服务端 | 写入历史、上传音频、生成签名链接；**绝不能下发给前端** |
| `SUPABASE_AUDIO_BUCKET` | 服务端 | 私有音频桶名，默认 `generated-audio` |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | 仅服务端 | 预留：共享限流与幂等存储。**当前代码没有使用**，限流与幂等都只是进程内的 |
| `SUPABASE_ANON_KEY` | 可公开 | 前端登录使用，受 RLS 保护 |

纯预览界面不需要任何变量。要使用 `/api/voices` 和 `/api/generate`，至少需要 `ELEVENLABS_API_KEY` 和 `PUBLIC_VOICE_IDS`；未配置时前者返回空列表、后者返回 503，不会放行任何音色。Supabase 与 Upstash 相关变量目前未被使用。

## 数据库

`supabase/migrations/20261028000000_init_schema.sql` 包含：

- `generation_history`：生成记录，含状态检查约束、`(user_id, created_at desc)` 索引、`(user_id, idempotency_key)` 唯一索引。
- `voice_favorites`：`(user_id, voice_id)` 主键即收藏唯一约束。
- 两张表均启用 RLS：用户只能读取 / 删除自己的历史，只能读写自己的收藏；历史的新增与更新只允许服务端完成。
- 私有存储桶 `generated-audio`（仅 `audio/mpeg`，10 MB 上限），路径 `<user_id>/<generation_id>.mp3`，只允许读取本人目录。

**本阶段没有执行该迁移，也没有连接任何 Supabase 项目。**

## 安全设计（已预留）

- 前端只调用本应用 `/api/*`，不持有任何密钥；`npm run check` 会扫描前端是否直连 ElevenLabs 或引用服务端变量。
- 服务端校验文本长度、音色 ID 格式、模型白名单、参数范围；ID 参数只接受 UUID / 字母数字。
- 用户输入不会用作文件路径：音频路径只由服务端 UUID 拼出（`lib/storage.js`）。
- `Idempotency-Key`：前端在成功前对同一内容复用同一个键，服务端对它做**进程内、尽力而为**的去重（`lib/idempotency.js`）：同一实例内，同一个键的并发请求、已提交过的请求、内容不一致的请求都会得到 409。**这不能保证不重复计费**：ElevenLabs 的文字转语音接口没有幂等机制，当前也没有共享存储，Vercel 多实例之间互相看不到。可靠的去重需要共享存储（见“上线前待办”）。
- 前端对超时、网络中断、502/504 等“结果未知”的情况**不会自动重试**，只提示“生成结果未知，可能已产生费用”，由用户点击“确认重新生成”后才使用新的键重新生成。
- 限流是**进程内**的固定窗口（每个 IP 每分钟 5 次，`lib/rate-limit.js`），只在单个实例内有效，跨实例不可靠，**不能作为费用保护**。
- 日志自动脱敏 Authorization、Token、API Key、JWT 等（`lib/logger.js`）；未捕获异常统一返回 `INTERNAL_ERROR`，不泄露细节。
- `vercel.json` 设置 CSP（仅允许同源脚本 / 样式 / 接口）、`X-Frame-Options`、`nosniff` 等响应头。

## 后续开发顺序（建议）

1. **Supabase 项目准备**：创建项目 → 执行迁移 → 在 Vercel 配置环境变量。
2. **登录**：前端接入 Supabase Auth；实现 `lib/auth.js`，所有接口以服务端解析出的 `user.id` 为准。
3. **音色**（已在服务端接入，待真实验收）：`/api/voices` 服务端拉取 + 缓存，只公开 `PUBLIC_VOICE_IDS` 中的音色。ElevenLabs 的试听链接目前会被丢弃；如需开放试听，需评审后在 CSP `media-src` 中加入其域名。
4. **生成**（ElevenLabs 调用已接入，待真实验收）：已实现校验 → 进程内幂等与限流 → 带超时调用 ElevenLabs → 直接返回音频。**未实现**：共享限流与幂等、写入 `processing` 记录、上传私有桶、更新状态、历史。
5. **音频访问**：实现 `/api/audio/:id`，校验归属后返回短期签名链接，接入播放器和下载。
6. **历史与收藏**：实现历史分页 / 删除（同时删除音频）、收藏接口；为收藏增加云端适配器。
7. **额度**：字符额度统计与扣减（以服务端记录为准）。

## 当前状态

- ✅ 移动端优先界面：创作、音色选择、参数、生成状态、播放器、历史、收藏、设置
- ✅ 加载、空状态、失败状态；失败后由用户手动重试（不自动重试）
- ✅ 接口骨架与统一返回格式、输入校验
- ✅ ElevenLabs 音色目录与文字转语音的服务端接入（仅用模拟测试，**尚未对真实 ElevenLabs 验收**）
- ✅ 数据库迁移 SQL（未执行）、环境变量示例
- ⏳ 未接入：Supabase Auth / 数据库 / Storage、可靠的共享限流与幂等、额度与费用控制（当前仅有进程内限流和幂等，跨实例不可靠；无用户鉴权；不保存音频）

## 限制与上线前待办

**时间预算**：`vercel.json` 中 `api/generate.js` 的 `maxDuration` 为 30 秒。请求总预算 26 秒：音色目录最多 5 秒，TTS 超时取 21 秒与剩余预算的较小值，剩余不足 5 秒时不再向上游发请求。前端生成请求的超时为 35 秒，长于函数上限。

**音频大小**：输出格式固定为 `mp3_44100_128`（约 16KB/秒），应用内上限 4MB（低于 Vercel 4.5MB 响应限制）。因为语速越慢音频越长，文本限制按“字数 ÷ 语速”计算（语速 0.7 时最多 700 字），并按每字约 0.25 秒估算。这是估算，不是保证：极慢语速或大量停顿的文本仍可能超限，此时 ElevenLabs 已经计费，但本应用会拒收并返回 502。

**必须在上线前解决**：
1. 用户认证：目前是服务端账号级访问，所有访问者共享同一份公开音色，也共享费用。
2. 共享限流和幂等（Upstash Redis 或数据库）：当前进程内实现跨实例不可靠，重复点击或超时重试仍可能重复计费。
3. 用量与费用上限。
4. 音频存储与历史记录：目前生成后只存在于当前页面。
5. 对真实 ElevenLabs 做一次验收（测试全部使用模拟）。

## iOS 外壳（未签名 IPA）

`ios/` 是一个极简的 Swift + WKWebView 外壳，只加载线上站点（地址写在 `ios/Sources/AppConfig.swift`），不打包前端文件。前端用相对路径 `/api/*` 请求后端，因为页面本身来自线上域名，请求是同源的，不涉及跨域。工程由 XcodeGen（`ios/project.yml`）在 CI 里生成，仓库不提交 `.xcodeproj`。

打包流程在 `.github/workflows/build-ipa.yml`：推送到 `main`（或手动触发并勾选发布）时构建未签名 `.ipa` 并发布到 GitHub Release；推送到 `feat/framework` 且改动了 `ios/` 时只上传为 Actions 构建产物。安装前需要用全能签等工具自行签名。

已知限制：
- 站点开着 Vercel Authentication 时，App 里会先出现 Vercel 登录页，需要用公开可访问的域名才能让没有 Vercel 账号的人使用。
- 页面的“下载”按钮（blob 下载）在 WKWebView 里可能无效，这是前端行为，外壳没有处理。
- 未配置图标，安装后是默认空白图标。
- 构建流程只在 GitHub 的 macOS 机器上验证，没有在本地编译过。

