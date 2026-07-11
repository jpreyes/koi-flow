-- ═══════════════════════════════════════════════════════════════════════════
-- koi-flow · Fase A · esquema + Row-Level Security (RLS)
-- Correr en Supabase → SQL Editor → New query → pegar todo → Run.
-- Modelo: HERRAMIENTA CORPORATIVA. Cada usuario pertenece a organizaciones
-- (minera / consultora / eólica) y solo ve los proyectos de SUS organizaciones.
-- El aislamiento NO lo hace el frontend: lo enforce la RLS acá en Postgres.
-- Idempotente: se puede volver a correr sin romper nada.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Perfil por usuario (extiende auth.users) ────────────────────────────────
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  nombre     text,
  creado     timestamptz not null default now()
);

-- ── Organizaciones ──────────────────────────────────────────────────────────
create table if not exists public.orgs (
  id      uuid primary key default gen_random_uuid(),
  nombre  text not null,
  creado  timestamptz not null default now()
);

-- ── Membresía usuario↔organización con rol ─────────────────────────────────
do $$ begin
  create type public.rol_org as enum ('admin', 'ingeniero', 'revisor');
exception when duplicate_object then null; end $$;

create table if not exists public.org_members (
  org_id   uuid not null references public.orgs(id) on delete cascade,
  user_id  uuid not null references auth.users(id) on delete cascade,
  rol      public.rol_org not null default 'ingeniero',
  creado   timestamptz not null default now(),
  primary key (org_id, user_id)
);

-- ── Proyectos (metadata; el binario .koi vive en Storage) ───────────────────
create table if not exists public.projects (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs(id) on delete cascade,
  owner       uuid not null references auth.users(id) default auth.uid(),
  nombre      text not null,
  storage_path text,                         -- p.ej. '<org_id>/<project_id>.koi'
  actualizado timestamptz not null default now(),
  creado      timestamptz not null default now()
);
create index if not exists projects_org_idx on public.projects(org_id);

-- ── Helper: ¿el usuario actual es miembro de esta org? (evita recursión RLS) ─
create or replace function public.es_miembro(o uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.org_members m where m.org_id = o and m.user_id = auth.uid());
$$;

create or replace function public.puede_escribir(o uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.org_members m
                 where m.org_id = o and m.user_id = auth.uid() and m.rol in ('admin','ingeniero'));
$$;

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table public.profiles     enable row level security;
alter table public.orgs         enable row level security;
alter table public.org_members  enable row level security;
alter table public.projects     enable row level security;

-- perfiles: cada quien el suyo
drop policy if exists p_profiles_self on public.profiles;
create policy p_profiles_self on public.profiles
  for all using (id = auth.uid()) with check (id = auth.uid());

-- orgs: ver las que integro
drop policy if exists p_orgs_read on public.orgs;
create policy p_orgs_read on public.orgs
  for select using (public.es_miembro(id));

-- membresías: ver las mías
drop policy if exists p_members_read on public.org_members;
create policy p_members_read on public.org_members
  for select using (user_id = auth.uid());

-- proyectos: leer los de mis orgs; escribir si soy admin/ingeniero de esa org
drop policy if exists p_projects_read on public.projects;
create policy p_projects_read on public.projects
  for select using (public.es_miembro(org_id));

drop policy if exists p_projects_write on public.projects;
create policy p_projects_write on public.projects
  for insert with check (public.puede_escribir(org_id));

drop policy if exists p_projects_update on public.projects;
create policy p_projects_update on public.projects
  for update using (public.puede_escribir(org_id)) with check (public.puede_escribir(org_id));

drop policy if exists p_projects_delete on public.projects;
create policy p_projects_delete on public.projects
  for delete using (public.puede_escribir(org_id));

-- ── Auto-crear el profile al registrarse ────────────────────────────────────
create or replace function public.on_auth_user_created()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, nombre) values (new.id, new.raw_user_meta_data->>'nombre')
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists trg_auth_user_created on auth.users;
create trigger trg_auth_user_created after insert on auth.users
  for each row execute function public.on_auth_user_created();

-- ── Storage: bucket privado 'proyectos', archivos bajo <org_id>/… ───────────
-- (crear el bucket 'proyectos' PRIVADO desde el panel Storage; estas policies
--  lo aíslan por organización: la 1ª carpeta del path debe ser una org del user)
drop policy if exists p_koi_read on storage.objects;
create policy p_koi_read on storage.objects
  for select using (bucket_id = 'proyectos' and public.es_miembro( ((storage.foldername(name))[1])::uuid ));

drop policy if exists p_koi_write on storage.objects;
create policy p_koi_write on storage.objects
  for insert with check (bucket_id = 'proyectos' and public.puede_escribir( ((storage.foldername(name))[1])::uuid ));

drop policy if exists p_koi_update on storage.objects;
create policy p_koi_update on storage.objects
  for update using (bucket_id = 'proyectos' and public.puede_escribir( ((storage.foldername(name))[1])::uuid ));

drop policy if exists p_koi_delete on storage.objects;
create policy p_koi_delete on storage.objects
  for delete using (bucket_id = 'proyectos' and public.puede_escribir( ((storage.foldername(name))[1])::uuid ));

-- ═══════════════════════════════════════════════════════════════════════════
-- Tras correr esto: crear tu organización y sumarte como admin. Ejemplo:
--   insert into public.orgs (nombre) values ('Mi Consultora') returning id;
--   -- copiá el id devuelto y tu user id (Authentication → Users):
--   insert into public.org_members (org_id, user_id, rol)
--   values ('<org_id>', '<tu_user_id>', 'admin');
-- ═══════════════════════════════════════════════════════════════════════════
