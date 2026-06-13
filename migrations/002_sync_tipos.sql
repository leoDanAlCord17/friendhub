-- 002_sync_tipos.sql
-- Sincroniza el esquema de Supabase con src/types/index.ts.
-- Agrega todas las columnas referenciadas por los tipos que pudieran faltar.
-- Idempotente: usa ADD COLUMN IF NOT EXISTS.

-- usuarios
ALTER TABLE public.usuarios
  ADD COLUMN IF NOT EXISTS github_id text,
  ADD COLUMN IF NOT EXISTS github_login text,
  ADD COLUMN IF NOT EXISTS nombre text,
  ADD COLUMN IF NOT EXISTS avatar_url text,
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS bio text,
  ADD COLUMN IF NOT EXISTS location text,
  ADD COLUMN IF NOT EXISTS zona_horaria text,
  ADD COLUMN IF NOT EXISTS disponible boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS busca text,
  ADD COLUMN IF NOT EXISTS conversacion_activa_id uuid;

-- proyectos
ALTER TABLE public.proyectos
  ADD COLUMN IF NOT EXISTS usuario_id uuid,
  ADD COLUMN IF NOT EXISTS nombre text,
  ADD COLUMN IF NOT EXISTS descripcion text,
  ADD COLUMN IF NOT EXISTS lenguaje_principal text,
  ADD COLUMN IF NOT EXISTS lenguajes text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS dominio text,
  ADD COLUMN IF NOT EXISTS tiene_tests boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS zona_horaria text,
  ADD COLUMN IF NOT EXISTS repo_url text,
  ADD COLUMN IF NOT EXISTS stack text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS readme text;

-- conversaciones
ALTER TABLE public.conversaciones
  ADD COLUMN IF NOT EXISTS usuario_a uuid,
  ADD COLUMN IF NOT EXISTS usuario_b uuid,
  ADD COLUMN IF NOT EXISTS puntaje integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS abierta boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS motivo_cierre text,
  ADD COLUMN IF NOT EXISTS ultimo_mensaje text,
  ADD COLUMN IF NOT EXISTS ultimo_mensaje_en timestamptz;

-- invitaciones
ALTER TABLE public.invitaciones
  ADD COLUMN IF NOT EXISTS de_usuario uuid,
  ADD COLUMN IF NOT EXISTS para_usuario uuid,
  ADD COLUMN IF NOT EXISTS proyecto_id uuid,
  ADD COLUMN IF NOT EXISTS mensaje text,
  ADD COLUMN IF NOT EXISTS readme text,
  ADD COLUMN IF NOT EXISTS puntaje integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS estado text NOT NULL DEFAULT 'pendiente';

-- amigos
ALTER TABLE public.amigos
  ADD COLUMN IF NOT EXISTS usuario_id uuid,
  ADD COLUMN IF NOT EXISTS amigo_id uuid,
  ADD COLUMN IF NOT EXISTS conversacion_id uuid,
  ADD COLUMN IF NOT EXISTS confirmada boolean NOT NULL DEFAULT false;

-- descartados
ALTER TABLE public.descartados
  ADD COLUMN IF NOT EXISTS usuario_id uuid,
  ADD COLUMN IF NOT EXISTS descartado_id uuid,
  ADD COLUMN IF NOT EXISTS motivo text;
