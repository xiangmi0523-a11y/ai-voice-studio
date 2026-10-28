// 本地预览服务器（零依赖）：静态托管 public/，并按 Vercel 规则把 /api/* 路由到 api/ 下的函数。
// 用法：npm run dev  然后打开 http://localhost:3000
// 同一局域网的手机可访问 http://<电脑IP>:3000 预览。

import { createServer } from 'node:http';
import { readFile, readdir, stat } from 'node:fs/promises';
import { extname, join, normalize, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PUBLIC_DIR = join(ROOT, 'public');
const API_DIR = join(ROOT, 'api');
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
};

// 与 vercel.json 保持一致的安全响应头
const vercelConfig = JSON.parse(await readFile(join(ROOT, 'vercel.json'), 'utf8'));
const GLOBAL_HEADERS = vercelConfig.headers?.find((h) => h.source === '/(.*)')?.headers || [];

// 解析 /api 路径到函数文件，支持 index.js 与 [param].js
export async function resolveApiRoute(pathname, apiDir = API_DIR) {
  const segments = pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);
  let dir = apiDir;
  const query = {};
  for (let i = 0; i < segments.length; i += 1) {
    const segment = decodeURIComponent(segments[i]);
    const isLast = i === segments.length - 1;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return null;
    }
    const names = entries.map((e) => e.name);
    if (isLast && names.includes(`${segment}.js`)) return { file: join(dir, `${segment}.js`), query };
    if (entries.some((e) => e.isDirectory() && e.name === segment)) {
      dir = join(dir, segment);
      continue;
    }
    const dynamicFile = names.find((n) => /^\[[^\]]+\]\.js$/.test(n));
    if (isLast && dynamicFile) {
      query[dynamicFile.slice(1, -4)] = segment;
      return { file: join(dir, dynamicFile), query };
    }
    const dynamicDir = entries.find((e) => e.isDirectory() && /^\[[^\]]+\]$/.test(e.name));
    if (dynamicDir) {
      query[dynamicDir.name.slice(1, -1)] = segment;
      dir = join(dir, dynamicDir.name);
      continue;
    }
    return null;
  }
  try {
    await stat(join(dir, 'index.js'));
    return { file: join(dir, 'index.js'), query };
  } catch {
    return null;
  }
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new Error('Body too large');
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return undefined;
  if ((req.headers['content-type'] || '').includes('application/json')) {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  return raw;
}

async function handleApi(req, res, url) {
  const route = await resolveApiRoute(url.pathname);
  if (!route) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ ok: false, error: { code: 'NOT_FOUND', message: '接口不存在。' } }));
    return;
  }
  req.query = { ...Object.fromEntries(url.searchParams), ...route.query };
  req.body = await readBody(req);
  const mod = await import(`${pathToFileURL(route.file).href}?t=${Date.now()}`);
  await mod.default(req, res);
}

async function handleStatic(res, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname.endsWith('/')) pathname += 'index.html';
  const filePath = normalize(join(PUBLIC_DIR, pathname));
  if (relative(PUBLIC_DIR, filePath).startsWith('..') || !filePath.startsWith(PUBLIC_DIR + sep)) {
    res.statusCode = 403;
    res.end('Forbidden');
    return;
  }
  try {
    const data = await readFile(filePath);
    res.setHeader('Content-Type', MIME[extname(filePath)] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.end(data);
  } catch {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('Not found');
  }
}

export function createDevServer() {
  return createServer(async (req, res) => {
    for (const { key, value } of GLOBAL_HEADERS) res.setHeader(key, value);
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) await handleApi(req, res, url);
      else await handleStatic(res, url);
    } catch (err) {
      console.error(err);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.end();
      }
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createDevServer().listen(PORT, HOST, () => {
    console.log(`AI Voice Studio dev server: http://localhost:${PORT}`);
  });
}
