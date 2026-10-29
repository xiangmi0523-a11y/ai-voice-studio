# AI 翻唱工坊

用自己的声音翻唱任何歌。手机打开网页就能用，可以"添加到主屏幕"当 App 用。

流程：① 上传干声训练声音模型 → ② 上传带伴奏的歌曲，点"生成翻唱" → ③ 在"作品"里播放、下载。

背后用的是 Replicate 上的两个公开模型：

- 训练：[replicate/train-rvc-model](https://replicate.com/replicate/train-rvc-model)
- 翻唱（自动分离人声伴奏 + 换声 + 混音）：[zsxkib/realistic-voice-cloning](https://replicate.com/zsxkib/realistic-voice-cloning)

文件和结果存在 Vercel Blob 里，不需要数据库。

## 部署到 Vercel（手机上也能操作）

1. 在 Vercel 导入这个 GitHub 仓库，直接部署。
2. 项目里打开 **Storage → Create → Blob**，选 **Public**，连接到本项目（会自动加上 `BLOB_READ_WRITE_TOKEN`）。
3. **Settings → Environment Variables** 添加：
   - `APP_PASSWORD`：打开网页时要输的密码。
   - `REPLICATE_API_TOKEN`：Replicate 的 API Token。暂时没有可以先不填，App 能打开，训练和生成按钮会提示未配置。
4. 改完环境变量后，在 Deployments 里对最新部署点 **Redeploy**。

所有环境变量见 [.env.example](.env.example)。

## 本地开发

```bash
npm install
cp .env.example .env.local   # 填好变量
npm run dev
```

本地没有公网地址，Replicate 回调不会到达；App 会在刷新列表时主动去 Replicate 查询结果，效果一样。

## 代码在哪

- `components/Studio.tsx`：全部界面
- `lib/dataset.ts`：在浏览器里把干声切成 10 秒一段、打包成训练需要的 zip
- `lib/replicate.ts`：所有 Replicate 调用
- `lib/store.ts`：用 Blob 文件记录声音模型和作品的状态
- `app/api/*`：上传、训练、生成、回调接口
- `proxy.ts`：访问密码
