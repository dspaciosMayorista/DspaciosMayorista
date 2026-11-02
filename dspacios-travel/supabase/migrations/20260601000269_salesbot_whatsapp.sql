-- ─────────────────────────────────────────────────────────────────────────────
-- 269 · Canal WhatsApp de SalesBot (#56)   ⚠️ SIN CORRER
--
-- SOLO esquema, aditivo. NUMERACIÓN: 269 = siguiente libre tras la 268 de origin/main al escribirla; confirmar con
-- `ls supabase/migrations | sort | tail` EN LA RAMA que se fusione (otros frentes pueden haber tomado el 269).
--
-- Tres tablas que SOLO toca el servidor (service-role). RLS activa y sin policies, y sin permisos para anon/authenticated:
-- contienen números de teléfono de clientes, así que ni la API REST de un usuario interno debe alcanzarlas.
--
--   salesbot_wa_mensajes   · bandeja de trabajo, una fila por mensaje de Meta. NO es solo «ya visto»: guarda el avance para que un reintento
--                            continúe donde quedó (y no pierda ni duplique nada):
--                              estado      procesando → completado | abandonado
--                              lease_hasta quien procesa «alquila» el mensaje; si muere, otro lo retoma al vencer
--                              resultado   la respuesta YA calculada (sesión nueva, mensajes, traspaso): un reintento no la recalcula
--                              enviados    cuántos cuerpos de respuesta Meta ya aceptó: un reintento solo manda los que faltan
--                              intentos / primer_recibo   tope de reintentos (Meta reintenta hasta 7 días; la ventana de 24 h no da para tanto)
--                              ts          `timestamp` de Meta (segundos): orden de los mensajes de un mismo cliente
--   salesbot_wa_sesiones   · una fila por teléfono: estado SANEADO del flujo (datos de la consulta, no el texto del cliente).
--                            lock_por / lock_hasta = turno exclusivo del cliente (dos mensajes suyos en vuelo no se mezclan); el avance de sesión es
--                            UN UPDATE condicional (dueño del turno Y ultimo_ts <= ts del mensaje) → sin lectura-luego-escritura.
--   salesbot_wa_traspasos  · cada vez que el cliente pide un asesor. `mensaje_id` UNIQUE = idempotencia (un reintento no duplica la
--                            solicitud). `avisado_en` NULL = el equipo aún NO fue avisado: el cliente no recibe la confirmación hasta entonces.
--                            `aviso_intentos` / `aviso_proximo` = reintento operativo por cron (/api/cron/avisos-whatsapp) con retroceso, sin depender del cliente.
-- Sin trigger de auditoría a propósito: registraría cada turno de cada cliente.
-- Retención pendiente (fuera de esta entrega): purgar `salesbot_wa_mensajes` completados con más de 30 días.
-- Orden: preflight = supabase/scripts/preflight_269_salesbot_whatsapp.sql → 269 → postcheck = postcheck_269_salesbot_whatsapp.sql (debe dar VERIFICACION_OK).
-- Rollback: supabase/scripts/rollback_269_salesbot_whatsapp.sql
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.salesbot_wa_mensajes (
  mensaje_id    text primary key,
  wa_id         text not null,
  estado        text not null default 'procesando' check (estado in ('procesando', 'completado', 'abandonado')),
  intentos      integer not null default 1 check (intentos >= 1),
  lease_hasta   timestamptz not null,
  primer_recibo timestamptz not null default now(),
  resultado     jsonb,
  ts            bigint not null default 0,
  enviados      integer not null default 0 check (enviados >= 0),
  actualizado   timestamptz not null default now()
);
create index if not exists salesbot_wa_mensajes_en_curso on public.salesbot_wa_mensajes (lease_hasta) where estado = 'procesando';
create index if not exists salesbot_wa_mensajes_por_cliente on public.salesbot_wa_mensajes (wa_id, ts) where estado = 'procesando';

create table if not exists public.salesbot_wa_sesiones (
  wa_id          text primary key,
  estado         jsonb not null,
  traspaso_hasta timestamptz,
  actualizada    timestamptz not null default now(),
  lock_por       text,
  lock_hasta     timestamptz,
  ultimo_ts      bigint not null default 0,
  ultimo_mensaje text
);

create table if not exists public.salesbot_wa_traspasos (
  id            bigint generated always as identity primary key,
  mensaje_id    text not null unique,
  wa_id         text not null,
  nombre_perfil text,
  resumen       jsonb not null default '{}'::jsonb,
  creado        timestamptz not null default now(),
  avisado_en    timestamptz,
  aviso_intentos integer not null default 0,
  aviso_proximo  timestamptz,
  atendido_en   timestamptz,
  atendido_por  uuid references public.usuarios(id)
);
-- Cola operativa: solicitudes sin avisar y sin atender.
create index if not exists salesbot_wa_traspasos_sin_avisar on public.salesbot_wa_traspasos (aviso_proximo, creado) where avisado_en is null;
create index if not exists salesbot_wa_traspasos_pendientes on public.salesbot_wa_traspasos (creado) where atendido_en is null;

alter table public.salesbot_wa_mensajes  enable row level security;
alter table public.salesbot_wa_sesiones  enable row level security;
alter table public.salesbot_wa_traspasos enable row level security;
revoke all on table public.salesbot_wa_mensajes, public.salesbot_wa_sesiones, public.salesbot_wa_traspasos from anon, authenticated;
