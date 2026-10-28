// 结构化日志，自动脱敏。不要绕过它直接 console.log 请求头或环境变量。

const SENSITIVE_KEY_RE = /(authorization|cookie|token|secret|password|api[-_]?key|service[-_]?role|xi-api-key)/i;
// 看起来像凭证的值（Bearer、JWT、sk_ 前缀等）也一并遮蔽
const SENSITIVE_VALUE_RE = /(Bearer\s+\S+|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|sk_[A-Za-z0-9]{8,})/g;

export function redact(value, depth = 0) {
  if (depth > 5) return '[Truncated]';
  if (value instanceof Error) {
    return { name: value.name, message: redact(value.message, depth + 1) };
  }
  if (typeof value === 'string') return value.replace(SENSITIVE_VALUE_RE, '[REDACTED]');
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SENSITIVE_KEY_RE.test(k) ? '[REDACTED]' : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

function write(level, event, fields) {
  const line = JSON.stringify({ level, event, time: new Date().toISOString(), ...redact(fields || {}) });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const logger = {
  info: (event, fields) => write('info', event, fields),
  warn: (event, fields) => write('warn', event, fields),
  error: (event, fields) => write('error', event, fields),
};
