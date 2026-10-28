// 用户身份校验（第二阶段接入 Supabase Auth）
//
// 计划实现：
// 1. 从 Authorization: Bearer <access_token> 读取用户令牌
// 2. 用 Supabase 校验令牌，得到 user.id
// 3. 所有读写都以服务端拿到的 user.id 为准，绝不信任客户端传入的 user_id
//
// 第一阶段不连接 Supabase，始终返回未接入状态。

export function readBearerToken(req) {
  const header = req?.headers?.authorization;
  if (typeof header !== 'string') return null;
  const match = /^Bearer\s+([A-Za-z0-9._-]+)$/.exec(header.trim());
  return match ? match[1] : null;
}

export async function getAuthenticatedUser(_req) {
  return { implemented: false, user: null };
}
