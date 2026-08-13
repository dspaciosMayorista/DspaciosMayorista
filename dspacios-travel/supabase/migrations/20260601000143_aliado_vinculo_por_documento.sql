-- Migración 143: vincular contratos y usuarios B2B al catálogo `aliados` por ID
--
-- PROBLEMA
-- Un contrato "asistido" (el asesor interno lo monta a nombre de un freelance o
-- agencia) guardaba el aliado como TEXTO: `ventas.agencia_nombre` /
-- `ventas.freelance_nombre`. El portal B2B resolvía la pertenencia así:
--
--     .eq("b2b_usuario_id", user.id)                                  ← fuerte
--     .or("agencia_nombre.eq.<nombre>,freelance_nombre.eq.<nombre>")  ← por texto
--
-- Dos consecuencias:
--   1. Si el aliado se registra después y su nombre no queda escrito idéntico,
--      no ve los contratos que le montaron. (Mismo tipo de falla que ya se vio
--      con `ventas.asesor` y los contratos importados: "JUAN PEREZ" ≠ "Juan
--      Pérez".)
--   2. Emparejar por nombre es débil: quien se registre con el mismo nombre que
--      un aliado real vería sus contratos y comisiones. Hoy eso se contiene
--      bloqueando nombres duplicados en el registro, que es un parche.
--
-- SOLUCIÓN
-- El catálogo `aliados` ya existe y ya tiene `nit` + `tipo_documento` (migración
-- 133). Se usa como la identidad única del aliado:
--
--   · `ventas.aliado_id`   → a qué aliado pertenece el contrato (el formulario
--                            YA elige del catálogo y tiene el id en la mano;
--                            hasta ahora solo guardaba el nombre y lo botaba).
--   · `usuarios.aliado_id` → qué ficha del catálogo corresponde a ese login B2B.
--
-- Con esas dos, el portal cruza por ID: contrato.aliado_id == usuario.aliado_id.
-- El emparejamiento por nombre queda SOLO como respaldo para los contratos
-- viejos que aún no tengan `aliado_id`.
--
-- APROBACIÓN MANUAL (decisión del dueño)
-- El registro NO enlaza solo. Cuando alguien se registra con su documento, se
-- busca una ficha del catálogo con ese mismo documento y, si aparece, se guarda
-- como SUGERENCIA (`b2b_solicitudes.aliado_sugerido_id`). Quien aprueba la ve,
-- la confirma o elige otra, y solo ahí se escribe `usuarios.aliado_id`. Así
-- nadie accede a contratos ajenos por conocer o adivinar un NIT.
-- (El enlace automático se evaluará más adelante.)

-- ── Vínculo fuerte en el contrato ─────────────────────────────────────────
alter table public.ventas
  add column if not exists aliado_id bigint references public.aliados(id) on delete set null;

create index if not exists idx_ventas_aliado on public.ventas(aliado_id);

-- ── Vínculo del login B2B con su ficha del catálogo ───────────────────────
alter table public.usuarios
  add column if not exists aliado_id bigint references public.aliados(id) on delete set null;

create index if not exists idx_usuarios_aliado on public.usuarios(aliado_id);

-- ── Datos del documento en la solicitud de registro ───────────────────────
-- `nit` ya existía en b2b_solicitudes y se sigue usando como el NÚMERO del
-- documento; `tipo_documento` dice si es NIT, CC, CE o pasaporte.
alter table public.b2b_solicitudes
  add column if not exists tipo_documento text,
  add column if not exists aliado_sugerido_id bigint references public.aliados(id) on delete set null;

-- Búsqueda del aliado por documento al registrarse. No es UNIQUE a propósito:
-- el catálogo histórico puede traer documentos repetidos o vacíos, y un índice
-- único fallaría al aplicar la migración. La ambigüedad la resuelve la persona
-- que aprueba, que es justo el punto del flujo manual.
create index if not exists idx_aliados_documento on public.aliados(nit);

-- ── Backfill: llenar `ventas.aliado_id` desde el nombre ya guardado ───────
-- Se cruza normalizado (minúsculas + sin espacios sobrantes) y SOLO cuando hay
-- exactamente UNA ficha del catálogo que coincida dentro del mismo tenant. Si
-- hay varias, se deja en null a propósito: es preferible que el respaldo por
-- nombre siga operando a enlazar el contrato al aliado equivocado.
update public.ventas v
   set aliado_id = a.id
  from public.aliados a
 where v.aliado_id is null
   and coalesce(a.tenant, 'mayorista') = coalesce(v.tenant, 'mayorista')
   and lower(btrim(a.nombre)) = lower(btrim(coalesce(v.freelance_nombre, v.agencia_nombre)))
   and coalesce(v.freelance_nombre, v.agencia_nombre) is not null
   and (
     select count(*) from public.aliados a2
      where coalesce(a2.tenant, 'mayorista') = coalesce(v.tenant, 'mayorista')
        and lower(btrim(a2.nombre)) = lower(btrim(coalesce(v.freelance_nombre, v.agencia_nombre)))
   ) = 1;

notify pgrst, 'reload schema';
