// 项目静态检查（零依赖）：npm run check
// 1. 所有 JS 文件语法检查
// 2. index.html 引用的本地文件存在
// 3. 所有相对 import 路径可解析
// 4. 必需的 API 路由文件存在并导出处理函数
// 5. 前端不包含服务端密钥或直连 ElevenLabs
// 6. .env.example 只包含占位值
// 7. vercel.json 有效

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const problems = [];
const fail = (msg) => problems.push(msg);
const rel = (p) => relative(ROOT, p);

function walk(dir, exts, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, exts, out);
    else if (exts.some((e) => name.endsWith(e))) out.push(full);
  }
  return out;
}

const jsFiles = ['public', 'api', 'lib', 'scripts', 'tests'].flatMap((d) => walk(join(ROOT, d), ['.js', '.mjs']));

// 1. 语法检查
for (const file of jsFiles) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) fail(`语法错误 ${rel(file)}\n${result.stderr}`);
}

// 2. index.html 引用
const indexPath = join(ROOT, 'public/index.html');
const html = readFileSync(indexPath, 'utf8');
for (const [, ref] of html.matchAll(/(?:src|href)="([^"#]+)"/g)) {
  if (/^(https?:|mailto:|data:)/.test(ref)) {
    fail(`index.html 引用了外部资源：${ref}`);
    continue;
  }
  if (!existsSync(join(ROOT, 'public', ref))) fail(`index.html 引用的文件不存在：${ref}`);
}
// 页面中用到的 id 必须唯一
const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
for (const id of new Set(ids)) if (ids.filter((x) => x === id).length > 1) fail(`index.html 中 id 重复：${id}`);
// JS 中 qs('#id') 引用的 id 必须存在于 index.html
for (const file of walk(join(ROOT, 'public/js'), ['.js'])) {
  const src = readFileSync(file, 'utf8');
  for (const [, id] of src.matchAll(/qs\('#([\w-]+)'/g)) {
    if (!ids.includes(id)) fail(`${rel(file)} 引用了不存在的元素 #${id}`);
  }
}

// 3. import 路径
for (const file of jsFiles) {
  const src = readFileSync(file, 'utf8');
  for (const [, spec] of src.matchAll(/(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    if (!spec || !spec.startsWith('.')) continue;
    if (!existsSync(resolve(dirname(file), spec))) fail(`${rel(file)} 的 import 无法解析：${spec}`);
  }
}

// 4. API 路由
const REQUIRED_ROUTES = [
  ['GET', '/api/voices', 'api/voices.js'],
  ['POST', '/api/generate', 'api/generate.js'],
  ['GET', '/api/history', 'api/history/index.js'],
  ['DELETE', '/api/history/:id', 'api/history/[id].js'],
  ['GET', '/api/favorites', 'api/favorites/index.js'],
  ['POST', '/api/favorites', 'api/favorites/index.js'],
  ['DELETE', '/api/favorites/:voiceId', 'api/favorites/[voiceId].js'],
  ['GET', '/api/audio/:id', 'api/audio/[id].js'],
  ['GET', '/api/health', 'api/health.js'],
];
for (const [method, route, file] of REQUIRED_ROUTES) {
  const full = join(ROOT, file);
  if (!existsSync(full)) {
    fail(`缺少路由 ${method} ${route} → ${file}`);
    continue;
  }
  const mod = await import(pathToFileURL(full).href);
  if (typeof mod.default !== 'function') fail(`${file} 没有导出默认处理函数`);
}

// 5. 前端安全
for (const file of walk(join(ROOT, 'public'), ['.js', '.html', '.css'])) {
  const src = readFileSync(file, 'utf8');
  if (/api\.elevenlabs\.io|xi-api-key/i.test(src)) fail(`${rel(file)} 直接访问 ElevenLabs，必须经由服务端`);
  if (/SERVICE_ROLE|ELEVENLABS_API_KEY|process\.env/.test(src)) fail(`${rel(file)} 引用了服务端环境变量`);
}

// 6. .env.example
const envExample = readFileSync(join(ROOT, '.env.example'), 'utf8');
for (const line of envExample.split('\n')) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (!m) continue;
  const [, key, value] = m;
  const placeholder = /your-/.test(value) || value === 'generated-audio';
  if (!placeholder) fail(`.env.example 中 ${key} 不是占位值`);
}

// 7. vercel.json
try {
  const vercel = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'));
  if (!existsSync(join(ROOT, vercel.outputDirectory || 'public'))) fail('vercel.json 的 outputDirectory 不存在');
  for (const fn of Object.keys(vercel.functions || {})) {
    if (!existsSync(join(ROOT, fn))) fail(`vercel.json functions 中的文件不存在：${fn}`);
  }
} catch (err) {
  fail(`vercel.json 无法解析：${err.message}`);
}

if (problems.length) {
  console.error(`检查失败（${problems.length} 项）：\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log(`检查通过：${jsFiles.length} 个 JS 文件，${REQUIRED_ROUTES.length} 条 API 路由。`);
