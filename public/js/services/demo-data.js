// DEMO 示例数据
//
// 仅用于第一阶段演示界面交互：
// * 每一条都带 isDemo: true，界面上必须显示 DEMO 标记
// * id 以 demo 开头，不是 UUID，因此永远不会被当作云端记录发送给 /api
// * 没有真实音频文件（audioUrl 恒为 null）
// * 音色均为虚构，不对应任何真实 ElevenLabs 音色

export const DEMO_VOICES = Object.freeze([
  { id: 'demoVoice0001', name: '晨曦', description: '温柔清澈的女声，适合睡前故事与旁白', gender: 'female', language: '中文', tags: ['温柔', '旁白'] },
  { id: 'demoVoice0002', name: '远山', description: '沉稳醇厚的男声，适合纪录片解说', gender: 'male', language: '中文', tags: ['沉稳', '解说'] },
  { id: 'demoVoice0003', name: '小满', description: '活泼明亮的女声，适合短视频配音', gender: 'female', language: '中文', tags: ['活泼', '短视频'] },
  { id: 'demoVoice0004', name: '墨白', description: '标准播音腔男声，适合新闻与播报', gender: 'male', language: '中文', tags: ['播音', '正式'] },
  { id: 'demoVoice0005', name: 'Aria', description: 'Warm and expressive English female voice', gender: 'female', language: 'English', tags: ['Warm', 'Narration'] },
  { id: 'demoVoice0006', name: 'Leo', description: 'Calm and confident English male voice', gender: 'male', language: 'English', tags: ['Calm', 'Podcast'] },
].map((v) => Object.freeze({ ...v, previewUrl: null, isDemo: true })));

// 以“当前时间”为基准生成，保证演示时显示为最近的记录
export function createDemoHistory(now = Date.now()) {
  const minutes = (n) => new Date(now - n * 60000).toISOString();
  return [
    {
      id: 'demo-history-1',
      text: '清晨的第一缕阳光洒在湖面上，微风吹过，泛起层层涟漪。这是一个适合出发的日子。',
      voiceId: 'demoVoice0001',
      voiceName: '晨曦',
      modelId: 'eleven_multilingual_v2',
      status: 'succeeded',
      createdAt: minutes(18),
    },
    {
      id: 'demo-history-2',
      text: '欢迎收听本期节目。今天我们聊一聊，如何用十分钟做出一顿健康的早餐。',
      voiceId: 'demoVoice0002',
      voiceName: '远山',
      modelId: 'eleven_turbo_v2_5',
      status: 'failed',
      errorCode: 'UPSTREAM_TIMEOUT',
      createdAt: minutes(60 * 26),
    },
    {
      id: 'demo-history-3',
      text: 'Thanks for stopping by. Today we are going to talk about building small habits that last.',
      voiceId: 'demoVoice0005',
      voiceName: 'Aria',
      modelId: 'eleven_flash_v2_5',
      status: 'processing',
      createdAt: minutes(60 * 24 * 3),
    },
  ].map((item) => ({ ...item, characterCount: [...item.text].length, durationSeconds: null, audioUrl: null, isDemo: true }));
}
