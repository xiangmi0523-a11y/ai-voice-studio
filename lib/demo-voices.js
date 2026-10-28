// 前端 DEMO 示例音色的 ID（public/js/services/demo-data.js）。
//
// 服务端不信任前端传来的任何 DEMO 标记；这里的清单只用于在请求进入白名单查询之前
// 直接拒绝已知的虚构音色，避免它们触发对 ElevenLabs 的请求。真正的放行依据始终是
// 从 ElevenLabs 拉取的真实音色白名单（lib/voice-catalog.js）。
// tests/voices.test.mjs 会校验这份清单与前端 DEMO 数据一致。

export const DEMO_VOICE_IDS = Object.freeze([
  'demoVoice0001',
  'demoVoice0002',
  'demoVoice0003',
  'demoVoice0004',
  'demoVoice0005',
  'demoVoice0006',
]);

const DEMO_SET = new Set(DEMO_VOICE_IDS);

export function isKnownDemoVoiceId(voiceId) {
  return typeof voiceId === 'string' && DEMO_SET.has(voiceId);
}
