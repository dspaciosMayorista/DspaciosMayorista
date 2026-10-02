#!/usr/bin/env bash
# ───────────────────────────────────────────────────────────────────────────
# Prueba de la migración 193 de punta a punta, en PostgreSQL LOCAL desechable.
# NO correr contra Supabase.
#
#   supabase/scripts/pruebas/test_193_registro_b2b.sh [base_192] [puerto]
#
# `base_192` = base con las migraciones 1→192 (local-desde-cero.sh con
# hasta=192). Se usa como PLANTILLA: cada caso trabaja sobre una copia.
#
#   1. ANTES de la 193 (evidencia del hueco): un alta con {"rol":"superadmin"}
#      en la metadata nace superadmin ACTIVO y anon inserta solicitudes.
#   2. Preflight de solo lectura corre sin error.
#   3. Aplica 193 + batería test_193_registro_b2b.sql.
#   4. Reaplicar 193 (idempotente) + batería.
#   5. Dos aprobaciones SIMULTÁNEAS de la misma solicitud: una gana, la otra
#      espera el bloqueo y falla con 55000; la cuenta se activa una sola vez.
#   6. Rollback → vuelven los huecos del paso 1; reaplicar 193 + batería.
#
#   Postcheck de producción (postcheck_193_registro_b2b.sql), siempre en modo
#   SOLO LECTURA forzado (default_transaction_read_only=on):
#   1b. sin la 193: devuelve su tabla (no aborta) y el RESUMEN da false;
#   3b. con la 193: todo true, sin datos personales en la salida, y cada
#       manipulación (dentro de una transacción con ROLLBACK) hace caer
#       exactamente SU verificación;
#   6b. tras el rollback: RESUMEN false; tras reaplicar: todo true.
# ───────────────────────────────────────────────────────────────────────────
set -euo pipefail

BASE="${1:-t193_base192}"
PUERTO="${2:-5432}"
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIG="$AQUI/../../migrations/20260601000193_registro_b2b_endurecido.sql"
ROLLBACK="$AQUI/../rollback_193_registro_b2b_endurecido.sql"
PREFLIGHT="$AQUI/../preflight_193_registro_b2b_lectura.sql"
BATERIA="$AQUI/test_193_registro_b2b.sql"

psql_() { psql -p "$PUERTO" -X -q -v ON_ERROR_STOP=1 "$@"; }
copia() {
  # `create database ... template` falla si hay OTRA conexión a la plantilla
  # (p. ej. el autovacuum justo después de construirla). Se reintenta, y si al
  # final no se puede, se muestra el error en vez de cortar en silencio.
  local intento
  for intento in 1 2 3 4 5 6 7 8 9 10; do
    if psql_ -d postgres -c "drop database if exists $1" -c "create database $1 template $BASE" >/dev/null 2>/tmp/t193_copia.err; then
      break
    fi
    if [ "$intento" -eq 10 ]; then echo "FALLO: no se pudo copiar $BASE en $1:"; cat /tmp/t193_copia.err; exit 1; fi
    sleep 3
  done
  # Supabase real tiene esta columna (proveedor de OAuth); el andamio local no.
  psql_ -d "$1" -c "alter table auth.users add column if not exists raw_app_meta_data jsonb"
}
bateria() { psql_ -d "$1" -f "$BATERIA" 2>&1 | grep -E "OK |FALLO|ERROR|== test_193" ; }

POSTCHECK="$AQUI/../postcheck_193_registro_b2b.sql"
# El postcheck se corre SIEMPRE con la sesión en solo lectura: si intentara
# escribir algo, fallaría aquí.
postcheck() { PGOPTIONS='-c default_transaction_read_only=on' psql_ -d "$1" -At -F '|' -f "$POSTCHECK"; }
campo_ok() { echo "$1" | grep "^$2|" | cut -d'|' -f3; }   # $1 salida, $2 número de verificación
# Manipula la base DENTRO de una transacción, corre el postcheck en esa misma
# transacción y deshace todo. Exige que caiga la verificación $2 y el RESUMEN.
manipulado() {  # $1 base, $2 n esperado en falso, $3 descripción, $4 SQL de la manipulación
  local out
  out=$(psql_ -d "$1" -At -F '|' -c "begin" -c "$4" -f "$POSTCHECK" -c "rollback" 2>&1) \
    || { echo "FALLO: la manipulación '$3' no corrió:"; echo "$out"; exit 1; }
  [ "$(campo_ok "$out" "$2")" = "f" ] || { echo "FALLO: '$3' no hizo caer la verificación $2"; echo "$out"; exit 1; }
  [ "$(campo_ok "$out" 99)" = "f" ] || { echo "FALLO: '$3' no hizo caer el RESUMEN"; exit 1; }
  echo "   OK: $3 → cae la verificación $2"
}

# Paso 1 / 6: comportamiento del trigger y de la policy SIN la 193.
huecos_abiertos() {
  psql_ -d "$1" -At <<'SQL'
begin;
-- Semilla: con la 007, la PRIMERA alta es superadmin por regla propia; se crea
-- antes para que la siguiente demuestre el hueco de la METADATA.
insert into auth.users (id, email, raw_user_meta_data)
  values ('19300000-0000-0000-0000-0000000000fe', 'semilla@t', '{}');
insert into auth.users (id, email, raw_user_meta_data)
  values ('19300000-0000-0000-0000-0000000000ff', 'hueco@t', '{"rol":"superadmin"}');
select 'alta_directa=' || rol || '/' || case when activo then 'activo' else 'inactivo' end
  from public.usuarios where id = '19300000-0000-0000-0000-0000000000ff';
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
insert into public.b2b_solicitudes (tipo, nombre, email, estado) values ('agencia', 'Falsa', 'x@t', 'aprobada');
select 'anon_inserta=si';
rollback;
SQL
}

echo "== 1. Antes de la 193"
copia t193_antes
salida=$(huecos_abiertos t193_antes)
echo "$salida" | sed 's/^/   /'
echo "$salida" | grep -q "alta_directa=superadmin/activo" || { echo "FALLO: no se reprodujo el hueco del trigger"; exit 1; }
echo "$salida" | grep -q "anon_inserta=si" || { echo "FALLO: no se reprodujo el INSERT público"; exit 1; }

echo "== 1b. Postcheck SIN la 193: devuelve su tabla y el RESUMEN da false"
pc=$(postcheck t193_antes)
[ "$(campo_ok "$pc" 99)" = "f" ] || { echo "FALLO: el postcheck aprobó una base sin la 193"; echo "$pc"; exit 1; }
echo "   OK: $(echo "$pc" | grep '^99|' | cut -d'|' -f4)"

echo "== 2. Preflight (solo lectura)"
psql_ -d t193_antes -f "$PREFLIGHT" >/dev/null
echo "   OK: corre sin error"

echo "== 2b. Preflight D con datos sembrados (nombre en ventas vs. solo en comisión manual)"
copia t193_pfd
psql_ -d t193_pfd <<'SQL'
insert into auth.users (id, email, raw_user_meta_data) values
  ('19300000-0000-0000-0000-0000000000d0', 'semilla.d@t', '{}'),
  ('19300000-0000-0000-0000-0000000000d1', 'antiguo.d@t', '{"rol":"agencia"}');
update public.usuarios set rol = 'agencia', activo = true, tenant = 'mayorista', nombre = 'Viajes Antiguos'
 where id = '19300000-0000-0000-0000-0000000000d1';
insert into public.aliados (id, nombre) values (1939501, 'Ficha Otra');
-- Columna esperada a la derecha. "nada" = antes de la 193 tampoco se abría por nombre.
insert into public.ventas (numero_contrato, cliente, tenant, fecha_salida, agencia_nombre, freelance_nombre, aliado_id, modo_compra, comision_b2b) values
  ('DTM-9931',    'C', 'mayorista', '2026-06-15', ' VIAJES ANTIGUOS ', null, null,    null, null),           -- ventas_mismo (normalizado)
  ('MIN-00-9932', 'C', 'minorista', '2026-06-15', null, 'Viajes Antiguos', null,      null, null),           -- ventas_otro
  ('DTM-9933',    'C', 'mayorista', '2026-06-15', 'Otra Agencia', null, null,         null, null),           -- solo_comision_mismo (ventas distinto)
  ('DTM-9934',    'C', 'mayorista', '2026-06-15', null, null, null,                   null, null),           -- solo_comision_mismo (ventas nulo)
  ('DTM-9935',    'C', 'mayorista', '2026-06-15', 'Viajes Antiguos', null, null,      null, null),           -- excluidas (ventas, pero una comisión tiene ficha)
  ('DTM-9936',    'C', 'mayorista', '2026-06-15', 'Viajes Antiguos', null, 1939501,   null, null),           -- nada: ventas.aliado_id
  ('MIN-00-9937', 'C', 'minorista', '2026-06-15', null, null, null,                   null, null),           -- solo_comision_otro
  ('DTM-9938',    'C', 'mayorista', '2026-06-15', 'Viajes Antiguos', null, null,      null, null),           -- ventas_mismo (también en comisión: sin solape)
  ('DTM-9939',    'C', 'mayorista', '2026-06-15', 'Otra Agencia', null, null,         null, null),           -- nada: coincide la ANTIGUA, la reciente es otra
  ('DTM-9940',    'C', 'mayorista', '2026-06-15', 'Otra Agencia', null, null,         null, null),           -- solo_comision_mismo: coincide la RECIENTE
  ('DTM-9941',    'C', 'mayorista', '2026-06-15', 'Otra Agencia', null, null,         'comisionable', 100),  -- nada: comisión resuelta DESDE VENTAS
  ('DTM-9942',    'C', 'mayorista', '2026-06-15', 'Otra Agencia', null, null,         'comisionable', 0),    -- solo_comision_mismo: comision_b2b = 0 → manual
  ('DTM-9943',    'C', 'mayorista', '2026-06-15', 'Otra Agencia', null, null,         null, null),           -- excluidas: antigua con ficha, reciente coincide sin ficha
  ('DTM-9944',    'C', 'mayorista', '2026-06-15', 'Otra Agencia', null, null,         null, null),           -- nada: la reciente coincide pero TIENE ficha
  ('DTM-9945',    'C', 'mayorista', '2026-06-15', 'Viajes Antiguos', null, null,      'comisionable', 100),  -- ventas_mismo: resuelta desde ventas con su nombre
  ('DTM-9946',    'C', 'mayorista', '2026-06-15', 'Otra Agencia', null, null,         'comisionable', null), -- solo_comision_mismo: comision_b2b nulo → manual
  ('DTM-9947',    'C', 'mayorista', '2026-06-15', 'Otra Agencia', null, null,         null, 100);            -- solo_comision_mismo: modo_compra NULL → manual (no desaparece)
-- Ids explícitos y crecientes: "más reciente" = mayor id, como order by id desc.
insert into public.aliados_b2b (id, numero_contrato, aliado, aliado_id) values
  (1939601, 'DTM-9933',    'Viajes Antiguos', null),
  (1939602, 'DTM-9934',    'viajes antiguos', null),
  (1939603, 'DTM-9935',    'Viajes Antiguos', 1939501),
  (1939604, 'MIN-00-9937', 'Viajes Antiguos', null),
  (1939605, 'DTM-9938',    'Viajes Antiguos', null),
  (1939606, 'DTM-9939',    'Viajes Antiguos', null),     -- antigua coincide…
  (1939607, 'DTM-9939',    'Otro Aliado',     null),     -- …reciente distinta
  (1939608, 'DTM-9940',    'Otro Aliado',     null),     -- antigua distinta…
  (1939609, 'DTM-9940',    'Viajes Antiguos', null),     -- …reciente coincide
  (1939610, 'DTM-9941',    'Viajes Antiguos', null),     -- ignorada: resuelta desde ventas
  (1939611, 'DTM-9942',    'Viajes Antiguos', null),
  (1939612, 'DTM-9943',    'Otro Aliado',     1939501),  -- antigua CON ficha…
  (1939613, 'DTM-9943',    'Viajes Antiguos', null),     -- …reciente coincide sin ficha
  (1939614, 'DTM-9944',    'Viajes Antiguos', null),     -- antigua coincide…
  (1939615, 'DTM-9944',    'Viajes Antiguos', 1939501),  -- …reciente coincide CON ficha
  (1939616, 'DTM-9945',    'Otro Aliado',     null),
  (1939617, 'DTM-9946',    'Viajes Antiguos', null),
  (1939618, 'DTM-9947',    'Otro Aliado',     null),     -- antigua distinta…
  (1939619, 'DTM-9947',    'Viajes Antiguos', null);     -- …reciente coincide
SQL
antes=$(psql_ -d t193_pfd -At -c "select md5(concat_ws('#', (select string_agg(t::text, ',' order by t::text) from public.ventas t), (select string_agg(t::text, ',' order by t::text) from public.aliados_b2b t), (select string_agg(t::text, ',' order by t::text) from public.usuarios t)))")
d=$(psql_ -d t193_pfd -At -F '|' -f "$PREFLIGHT" | grep '^D|')
echo "$d" | sed 's/^/   /'
# ventas 3/1 · solo comisión 6/1 · excluidas por ficha 2 · fichas 0 · otras cuentas 0
[ "$d" = "D|antiguo.d@t|Viajes Antiguos|agencia|mayorista|3|1|6|1|2|0|0" ] \
  || { echo "FALLO: la consulta D no midió lo esperado (ventas 3/1, solo comisión 6/1, excluidas 2)"; exit 1; }
# Detalle: CADA contrato en su categoría (los totales solos podrían compensarse).
det=$(psql_ -d t193_pfd -At -F '|' -f "$PREFLIGHT" | grep '^D-detalle|' | cut -d'|' -f3,4)
esperado='DTM-9935|excluidas_por_ficha_en_comision
DTM-9943|excluidas_por_ficha_en_comision
DTM-9933|solo_comision_mismo_tenant
DTM-9934|solo_comision_mismo_tenant
DTM-9940|solo_comision_mismo_tenant
DTM-9942|solo_comision_mismo_tenant
DTM-9946|solo_comision_mismo_tenant
DTM-9947|solo_comision_mismo_tenant
MIN-00-9937|solo_comision_otro_tenant
DTM-9931|ventas_mismo_tenant
DTM-9938|ventas_mismo_tenant
DTM-9945|ventas_mismo_tenant
MIN-00-9932|ventas_otro_tenant'
[ "$det" = "$esperado" ] || { echo "FALLO: D-detalle no clasificó cada contrato como se esperaba:"; echo "$det"; exit 1; }
# El resumen D tiene que ser exactamente la agregación del detalle.
agregado=$(echo "$det" | awk -F'|' '{c[$2]++} END {printf "%d|%d|%d|%d|%d", c["ventas_mismo_tenant"], c["ventas_otro_tenant"], c["solo_comision_mismo_tenant"], c["solo_comision_otro_tenant"], c["excluidas_por_ficha_en_comision"]}')
[ "$(echo "$d" | cut -d'|' -f6-10)" = "$agregado" ] || { echo "FALLO: el resumen D no coincide con su detalle ($agregado)"; exit 1; }
echo "$det" | sed 's/^/     /'
despues=$(psql_ -d t193_pfd -At -c "select md5(concat_ws('#', (select string_agg(t::text, ',' order by t::text) from public.ventas t), (select string_agg(t::text, ',' order by t::text) from public.aliados_b2b t), (select string_agg(t::text, ',' order by t::text) from public.usuarios t)))")
[ "$antes" = "$despues" ] || { echo "FALLO: el preflight modificó datos"; exit 1; }
echo "   OK: D reproduce la cuenta de cobro previa (vía ventas, comisión más reciente), separa exclusiones por ficha y no modifica datos"

echo "== 3. Aplicar 193 + batería"
copia t193_desp
psql_ -d t193_desp -f "$MIG" >/dev/null
r=$(bateria t193_desp); echo "$r" | sed 's/^/   /'
echo "$r" | grep -q "FALLO\|ERROR" && exit 1
echo "$r" | grep -q "== test_193: todas" || { echo "FALLO: la batería no terminó"; exit 1; }

echo "== 3b. Postcheck CON la 193 (solo lectura) + manipulaciones con ROLLBACK"
pc=$(postcheck t193_desp)
echo "$pc" | cut -d'|' -f1,3 | tr '\n' ' ' | sed 's/^/   /'; echo
[ "$(echo "$pc" | grep -c '|f|')" = "0" ] && [ "$(campo_ok "$pc" 99)" = "t" ] \
  || { echo "FALLO: el postcheck no da todo true con la 193:"; echo "$pc"; exit 1; }
[ "$(echo "$pc" | grep -vc '^99|')" = "24" ] || { echo "FALLO: se esperaban 24 verificaciones"; exit 1; }
echo "$pc" | grep -q '@' && { echo "FALLO: la salida del postcheck contiene un correo"; exit 1; }
echo "   OK: 24/24 en true, sesión de solo lectura, sin correos en la salida"
manipulado t193_desp 1  "handle_new_user con search_path=public" \
  "alter function public.handle_new_user() set search_path = public"
manipulado t193_desp 2  "handle_new_user con otro cuerpo (el de la 007)" \
  "create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = '' as \$f\$ begin insert into public.usuarios (id, email, nombre, rol) values (new.id, new.email, coalesce(new.raw_user_meta_data->>'nombre', split_part(new.email, '@', 1)), coalesce((new.raw_user_meta_data->>'rol')::public.rol_usuario, 'venta')) on conflict (id) do nothing; return new; end \$f\$"
manipulado t193_desp 3  "handle_new_user que vuelve a castear el rol de la metadata" \
  "create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = '' as \$f\$ begin insert into public.usuarios (id, email, nombre, rol, activo) values (new.id, new.email, 'x', (new.raw_user_meta_data->>'rol')::public.rol_usuario, true) on conflict (id) do nothing; return new; end \$f\$"
manipulado t193_desp 4  "trigger de alta deshabilitado" \
  "alter table auth.users disable trigger on_auth_user_created"
manipulado t193_desp 5  "trigger nuevo en UPDATE de auth.users" \
  "create trigger t193_upd after update on auth.users for each row execute function public.handle_new_user()"
manipulado t193_desp 6  "default de acceso_legacy_nombre en true" \
  "alter table public.usuarios alter column acceso_legacy_nombre set default true"
manipulado t193_desp 7  "una cuenta con la bandera legacy (backfill no decidido)" \
  "insert into auth.users (id, email) values ('19300000-0000-0000-0000-00000000bf01', 'pc.bandera@t'); update public.usuarios set acceso_legacy_nombre = true where id = '19300000-0000-0000-0000-00000000bf01'"
manipulado t193_desp 8  "RLS desactivada en b2b_solicitudes" \
  "alter table public.b2b_solicitudes disable row level security"
manipulado t193_desp 9  "vuelve la policy de INSERT público" \
  "create policy \"b2b_solicitudes: registro público\" on public.b2b_solicitudes for insert with check (true)"
manipulado t193_desp 10 "anon recupera INSERT en b2b_solicitudes" \
  "grant insert on public.b2b_solicitudes to anon"
manipulado t193_desp 11 "authenticated recupera UPDATE en b2b_solicitudes" \
  "grant update on public.b2b_solicitudes to authenticated"
manipulado t193_desp 12 "service_role pierde INSERT (rompería el registro)" \
  "revoke insert on public.b2b_solicitudes from service_role"
manipulado t193_desp 13 "anon recupera USAGE en la secuencia" \
  "grant usage on sequence public.b2b_solicitudes_id_seq to anon"
manipulado t193_desp 14 "aprobar_solicitud_b2b pasa a SECURITY INVOKER" \
  "alter function public.aprobar_solicitud_b2b(bigint, text, bigint) security invoker"
manipulado t193_desp 15 "aprobar_solicitud_b2b con otro cuerpo" \
  "do \$d\$ begin execute replace(pg_get_functiondef('public.aprobar_solicitud_b2b(bigint, text, bigint)'::regprocedure), 'No tienes permiso', 'Sin permiso'); end \$d\$"
manipulado t193_desp 16 "aprobar_solicitud_b2b ejecutable por PUBLIC" \
  "grant execute on function public.aprobar_solicitud_b2b(bigint, text, bigint) to public"
manipulado t193_desp 16 "aprobar_solicitud_b2b ejecutable por anon" \
  "grant execute on function public.aprobar_solicitud_b2b(bigint, text, bigint) to anon"
manipulado t193_desp 17 "rechazar_solicitud_b2b con search_path=public" \
  "alter function public.rechazar_solicitud_b2b(bigint) set search_path = public"
manipulado t193_desp 18 "rechazar_solicitud_b2b con otro cuerpo" \
  "do \$d\$ begin execute replace(pg_get_functiondef('public.rechazar_solicitud_b2b(bigint)'::regprocedure), 'No tienes permiso', 'Sin permiso'); end \$d\$"
manipulado t193_desp 19 "rechazar_solicitud_b2b sin EXECUTE para authenticated" \
  "revoke execute on function public.rechazar_solicitud_b2b(bigint) from authenticated"
manipulado t193_desp 20 "dueño de la RPC sin BYPASSRLS ni dueño de las tablas" \
  "create role t193_sin_privilegios nologin; alter function public.rechazar_solicitud_b2b(bigint) owner to t193_sin_privilegios"
manipulado t193_desp 21 "dueño de aprobar_solicitud_b2b sin SELECT en auth.users" \
  "create role t193_sin_auth nologin; grant usage on schema auth to t193_sin_auth; alter function public.aprobar_solicitud_b2b(bigint, text, bigint) owner to t193_sin_auth"
manipulado t193_desp 22 "mi_rol() deja de exigir usuario activo" \
  "create or replace function public.mi_rol() returns public.rol_usuario language sql security definer stable as \$f\$ select rol from public.usuarios where id = auth.uid() \$f\$"
manipulado t193_desp 9  "OR true en el USING de la policy de b2b_solicitudes" \
  "alter policy \"b2b_solicitudes: lectura admin\" on public.b2b_solicitudes using (public.mi_rol() in ('superadmin', 'administracion', 'gerencia') or true)"
manipulado t193_desp 9  "policy extra PERMISSIVE en b2b_solicitudes" \
  "create policy \"b2b_solicitudes: extra\" on public.b2b_solicitudes for select using (public.mi_rol() = 'superadmin')"
manipulado t193_desp 9  "la policy de b2b_solicitudes recreada como RESTRICTIVE" \
  "drop policy \"b2b_solicitudes: lectura admin\" on public.b2b_solicitudes; create policy \"b2b_solicitudes: lectura admin\" on public.b2b_solicitudes as restrictive for select using (public.mi_rol() in ('superadmin', 'administracion', 'gerencia'))"
manipulado t193_desp 9  "la policy de b2b_solicitudes limitada a otro rol (no PUBLIC)" \
  "alter policy \"b2b_solicitudes: lectura admin\" on public.b2b_solicitudes to authenticated"
manipulado t193_desp 9  "la policy de b2b_solicitudes pasa a ALL con WITH CHECK (true)" \
  "drop policy \"b2b_solicitudes: lectura admin\" on public.b2b_solicitudes; create policy \"b2b_solicitudes: lectura admin\" on public.b2b_solicitudes for all using (public.mi_rol() in ('superadmin', 'administracion', 'gerencia')) with check (true)"
manipulado t193_desp 10 "PUBLIC recupera SELECT en b2b_solicitudes" \
  "grant select on public.b2b_solicitudes to public"
manipulado t193_desp 11 "authenticated recupera REFERENCES en b2b_solicitudes" \
  "grant references on public.b2b_solicitudes to authenticated"
manipulado t193_desp 11 "authenticated recupera TRIGGER en b2b_solicitudes" \
  "grant trigger on public.b2b_solicitudes to authenticated"
manipulado t193_desp 22 "mi_rol() con 'activo' solo en un comentario" \
  "create or replace function public.mi_rol() returns public.rol_usuario language sql security definer stable as \$f\$ select rol from public.usuarios where id = auth.uid() /* activo */ \$f\$"
manipulado t193_desp 22 "mi_rol() con 'and activo or true'" \
  "create or replace function public.mi_rol() returns public.rol_usuario language sql security definer stable as \$f\$ select rol from public.usuarios where id = auth.uid() and activo or true \$f\$"
manipulado t193_desp 22 "mi_rol() con el mismo cuerpo pero VOLATILE" \
  "alter function public.mi_rol() volatile"
manipulado t193_desp 23 "OR true en el USING de 'usuarios: ver propio perfil'" \
  "alter policy \"usuarios: ver propio perfil\" on public.usuarios using (id = auth.uid() or public.mi_rol() = 'superadmin' or true)"
manipulado t193_desp 23 "policy extra PERMISSIVE de SELECT en usuarios" \
  "create policy \"usuarios: extra\" on public.usuarios for select using (true)"
manipulado t193_desp 23 "'usuarios: superadmin gestiona' con WITH CHECK (true)" \
  "alter policy \"usuarios: superadmin gestiona\" on public.usuarios with check (true)"
manipulado t193_desp 24 "grant de UPDATE por columna a authenticated" \
  "grant update (estado) on public.b2b_solicitudes to authenticated"
manipulado t193_desp 24 "grant de SELECT por columna a anon" \
  "grant select (email) on public.b2b_solicitudes to anon"
manipulado t193_desp 23 "policy que deja al usuario editar su propio perfil" \
  "create policy \"usuarios: autoedición\" on public.usuarios for update using (id = auth.uid())"
pc=$(postcheck t193_desp)
[ "$(campo_ok "$pc" 99)" = "t" ] || { echo "FALLO: alguna manipulación no se deshizo"; echo "$pc"; exit 1; }
echo "   OK: tras las manipulaciones (deshechas), el postcheck vuelve a dar todo true"

echo "== 4. Reaplicar 193 (idempotente) + batería"
psql_ -d t193_desp -f "$MIG" >/dev/null
r=$(bateria t193_desp); echo "$r" | grep -q "FALLO\|ERROR" && { echo "$r"; exit 1; }
echo "$r" | grep -q "== test_193: todas" || { echo "FALLO: la batería no terminó"; exit 1; }
echo "   OK: $(echo "$r" | grep -c 'NOTICE:  OK ') comprobaciones"

echo "== 5. Dos aprobaciones simultáneas"
psql_ -d t193_desp <<'SQL'
insert into auth.users (id, email, raw_user_meta_data) values
  ('19300000-0000-0000-0000-0000000000c1', 'conc.ger@t', '{"nombre":"Conc Gerencia"}'),
  ('19300000-0000-0000-0000-0000000000c2', 'conc.ger2@t', '{"nombre":"Conc Gerencia 2"}'),
  ('19300000-0000-0000-0000-0000000000c3', 'conc.agencia@t', '{"rol":"agencia"}');
update public.usuarios set rol = 'gerencia', activo = true where id in
  ('19300000-0000-0000-0000-0000000000c1', '19300000-0000-0000-0000-0000000000c2');
insert into public.b2b_solicitudes (id, tipo, nombre, email, estado, usuario_id)
  values (1939999, 'agencia', 'Concurrencia', 'conc.agencia@t', 'pendiente', '19300000-0000-0000-0000-0000000000c3');
SQL
como() { echo "set role authenticated; select set_config('request.jwt.claims', json_build_object('sub','$1','role','authenticated')::text, false);"; }
# Sesión A: aprueba y retiene el bloqueo 3 s antes de confirmar.
( { como 19300000-0000-0000-0000-0000000000c1; echo "begin; select public.aprobar_solicitud_b2b(1939999, 'ninguno'); select pg_sleep(3); commit;"; } \
    | psql -p "$PUERTO" -X -q -d t193_desp > /tmp/t193_a.txt 2>&1 ) &
sleep 1
# Sesión B: intenta aprobar la misma mientras A la tiene bloqueada.
{ como 19300000-0000-0000-0000-0000000000c2; echo "select public.aprobar_solicitud_b2b(1939999, 'ninguno');"; } \
  | psql -p "$PUERTO" -X -q -d t193_desp > /tmp/t193_b.txt 2>&1 || true
wait
grep -q "ERROR" /tmp/t193_a.txt && { echo "FALLO: la sesión A falló"; cat /tmp/t193_a.txt; exit 1; }
grep -q "ya fue procesada (estado: aprobada)" /tmp/t193_b.txt || { echo "FALLO: la sesión B no recibió el rechazo esperado"; cat /tmp/t193_b.txt; exit 1; }
estado=$(psql_ -d t193_desp -At -c "select s.estado || '/' || s.revisado_por || '/' || u.activo
  from public.b2b_solicitudes s join public.usuarios u on u.id = s.usuario_id where s.id = 1939999")
[ "$estado" = "aprobada/Conc Gerencia/true" ] || { echo "FALLO: estado final $estado"; exit 1; }
echo "   OK: A aprobó; B esperó el bloqueo y falló con 'ya fue procesada' ($estado)"

echo "== 6. Rollback → huecos vuelven; reaplicar 193 + batería"
copia t193_rb
psql_ -d t193_rb -f "$MIG" >/dev/null
psql_ -d t193_rb -f "$ROLLBACK" >/dev/null
salida=$(huecos_abiertos t193_rb)
echo "$salida" | grep -q "alta_directa=superadmin/activo" && echo "$salida" | grep -q "anon_inserta=si" \
  || { echo "FALLO: el rollback no restauró el estado 007/074"; echo "$salida"; exit 1; }
psql_ -d t193_rb -At -c "select count(*) from pg_proc where proname in ('aprobar_solicitud_b2b','rechazar_solicitud_b2b')" | grep -qx 0 \
  || { echo "FALLO: el rollback dejó las funciones"; exit 1; }
echo "   OK: rollback restaura 007/074 exactamente"
[ "$(campo_ok "$(postcheck t193_rb)" 99)" = "f" ] || { echo "FALLO: el postcheck aprobó una base con la 193 revertida"; exit 1; }
echo "   OK: 6b. el postcheck detecta la 193 revertida"
psql_ -d t193_rb -f "$MIG" >/dev/null
[ "$(campo_ok "$(postcheck t193_rb)" 99)" = "t" ] || { echo "FALLO: el postcheck no aprueba la 193 reaplicada"; exit 1; }
echo "   OK: 6b. el postcheck aprueba la 193 reaplicada"
r=$(bateria t193_rb); echo "$r" | grep -q "FALLO\|ERROR" && { echo "$r"; exit 1; }
echo "$r" | grep -q "== test_193: todas" || { echo "FALLO: la batería no terminó tras reaplicar"; exit 1; }
echo "   OK: reaplicada tras el rollback, batería completa"

for b in t193_antes t193_pfd t193_desp t193_rb; do psql_ -d postgres -c "drop database if exists $b" >/dev/null 2>&1; done
echo "== test_193_registro_b2b.sh: TODO OK"
