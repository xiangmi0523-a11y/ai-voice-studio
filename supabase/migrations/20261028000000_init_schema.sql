-- AI Voice Studio 初始数据库结构
--
-- 注意：第一阶段只交付本文件，不要在任何线上 Supabase 项目中执行。
-- 第二阶段确认后，可在 Supabase Dashboard → SQL Editor 中执行，
-- 或使用 `supabase db push`。
--
-- 设计要点：
-- * 业务表全部开启 RLS，用户只能访问自己的数据。
-- * generation_history 只允许客户端读取和删除自己的记录；
--   新增和更新由服务端（Service Role）完成，客户端无法伪造生成状态。
-- * 音频存放在私有桶 generated-audio，路径为 <user_id>/<generation_id>.mp3。

-- ---------------------------------------------------------------------------
-- generation_history
-- ---------------------------------------------------------------------------
create table if not exists public.generation_history (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  text              text not null check (char_length(text) between 1 and 5000),
  voice_id          text not null check (voice_id ~ '^[A-Za-z0-9]{8,64}$'),
  voice_name        text check (voice_name is null or char_length(voice_name) <= 100),
  model_id          text not null check (char_length(model_id) <= 64),
  settings          jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  audio_path        text check (audio_path is null or char_length(audio_path) <= 255),
  duration_seconds  numeric(8, 2) check (duration_seconds is null or duration_seconds >= 0),
  character_count   integer not null check (character_count >= 0),
  status            text not null default 'pending'
                    check (status in ('pending', 'processing', 'succeeded', 'failed')),
  error_code        text check (error_code is null or char_length(error_code) <= 64),
  -- 幂等键：同一用户重复提交同一请求时只生成一次
  idempotency_key   uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint generation_history_succeeded_has_audio
    check (status <> 'succeeded' or audio_path is not null),
  constraint generation_history_failed_has_error
    check (status <> 'failed' or error_code is not null)
);

comment on table public.generation_history is '语音生成历史。客户端只读/可删，写入由服务端完成。';

-- 历史列表按用户、时间倒序分页
create index if not exists generation_history_user_created_idx
  on public.generation_history (user_id, created_at desc);

-- 幂等键在用户范围内唯一
create unique index if not exists generation_history_user_idempotency_key
  on public.generation_history (user_id, idempotency_key)
  where idempotency_key is not null;

-- 音频路径全局唯一
create unique index if not exists generation_history_audio_path_key
  on public.generation_history (audio_path)
  where audio_path is not null;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists generation_history_set_updated_at on public.generation_history;
create trigger generation_history_set_updated_at
  before update on public.generation_history
  for each row execute function public.set_updated_at();

alter table public.generation_history enable row level security;

drop policy if exists "history_select_own" on public.generation_history;
create policy "history_select_own"
  on public.generation_history for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "history_delete_own" on public.generation_history;
create policy "history_delete_own"
  on public.generation_history for delete
  to authenticated
  using ((select auth.uid()) = user_id);

-- 不为 authenticated 创建 insert / update 策略：只有服务端可以写入。
revoke all on public.generation_history from anon;
revoke insert, update on public.generation_history from authenticated;

-- ---------------------------------------------------------------------------
-- voice_favorites
-- ---------------------------------------------------------------------------
create table if not exists public.voice_favorites (
  user_id     uuid not null references auth.users (id) on delete cascade,
  voice_id    text not null check (voice_id ~ '^[A-Za-z0-9]{8,64}$'),
  voice_name  text not null check (char_length(voice_name) between 1 and 100),
  created_at  timestamptz not null default now(),

  -- 收藏唯一约束：同一用户不能重复收藏同一音色
  primary key (user_id, voice_id)
);

comment on table public.voice_favorites is '用户收藏的音色。';

create index if not exists voice_favorites_user_created_idx
  on public.voice_favorites (user_id, created_at desc);

alter table public.voice_favorites enable row level security;

drop policy if exists "favorites_select_own" on public.voice_favorites;
create policy "favorites_select_own"
  on public.voice_favorites for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "favorites_insert_own" on public.voice_favorites;
create policy "favorites_insert_own"
  on public.voice_favorites for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "favorites_delete_own" on public.voice_favorites;
create policy "favorites_delete_own"
  on public.voice_favorites for delete
  to authenticated
  using ((select auth.uid()) = user_id);

revoke all on public.voice_favorites from anon;
revoke update on public.voice_favorites from authenticated;

-- ---------------------------------------------------------------------------
-- Storage：私有音频桶
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('generated-audio', 'generated-audio', false, 10485760, array['audio/mpeg'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- 只允许用户读取自己目录下的文件（第一层目录名 = user_id）。
-- 应用正常通过 /api/audio/:id 获取签名链接，这条策略只是第二道防线。
-- 不为客户端创建 insert / update / delete 策略：上传和删除由服务端完成。
drop policy if exists "audio_select_own" on storage.objects;
create policy "audio_select_own"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'generated-audio'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
