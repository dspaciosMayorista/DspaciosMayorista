#!/bin/sh
# ────────────────────────────────────────────────────────
# GATES SQL DE LA 262 EN UN POSTGRES LOCAL DESECHABLE (nunca la base compartida).
# Uso (desde dspacios-travel/):  sh supabase/scripts/test_262_gates.sh <contenedor> [minimo|completo] [plantilla254]
#   minimo    (por defecto) esquema MÍNIMO: stubs de las tablas que toca + migración 255 real + privilegios por defecto de Supabase.
#   completo  esquema COMPLETO: clona <plantilla254> (preparar_esquema_local.sh <ct> 254 plantilla254) y aplica 255, 256, 258 y 259.
# Escenarios (cada uno en su propia base clonada de la plantilla, para que nada se contamine):
#   A  flujo principal: preflight → datos legados → 262 → postcheck → pruebas → datos intactos → reaplicación → concurrencia → rollback con datos (aborta)
#      → rollback limpio (huella EXACTA de la 255 restaurada) → reaplicación.
#   B  modificaciones AJENAS ANTES de aplicar la 262 (función de solape, función auxiliar, trigger deshabilitado, columna con otro tipo, tabla homónima, un espacio):
#      el preflight BLOQUEA, la migración ABORTA y NO cambia nada (instantánea idéntica).
#   C  modificaciones AJENAS DESPUÉS de aplicar la 262 (incluida la previa al rollback): postcheck FALLA, reaplicación ABORTA, rollback ABORTA sin cambiar nada.
#   D  permisos efectivos de authenticated/anon sobre servicio_precio_alcance (en modo mínimo, con roles de aplicación simulados contra la RLS).
# ────────────────────────────────────────────────────────
set -u
CT="${1:-}"; MODO="${2:-minimo}"; PLANT254="${3:-plantilla254}"
export MSYS_NO_PATHCONV=1
printf '%s' "$CT" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$' || { echo "Uso: test_262_gates.sh <contenedor> [minimo|completo] [plantilla254]" >&2; exit 2; }
[ "$MODO" = "minimo" ] || [ "$MODO" = "completo" ] || { echo "modo inválido" >&2; exit 2; }
printf '%s' "$PLANT254" | grep -Eq '^[a-z0-9_]+$' || { echo "plantilla inválida" >&2; exit 2; }
AQUI="$(cd "$(dirname "$0")" && pwd)"; MIGS="$AQUI/../migrations"; MIG="$MIGS/20260601000262_servicio_tipo_alcance_rangos_suplemento.sql"
T="${TMPDIR:-/tmp}/t262.$$"; mkdir -p "$T"
FALLAS=0
fallo() { echo "  >> FALLA: $1"; FALLAS=$((FALLAS+1)); }
PASO() { printf '\n══ [%s] %s\n' "$MODO" "$1"; }
SUPER() { docker exec -i -e PGPASSWORD=postgres "$CT" psql -h 127.0.0.1 -U supabase_admin -X -q "$@"; }
P()  { docker exec -i -e PGPASSWORD=postgres "$CT" psql -h 127.0.0.1 -U supabase_admin -d "$DB" -v ON_ERROR_STOP=1 -X -q "$@"; }
PA() { docker exec -i -e PGPASSWORD=postgres "$CT" psql -h 127.0.0.1 -U supabase_admin -d "$DB" -X -t -A "$@"; }
PN() { docker exec -i -e PGPASSWORD=postgres "$CT" psql -h 127.0.0.1 -U supabase_admin -d "$DB" -X -q "$@" 2>&1; }

# Instantánea del esquema: huellas de los objetos auditados + conteos. Si dos instantáneas son iguales, NO cambió nada.
SNAP() { { P < "$AQUI/huellas_262_lectura.sql"; PA -c "select count(*) from information_schema.columns where table_schema='public'" -c "select count(*) from pg_proc where pronamespace='public'::regnamespace" -c "select count(*) from pg_class where relnamespace='public'::regnamespace"; } | md5sum | cut -c1-12; }
clonar() { SUPER -d template1 -c "drop database if exists $1" -c "create database $1 template $2" 2>"$T/clon.err" >/dev/null || { echo "no se pudo clonar $2 -> $1: $(tail -1 "$T/clon.err")"; exit 3; }; }

PASO "0. plantilla"
if [ "$MODO" = "minimo" ]; then
  PL=plant262min; DB=$PL
  SUPER -d template1 -c "drop database if exists $PL" -c "create database $PL" >/dev/null
  P <<'SQL'
-- mi_rol() simulado: lee un parámetro de sesión para poder probar la RLS con roles de aplicación distintos.
create or replace function public.mi_rol() returns text language sql stable as $$ select coalesce(nullif(current_setting('test.rol', true), ''), 'superadmin') $$;
-- Privilegios por defecto de Supabase: toda tabla/secuencia nueva de public queda con todo concedido a anon, authenticated y service_role.
alter default privileges for role supabase_admin in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges for role supabase_admin in schema public grant all on sequences to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
create table public.proveedores (id bigserial primary key, nombre text);
create table public.destinos (id bigserial primary key, nombre text);
create table public.servicios_adicionales (id bigserial primary key, nombre text not null, categoria text, alcance text, precio_persona numeric, proveedor_id bigint, destino_id bigint);
create table public.servicio_temporadas (id bigserial primary key, servicio_id bigint not null references public.servicios_adicionales(id) on delete cascade, nombre text not null, fecha_inicio date, fecha_fin date);
create table public.servicio_tarifa_pax (id bigserial primary key, servicio_id bigint not null, pax_desde int, pax_hasta int, precio numeric, temporada text);
create table public.armado_servicios (paquete_id bigint, servicio_id bigint);
create table public.contrato_servicios (id bigserial primary key, numero_contrato text not null, tipo text not null default 'otro', descripcion text not null, proveedor text, costo numeric default 0, orden integer default 0);
insert into public.contrato_servicios (numero_contrato, descripcion) values ('00-0001', 'Traslado');
SQL
  P < "$MIGS/20260601000255_servicio_suplementos_franja.sql" >/dev/null && echo "  esquema mínimo + 255 listos" || fallo "la 255 falló"
else
  PL=plant262full; DB=$PL
  SUPER -d template1 -c "drop database if exists $PL" -c "create database $PL template $PLANT254" >/dev/null 2>&1 || { echo "no existe la plantilla $PLANT254 (preparar_esquema_local.sh <ct> 254 $PLANT254)"; exit 3; }
  for n in 255_servicio_suplementos_franja 256_disponibilidad_servicios_por_fecha 258_composicion_publicada 259_publicador_tarifario_limite_acotado; do
    P < "$MIGS/20260601000$n.sql" >/dev/null 2>"$T/m.err" && echo "  ${n%%_*} aplicada" || { tail -3 "$T/m.err"; fallo "la ${n%%_*} falló"; }
  done
fi
LINEA="select (select count(*) from servicios_adicionales)||'/'||(select count(*) from servicio_temporadas)||'/'||(select count(*) from servicio_suplementos_franja)||'/'||(select count(*) from contrato_servicios)||'/'||coalesce((select sum(valor) from servicio_suplementos_franja),0)"
datos_legados() {
  P <<'SQL'
insert into public.servicios_adicionales (nombre, categoria, precio_persona) values ('LEGADO traslado', 'tour_traslado', 70000), ('LEGADO asistencia', 'asistencia', 9000);
insert into public.servicio_temporadas (servicio_id, nombre, fecha_inicio, fecha_fin) select id, 'ALTA', '2026-12-01', '2027-01-15' from public.servicios_adicionales where nombre = 'LEGADO traslado';
insert into public.servicio_suplementos_franja (servicio_temporada_id, hora_desde, hora_hasta, tramo, tipo, valor, cobro) select id, '19:00', '06:00', 'ambos', 'monto', 30000, 'grupo' from public.servicio_temporadas where nombre = 'ALTA';
SQL
}
huellas255() { P < "$AQUI/huellas_262_lectura.sql" | grep -E "fn:(tg_servicio_suplementos_franja_solape|fn_franja_)|trg:servicio_suplementos" | sed 's/ *| */|/g' | cut -d'|' -f1,2; }

PASO "A. flujo principal"
DB=gatea; clonar gatea $PL
P < "$AQUI/preflight_262_servicio_tipo_alcance.sql" > "$T/pf.txt"; grep -E "^ +(9|10|11|12|99) " "$T/pf.txt" | cut -c1-200
grep -q "APTO PARA APLICAR" "$T/pf.txt" || fallo "el preflight limpio no da APTO PARA APLICAR"
grep -Eq "[|] BLOQUEA *$" "$T/pf.txt" && fallo "el preflight limpio bloquea"
datos_legados; ANTES=$(PA -c "$LINEA"); echo "  línea base: $ANTES"
H255=$(huellas255); echo "  huellas de la 255 antes: $(echo "$H255" | md5sum | cut -c1-12) ($(echo "$H255" | wc -l | tr -d ' ') objetos)"
P < "$MIG" > /dev/null 2>"$T/mig.err" && echo "  262 aplicada" || { tail -4 "$T/mig.err"; fallo "la 262 falló"; }
P < "$AQUI/postcheck_262_servicio_tipo_alcance.sql" > "$T/pc.txt"; grep -E "^ +(9|10|99) " "$T/pc.txt" | cut -c1-220
grep -Eq "[|] FALLA *$" "$T/pc.txt" && fallo "postcheck con FALLA"; grep -Eq "^ +99 .*[|] OK *$" "$T/pc.txt" || fallo "veredicto global del postcheck no es OK"
P < "$AQUI/huellas_262_lectura.sql" > "$T/hu.txt"; [ "$(grep -c DISTINTA "$T/hu.txt")" = "0" ] && echo "  huellas: 0 DISTINTA ($(grep -c 'OK 262' "$T/hu.txt") OK 262 + $(grep -c 'OK 255' "$T/hu.txt") OK 255)" || fallo "hay huellas DISTINTA tras aplicar"
[ "$(PA -c "$LINEA")" = "$ANTES" ] && echo "  datos legados intactos" || fallo "datos legados cambiaron"
[ "$(PA -c "select count(*) from servicios_adicionales where tipo_receptivo is not null or combo_incluye_traslado is not null")" = "0" ] && echo "  nada se clasificó solo" || fallo "servicios clasificados solos"
[ "$(PA -f - < "$AQUI/inventario_262_servicios_por_clasificar.sql" | wc -l | tr -d ' ')" = "2" ] && echo "  inventario lista los 2 servicios legados" || fallo "inventario != 2 filas"
P < "$AQUI/test_262_servicio_tipo_alcance.sql" > "$T/t.txt" 2>"$T/t.err"
if [ "$MODO" = "minimo" ]; then
  [ -s "$T/t.err" ] && { head -3 "$T/t.err"; fallo "pruebas SQL con error"; }
  grep "^ FALLA" "$T/t.txt" && fallo "pruebas SQL con FALLA"
  [ "$(grep -c '^ OK ' "$T/t.txt")" -ge 30 ] && echo "  pruebas SQL: $(grep -c '^ OK ' "$T/t.txt") OK" || fallo "se esperaban >= 30 OK"
else
  [ -s "$T/t.err" ] && { head -3 "$T/t.err"; fallo "pruebas SQL con error en el esquema completo"; }
  grep "^ FALLA" "$T/t.txt" && fallo "pruebas SQL con FALLA"
  echo "  pruebas SQL (esquema completo): $(grep -c '^ OK ' "$T/t.txt") OK"
fi
P < "$MIG" >/dev/null 2>&1 && echo "  reaplicación idempotente OK" || fallo "la reaplicación falló"
P < "$AQUI/preflight_262_servicio_tipo_alcance.sql" | grep -q "YA APLICADA" && echo "  preflight reconoce YA APLICADA" || fallo "preflight no reconoce YA APLICADA"
VIG=$(PA -c "select id from servicio_temporadas limit 1")
ins() { echo "insert into public.servicio_precio_alcance (servicio_temporada_id, alcance, pax_desde, pax_hasta, precio) values ($VIG, 'trayecto', $1, $2, 1000);"; }
( { echo "begin;"; ins 1 10; echo "select pg_sleep(3);"; echo "commit;"; } | P > "$T/cA.txt" 2>&1 ) & sleep 1
{ echo "begin;"; ins 5 15; echo "commit;"; } | P > "$T/cB.txt" 2>&1; RB=$?; wait
{ [ $RB -ne 0 ] && grep -q "se cruza" "$T/cB.txt"; } && echo "  concurrencia: la 2ª sesión esperó y fue rechazada" || fallo "cruce concurrente no rechazado"
SN1=$(SNAP)
P < "$AQUI/rollback_262_servicio_tipo_alcance.sql" > "$T/rb.txt" 2>&1 && fallo "el rollback NO abortó con datos" || { grep -q "ROLLBACK 262 ABORTADO" "$T/rb.txt" && echo "  rollback con datos: ABORTA" || fallo "rollback falló por otra causa: $(tail -2 "$T/rb.txt")"; }
[ "$(SNAP)" = "$SN1" ] && echo "  el rollback abortado no cambió nada" || fallo "el rollback abortado dejó cambios"
P -c "delete from public.servicio_precio_alcance"
P < "$AQUI/rollback_262_servicio_tipo_alcance.sql" >/dev/null 2>"$T/rb2.err" && echo "  rollback limpio aplicado" || { tail -3 "$T/rb2.err"; fallo "rollback limpio falló"; }
[ "$(huellas255)" = "$H255" ] && echo "  huellas de la 255 restauradas EXACTAS" || fallo "las huellas de la 255 NO quedaron idénticas tras el rollback"
[ "$(PA -c "$LINEA")" = "$ANTES" ] && echo "  datos legados intactos tras el rollback" || fallo "el rollback alteró datos"
[ "$(P < "$AQUI/huellas_262_lectura.sql" | grep -E "^ *(col|chk|idx|pol|priv|tabla):|tg_servicio_precio_alcance|trg:servicio_precio" | grep -vc AUSENTE)" = "0" ] && echo "  ningún objeto de la 262 quedó" || fallo "quedaron objetos de la 262 tras el rollback"
P < "$MIG" >/dev/null 2>&1 && echo "  reaplicada tras el rollback" || fallo "no se pudo reaplicar"
P < "$AQUI/postcheck_262_servicio_tipo_alcance.sql" | grep -Eq "^ +99 .*[|] OK *$" && echo "  postcheck OK" || fallo "postcheck tras reaplicar"

PASO "B. cambios ajenos ANTES de aplicar: preflight BLOQUEA, la migración ABORTA y no cambia nada"
FN_TG_255="$(sed -n '/^create or replace function public.tg_servicio_suplementos_franja_solape/,/^\$\$;/p' "$MIGS/20260601000255_servicio_suplementos_franja.sql")"
escenario_b() {
  DB=gateb; clonar gateb $PL
  P -c "$2" >/dev/null 2>&1 || { fallo "[$1] no se pudo preparar la modificación ajena"; return; }
  S1=$(SNAP)
  P < "$AQUI/preflight_262_servicio_tipo_alcance.sql" > "$T/pfb.txt"
  grep -q "NO APLICAR" "$T/pfb.txt" && echo "  [$1] preflight: NO APLICAR" || fallo "[$1] el preflight no bloqueó"
  P < "$MIG" > /dev/null 2>"$T/mb.err" && fallo "[$1] la migración NO abortó" || { grep -q "262 ABORTADA" "$T/mb.err" && echo "  [$1] migración: ABORTA" || fallo "[$1] abortó por otra causa: $(tail -2 "$T/mb.err")"; }
  [ "$(SNAP)" = "$S1" ] && echo "  [$1] no cambió nada" || fallo "[$1] la migración abortada dejó cambios"
}
escenario_b "función de solape editada" "create or replace function public.tg_servicio_suplementos_franja_solape() returns trigger language plpgsql set search_path = public, pg_temp as \$\$ begin /* parche ajeno */ return new; end; \$\$"
escenario_b "función auxiliar fn_franja_contiene editada" "create or replace function public.fn_franja_contiene(p_x integer, p_d integer, p_h integer) returns boolean language sql immutable set search_path = public, pg_temp as \$\$ select true; \$\$"
escenario_b "trigger de solape deshabilitado" "alter table public.servicio_suplementos_franja disable trigger servicio_suplementos_franja_solape"
escenario_b "columna homónima con otro tipo" "alter table public.servicios_adicionales add column tipo_receptivo integer"
escenario_b "tabla homónima ajena" "create table public.servicio_precio_alcance (id int, otra text)"
DB=gateb; clonar gateb $PL
if P -c "$(printf '%s' "$FN_TG_255" | sed 's/perform pg_advisory_xact_lock/perform  pg_advisory_xact_lock/')" >/dev/null 2>&1; then
  S1=$(SNAP)
  P < "$MIG" >/dev/null 2>&1 && fallo "[un espacio de diferencia] la migración NO abortó" || { echo "  [un espacio de diferencia en el cuerpo] migración: ABORTA"; [ "$(SNAP)" = "$S1" ] && echo "  [un espacio] no cambió nada" || fallo "[un espacio] dejó cambios"; }
else fallo "no se pudo preparar el caso del espacio"; fi
DB=gateb; clonar gateb $PL
P -c "$FN_TG_255" >/dev/null 2>&1; P < "$MIG" >/dev/null 2>&1 && echo "  [control] la función de la 255 reinstalada idéntica NO bloquea" || fallo "[control] la reinstalación idéntica de la 255 bloqueó"

PASO "C. cambios ajenos DESPUÉS de aplicar (incluida la previa al rollback): postcheck FALLA, reaplicación y rollback ABORTAN sin cambiar nada"
escenario_c() {
  DB=gatec; clonar gatec $PL; P < "$MIG" >/dev/null 2>&1 || { fallo "[$1] no se pudo aplicar la 262 base"; return; }
  P -c "$2" >/dev/null 2>&1 || { fallo "[$1] no se pudo preparar la modificación ajena"; return; }
  S1=$(SNAP)
  P < "$AQUI/postcheck_262_servicio_tipo_alcance.sql" | grep -Eq "^ +99 .*[|] FALLA *$" && echo "  [$1] postcheck: FALLA" || fallo "[$1] el postcheck no detectó la modificación"
  P < "$AQUI/preflight_262_servicio_tipo_alcance.sql" | grep -q "NO APLICAR" && echo "  [$1] preflight: NO APLICAR" || fallo "[$1] el preflight no bloqueó"
  P < "$MIG" >/dev/null 2>"$T/mc.err" && fallo "[$1] la reaplicación NO abortó" || { grep -q "262 ABORTADA" "$T/mc.err" && echo "  [$1] reaplicación: ABORTA" || fallo "[$1] reaplicación abortó por otra causa: $(tail -2 "$T/mc.err")"; }
  P < "$AQUI/rollback_262_servicio_tipo_alcance.sql" >/dev/null 2>"$T/rc.err" && fallo "[$1] el rollback NO abortó" || { grep -q "ROLLBACK 262 ABORTADO" "$T/rc.err" && echo "  [$1] rollback: ABORTA" || fallo "[$1] rollback abortó por otra causa: $(tail -2 "$T/rc.err")"; }
  [ "$(SNAP)" = "$S1" ] && echo "  [$1] no cambió nada" || fallo "[$1] reaplicación/rollback abortados dejaron cambios"
}
escenario_c "función de solape modificada ANTES del rollback" "create or replace function public.tg_servicio_suplementos_franja_solape() returns trigger language plpgsql set search_path = public, pg_temp as \$\$ begin return new; end; \$\$"
escenario_c "función de rangos de precio modificada" "create or replace function public.tg_servicio_precio_alcance_solape() returns trigger language plpgsql set search_path = public, pg_temp as \$\$ begin return new; end; \$\$"
escenario_c "TRUNCATE concedido a authenticated" "grant truncate on public.servicio_precio_alcance to authenticated"
escenario_c "restricción de la 262 reemplazada" "alter table public.servicio_precio_alcance drop constraint servicio_precio_alcance_precio_chk, add constraint servicio_precio_alcance_precio_chk check (precio >= -1)"
escenario_c "trigger de rangos deshabilitado" "alter table public.servicio_precio_alcance disable trigger servicio_precio_alcance_solape"

PASO "D. permisos efectivos sobre servicio_precio_alcance"
DB=gated; clonar gated $PL; P < "$MIG" >/dev/null 2>&1 || fallo "no se pudo aplicar la 262"
PRIV="select coalesce(string_agg(pr, ',' order by pr), '(nada)') from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) pr where has_table_privilege('%s','%s',pr)"
echo "  authenticated: $(PA -c "$(printf "$PRIV" authenticated public.servicio_precio_alcance)")"
echo "  anon:          $(PA -c "$(printf "$PRIV" anon public.servicio_precio_alcance)")"
echo "  (referencia, NO modificada por la 262) franjas de la 255, authenticated: $(PA -c "$(printf "$PRIV" authenticated public.servicio_suplementos_franja)")"
[ "$(PA -c "$(printf "$PRIV" authenticated public.servicio_precio_alcance)")" = "DELETE,INSERT,SELECT,UPDATE" ] && echo "  authenticated = solo DELETE,INSERT,SELECT,UPDATE" || fallo "authenticated con permisos distintos de los 4 esperados"
[ "$(PA -c "$(printf "$PRIV" anon public.servicio_precio_alcance)")" = "(nada)" ] && echo "  anon sin ningún permiso" || fallo "anon con permisos"
[ "$(PA -c "select has_function_privilege('authenticated','public.tg_servicio_precio_alcance_solape()','execute')")" = "f" ] && echo "  authenticated NO puede ejecutar directamente la función de trigger" || fallo "authenticated puede ejecutar la función de trigger"
if [ "$MODO" = "minimo" ]; then
  PA -c "insert into servicios_adicionales (nombre) values ('PERM')" >/dev/null
  PA -c "insert into servicio_temporadas (servicio_id, nombre) select id, 'V' from servicios_adicionales where nombre='PERM'" >/dev/null
  VIG=$(PA -c "select id from servicio_temporadas limit 1")
  AS() { printf "set role %s; set \"test.rol\" = '%s'; %s;\n" "$1" "$2" "$3" | PN; }
  R=$(AS authenticated operaciones "insert into public.servicio_precio_alcance (servicio_temporada_id, alcance, precio) values ($VIG, 'trayecto', 10) returning id")
  echo "$R" | grep -q "ERROR" && fallo "operaciones no pudo insertar: $R" || echo "  authenticated + rol operaciones: INSERT permitido"
  R=$(AS authenticated operaciones "update public.servicio_precio_alcance set precio = 11 returning id"); echo "$R" | grep -q "ERROR" && fallo "operaciones no pudo actualizar" || echo "  authenticated + rol operaciones: UPDATE permitido"
  R=$(AS authenticated venta "insert into public.servicio_precio_alcance (servicio_temporada_id, alcance, precio) values ($VIG, 'ida_regreso', 10)"); echo "$R" | grep -qi "row-level security" && echo "  authenticated + rol venta: INSERT rechazado por la RLS" || fallo "venta pudo insertar o error inesperado: $R"
  R=$(AS authenticated venta "select count(*) from public.servicio_precio_alcance" | grep -E "^ +[0-9]+ *$" | tr -d ' '); [ "$R" = "0" ] && echo "  authenticated + rol venta: SELECT devuelve 0 filas (RLS)" || fallo "venta ve filas: $R"
  R=$(AS authenticated operaciones "truncate public.servicio_precio_alcance"); echo "$R" | grep -qi "permission denied" && echo "  authenticated + operaciones: TRUNCATE rechazado (sin permiso)" || fallo "TRUNCATE no rechazado: $R"
  R=$(AS authenticated operaciones "insert into public.servicio_precio_alcance (servicio_temporada_id, alcance, pax_desde, pax_hasta, precio) values ($VIG, 'trayecto', 1, 4, 1), ($VIG, 'trayecto', 3, 6, 1)"); echo "$R" | grep -q "se cruza" && echo "  authenticated: el trigger de rangos corre y rechaza el cruce" || fallo "el trigger no corrió para authenticated: $R"
  R=$(AS anon "" "select count(*) from public.servicio_precio_alcance"); echo "$R" | grep -qi "permission denied" && echo "  anon: SELECT rechazado" || fallo "anon no rechazado: $R"
fi

rm -rf "$T"
printf '\n══ RESULTADO [%s]: %s fallas\n' "$MODO" "$FALLAS"
[ "$FALLAS" -eq 0 ]
