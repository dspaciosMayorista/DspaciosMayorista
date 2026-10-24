#!/bin/sh
# ──────────────────────────────────────────────────────────────────
# FASES · 231 (moneda de la fuente en Bloqueos, #90 Entrega B) sobre una base DESECHABLE (CI o local); nunca remota.
#
# Uso (desde dspacios-travel/):  sh supabase/scripts/test_231_fases.sh <contenedor> [plantilla]
#   plantilla = cadena 001-230 (se crea con: sh supabase/scripts/preparar_esquema_local.sh <ct> 230 plantilla231)
#
#   F1   preflight ANTES de la 231: estructura pendiente (REVISAR), controles decisivos de datos en OK
#   F2   la 231 se aplica sobre datos existentes sin tocarlos y SIN cambiar ninguna policy ni ACL
#   F1.4-F1.5 / F3.1-F3.5  control 20: paquete USD con Bloqueo USD válido (OK); con Bloqueo NULL o COP (REVISAR); también antes de la 231
#   F3   postcheck tras la migración: estructura en OK y 'bloqueos_sin_acreditar' en REVISAR (falta acreditar)
#   F4   batería SQL (test_231_moneda_bloqueos.sql): todo OK
#   F5   acreditación en bloque: aborta con 94 / con una tarifa < 1.000 (sin escribir nada), procede con 95, deja la constancia D2,
#        NO invalida el tarifario publicado y no se puede repetir (escritura-una-vez)
#   F6   postcheck tras la acreditación: el único REVISAR es el interruptor apagado (paso obligatorio pendiente)
#   F7   interruptor estricto (OBLIGATORIO): no enciende con Bloqueos sin acreditar; enciende; POSTCHECK FINAL sin ningún REVISAR; rechaza crear sin moneda; se apaga
#   F8   rollback de DATOS: devuelve los 95 a NULL sin invalidar tarifarios y deja los triggers activos; es idempotente
#   F9   rollback de ESTRUCTURA: se NIEGA con monedas acreditadas; con todo en NULL deja el esquema EXACTAMENTE como antes (huellas md5)
#   F10  la 231 se reaplica tras el rollback y el postcheck vuelve a OK con las mismas definiciones
# ──────────────────────────────────────────────────────────────────
set -eu
CT="${1:-}"
PLANTILLA="${2:-plantilla231}"
export MSYS_NO_PATHCONV=1
valido() { printf '%s' "$1" | grep -Eq "$2"; }
valido "$CT" '^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$' || { echo "Uso: test_231_fases.sh <contenedor> [plantilla]" >&2; exit 2; }
valido "$PLANTILLA" '^[a-z][a-z0-9_]{0,62}$' || { echo "Plantilla inválida." >&2; exit 2; }

AQUI="$(cd "$(dirname "$0")" && pwd)"
APP="$(cd "$AQUI/../.." && pwd)"
PW="${PGPASSWORD_231:-postgres}"
ROL_ADMIN="${ROL_ADMIN:-supabase_admin}"
ROL_MIGRA="${ROL_MIGRA:-supabase_admin}"
SUF="$(od -An -N3 -tx1 /dev/urandom | tr -d ' \n')"
MARCA="test_231f $SUF"
DB="t231_fa_$SUF"
PSA="docker exec -i -e PGPASSWORD=$PW $CT psql -h 127.0.0.1 -U $ROL_ADMIN -X -q -v ON_ERROR_STOP=1"
TMP="$(mktemp -d)"
FALLOS=0
OKS=0
ok()    { echo "OK    $1"; OKS=$((OKS + 1)); }
fallo() { echo "FALLO $1"; FALLOS=$((FALLOS + 1)); }
limpiar() {
  st=$?
  if [ "${KEEP:-}" != 1 ]; then
    m="$($PSA -d postgres -t -A -c "select coalesce((select shobj_description(oid, 'pg_database') from pg_database where datname = '$DB'), '<ausente>')" 2>/dev/null || true)"
    [ "$m" = "$MARCA" ] && $PSA -d postgres -c "drop database if exists $DB with (force)" >/dev/null 2>&1 || true
  fi
  rm -rf "$TMP"
  exit "$st"
}
trap limpiar EXIT
trap 'exit 130' INT TERM

docker inspect -f '{{.State.Running}}' "$CT" 2>/dev/null | grep -qx true || { echo "El contenedor $CT no está corriendo." >&2; exit 2; }
i=1
until $PSA -d postgres -c "create database $DB template $PLANTILLA" >/dev/null 2>"$TMP/cb.err"; do
  [ "$i" -lt 8 ] || { cat "$TMP/cb.err" >&2; exit 1; }
  i=$((i + 1)); sleep 2
done
$PSA -d postgres -c "comment on database $DB is '$MARCA'" >/dev/null
$PSA -d "$DB" > "$TMP/env.out" 2>&1 <<'SQL' || { echo "No se pudo preparar auth.uid()/auth.role() en la base de prueba: $(tail -3 "$TMP/env.out" | cut -c1-300)" >&2; exit 1; }
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
$$;
create or replace function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'))::text
$$;
SQL
MIG="$APP/supabase/migrations/20260601000231_moneda_bloqueos.sql"
aplicar() { docker exec -i -e PGPASSWORD="$PW" "$CT" psql -h 127.0.0.1 -U "$ROL_MIGRA" -d "$DB" -X -q -v ON_ERROR_STOP=1 < "$MIG" > "$TMP/m.out" 2>&1; }
correr() { docker exec -i -e PGPASSWORD="$PW" "$CT" psql -h 127.0.0.1 -U "$ROL_MIGRA" -d "$DB" -X -q -t -A -v ON_ERROR_STOP=1 < "$1"; }
uno() { $PSA -d "$DB" -t -A -c "$1"; }

# Huella de policies y ACL de lo que la 231 toca o lee: la 231 no debe cambiar ni una ni otra.
HUELLA_SQL="select md5(
  coalesce((select string_agg(tablename || '/' || policyname || '/' || cmd || '/' || permissive || '/' || array_to_string(roles, ',') || '/' || coalesce(qual, '') || '/' || coalesce(with_check, ''), '|' order by tablename, policyname)
              from pg_policies where schemaname = 'public'
               and tablename in ('bloqueos_vuelo', 'sillas', 'armado_paquetes', 'armado_vuelos', 'tarifario_resultado', 'ventas', 'abonos', 'cuentas_por_pagar')), '')
  || '#' ||
  coalesce((select string_agg(c.relname || '=' || coalesce((select string_agg(a::text, ',' order by a::text) from unnest(c.relacl) a), '<null>'), '|' order by c.relname)
              from pg_class c join pg_namespace n on n.oid = c.relnamespace
             where n.nspname = 'public' and c.relname in ('bloqueos_vuelo', 'sillas', 'armado_vuelos')), '')
  || '#' ||
  coalesce((select string_agg(p.proname || '=' || coalesce((select string_agg(a::text, ',' order by a::text) from unnest(p.proacl) a), '<null>') || '/' || p.prosecdef::text || '/' || coalesce(p.proconfig::text, ''), '|' order by p.proname)
              from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname in ('crear_bloqueo', 'tarifario_trg_bump_por_bloqueo', 'tarifario_invalidar', 'publicar_tarifario_resultado')), ''))"

# Definiciones EXACTAS (y comentarios) de lo que la 231 reemplaza: el rollback debe devolverlas idénticas.
DEFS_SQL="select md5(
  coalesce((select string_agg(replace(pg_get_functiondef(p.oid), chr(13), '') || coalesce(obj_description(p.oid, 'pg_proc'), '<sin comentario>'), '|' order by p.proname)
              from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname in ('crear_bloqueo', 'tarifario_trg_bump_por_bloqueo')), '')
  || '#' ||
  coalesce((select string_agg(pg_get_triggerdef(t.oid), '|' order by t.tgname)
              from pg_trigger t where not t.tgisinternal and t.tgrelid = 'public.bloqueos_vuelo'::regclass), '')
  || '#' ||
  coalesce((select string_agg(column_name, ',' order by column_name) from information_schema.columns where table_schema = 'public' and table_name = 'bloqueos_vuelo'), '')
  || '#' ||
  coalesce((select string_agg(conname, ',' order by conname) from pg_constraint where conrelid = 'public.bloqueos_vuelo'::regclass), '')
  || '#' ||
  coalesce((select count(*)::text from pg_namespace where nspname = 'p90_priv'), ''))"

# Datos existentes: se deben conservar intactos a lo largo de las primeras fases.
$PSA -d "$DB" >"$TMP/fx.out" 2>&1 <<'SQL' || { echo "Fixtures: $(tail -5 "$TMP/fx.out")"; exit 1; }
insert into public.ventas (numero_contrato, cliente, tenant, precio_venta) values ('DTM-923100', 'Cliente fases 231', 'mayorista', 4765000);
insert into public.abonos (numero_contrato, tenant, valor_abono, fecha_abono) values ('DTM-923100', 'mayorista', 1000000, current_date);
insert into public.cuentas_por_pagar (numero_contrato, tenant, tipo_proveedor, servicio, valor_total) values ('DTM-923100', 'mayorista', 'hotel', 'Hotel fases 231', 860000);
insert into public.destinos (id, nombre, codigo_iata, pais, activo) values (231900, 'T231F DESTINO', 'CTG', 'Colombia', true);
insert into public.armado_paquetes (id, nombre, tipo, activo, destino_id) values (231901, 'Paquete fases 231', 'bloqueo', true, 231900);
insert into public.bloqueos_vuelo (record, aerolinea, ruta, fecha_ida, fecha_regreso, tarifa_neta, tarifa_para_empaquetar, fee_infante, cupos_total, destino_id)
values ('F231A', 'AEROTEST', 'BOG - CTG - BOG', '2030-01-10', '2030-01-13', 200000, 242022, 0, 0, 231900);
insert into public.armado_vuelos (paquete_id, bloqueo_id) select 231901, id from public.bloqueos_vuelo where record = 'F231A';
insert into public.tarifario_resultado (paquete_id, modulo, acomodacion, categoria, regimen, precio_pvp) values (231901, 'bloqueo', 'doble', 'ESTANDAR', 'PC', 1305000);
SQL
DATOS_SQL="select md5(coalesce((select string_agg(x, '|' order by x) from (
    select row(numero_contrato, cliente, tenant, precio_venta)::text as x from public.ventas where numero_contrato = 'DTM-923100'
    union all select row(numero_contrato, tenant, valor_abono, fecha_abono)::text from public.abonos where numero_contrato = 'DTM-923100'
    union all select row(numero_contrato, tenant, tipo_proveedor, servicio, valor_total)::text from public.cuentas_por_pagar where numero_contrato = 'DTM-923100'
    union all select row(paquete_id, modulo, acomodacion, categoria, regimen, precio_pvp)::text from public.tarifario_resultado where paquete_id = 231901
    union all select row(id, record, tarifa_neta, tarifa_para_empaquetar, fee_infante, cupos_total)::text from public.bloqueos_vuelo) s), ''))"
DATOS_ANTES="$(uno "$DATOS_SQL")"
HUELLA_ANTES="$(uno "$HUELLA_SQL")"
DEFS_ANTES="$(uno "$DEFS_SQL")"
[ -n "$HUELLA_ANTES" ] && [ -n "$DATOS_ANTES" ] && [ -n "$DEFS_ANTES" ] || { echo "No se pudo tomar la huella inicial." >&2; exit 1; }

# Revisión de fuente y estado del tarifario del paquete 231901 (para comprobar si una operación lo invalida).
REV_SQL="select tarifario_revision_fuente::text || '/' || coalesce(tarifario_estado::text, '') from public.armado_paquetes where id = 231901"

# ── F1 · preflight antes ──────────────────────────────────────────
correr "$AQUI/preflight_postcheck_231_moneda_bloqueos.sql" > "$TMP/pre.out" 2>&1 || { fallo "F1 el preflight falló: $(tail -3 "$TMP/pre.out")"; exit 1; }
[ "$(wc -l < "$TMP/pre.out" | tr -d ' ')" = 21 ] && ok "F1.1 el preflight es UNA consulta de 21 controles (control|valor|esperado|estado)" || fallo "F1.1 filas del preflight: $(wc -l < "$TMP/pre.out")"
grep -Eq '^migracion_231_estructura\|pendiente\|aplicada\|REVISAR$' "$TMP/pre.out" && ok "F1.2 la 231 aún no está aplicada (estructura pendiente)" || fallo "F1.2 $(grep '^migracion_231' "$TMP/pre.out")"
grep -Eq '^tarifas_cop_menor_1000.*\|0\|0\|OK$' "$TMP/pre.out" && grep -Eq '^paquetes_activos_en_usd_con_bloqueo_sin_acreditar_o_no_usd\|0\|0\|OK$' "$TMP/pre.out" \
  && ok "F1.3 los dos controles decisivos de datos salen OK antes de acreditar (ningún importe < 1.000, ningún paquete USD con Bloqueo sin acreditar o no USD)" || fallo "F1.3 $(grep -E '^(tarifas_cop|paquetes_activos_en_usd)' "$TMP/pre.out")"

# F1.4 — el control 20 funciona ANTES de la 231 (la columna moneda aún no existe): un paquete activo en USD con un Bloqueo (que aún no
# puede estar acreditado) cuenta como REVISAR. Se limpia al terminar.
C20=paquetes_activos_en_usd_con_bloqueo_sin_acreditar_o_no_usd
control20() { correr "$AQUI/preflight_postcheck_231_moneda_bloqueos.sql" 2>&1 | grep "^$C20|" || true; }
limpiar_c20() { $PSA -d "$DB" -c "delete from public.armado_vuelos where paquete_id = 231902" -c "delete from public.bloqueos_vuelo where record in ('F231U','F231V','F231W')" -c "delete from public.armado_paquetes where id = 231902" >/dev/null; }
$PSA -d "$DB" >/dev/null <<'SQL'
insert into public.armado_paquetes (id, nombre, tipo, activo, destino_id, moneda) values (231902, 'Paquete USD fases 231', 'bloqueo', true, 231900, 'USD');
insert into public.bloqueos_vuelo (record, aerolinea, ruta, fecha_ida, fecha_regreso, tarifa_neta, tarifa_para_empaquetar, fee_infante, cupos_total, destino_id)
values ('F231U', 'AEROTEST', 'BOG - CTG - BOG', '2030-06-10', '2030-06-13', 380, 415, 45, 0, 231900);
insert into public.armado_vuelos (paquete_id, bloqueo_id) select 231902, id from public.bloqueos_vuelo where record = 'F231U';
SQL
[ "$(control20)" = "$C20|1|0|REVISAR" ] && ok "F1.4 antes de la 231, un paquete USD con un Bloqueo (necesariamente sin acreditar) sale REVISAR en el control 20" || fallo "F1.4 control 20 antes de la 231: $(control20)"
limpiar_c20
[ "$(control20)" = "$C20|0|0|OK" ] && ok "F1.5 limpiado el escenario, el control 20 vuelve a OK" || fallo "F1.5 $(control20)"

# ── F2 · aplicar ──────────────────────────────────────────────────
aplicar && ok "F2.1 la 231 se aplicó sobre datos existentes" || { fallo "F2.1 la 231 falló: $(cut -c1-600 "$TMP/m.out")"; exit 1; }
[ "$(uno "$DATOS_SQL")" = "$DATOS_ANTES" ] && ok "F2.2 contratos, abonos, CxP, tarifario y Bloqueos (importes y cupos) quedaron intactos" || fallo "F2.2 los datos cambiaron"
[ "$(uno "$HUELLA_SQL")" = "$HUELLA_ANTES" ] && ok "F2.3 la 231 no cambió ninguna policy ni ACL (huella md5 idéntica)" || fallo "F2.3 la 231 cambió policies o ACL"
[ "$(uno "select count(*) from public.bloqueos_vuelo where moneda is not null")" = 0 ] && ok "F2.4 ningún Bloqueo existente fue acreditado por la migración (todos NULL)" || fallo "F2.4 la migración acreditó filas"
if aplicar; then fallo "F2.5 la 231 se dejó aplicar dos veces"; else
  grep -q '231 ya aplicada' "$TMP/m.out" && ok "F2.5 re-aplicar la 231 se NIEGA con mensaje claro (no es silenciosa)" || fallo "F2.5 mensaje inesperado: $(cut -c1-300 "$TMP/m.out")"; fi

# ── F3 · postcheck tras la migración ──────────────────────────────
correr "$AQUI/preflight_postcheck_231_moneda_bloqueos.sql" > "$TMP/post.out" 2>&1 || fallo "F3 el postcheck falló: $(tail -3 "$TMP/post.out")"
if grep -Eq '^migracion_231_estructura\|aplicada\|aplicada\|OK$' "$TMP/post.out" && grep -Eq '^bloqueos_sin_acreditar .*\|REVISAR$' "$TMP/post.out" \
   && [ "$(grep -c '|REVISAR$' "$TMP/post.out")" = 2 ]; then
  ok "F3 postcheck tras migrar: estructura OK y los únicos REVISAR son 'bloqueos_sin_acreditar' y la constancia D2 (falta acreditar)"
else fallo "F3 postcheck: $(grep -E '\|REVISAR$' "$TMP/post.out" | cut -c1-200)"; fi
# F3.1-F3.4 — control 20 con la 231 aplicada: un paquete USD con Bloqueo acreditado en USD es VÁLIDO; con Bloqueo sin acreditar (NULL) o en COP es REVISAR.
$PSA -d "$DB" >/dev/null <<'SQL'
insert into public.armado_paquetes (id, nombre, tipo, activo, destino_id, moneda) values (231902, 'Paquete USD fases 231', 'bloqueo', true, 231900, 'USD');
insert into public.bloqueos_vuelo (record, aerolinea, ruta, fecha_ida, fecha_regreso, tarifa_neta, tarifa_para_empaquetar, fee_infante, cupos_total, destino_id, moneda)
values ('F231U', 'AEROTEST', 'BOG - CTG - BOG', '2030-06-10', '2030-06-13', 380, 415, 45, 0, 231900, 'USD');
insert into public.armado_vuelos (paquete_id, bloqueo_id) select 231902, id from public.bloqueos_vuelo where record = 'F231U';
SQL
[ "$(control20)" = "$C20|0|0|OK" ] && ok "F3.1 paquete USD con Bloqueo acreditado en USD: control 20 en OK (caso válido)" || fallo "F3.1 $(control20)"
$PSA -d "$DB" >/dev/null <<'SQL'
insert into public.bloqueos_vuelo (record, aerolinea, ruta, fecha_ida, fecha_regreso, tarifa_neta, tarifa_para_empaquetar, fee_infante, cupos_total, destino_id)
values ('F231V', 'AEROTEST', 'BOG - CTG - BOG', '2030-07-10', '2030-07-13', 380, 415, 45, 0, 231900);
insert into public.armado_vuelos (paquete_id, bloqueo_id) select 231902, id from public.bloqueos_vuelo where record = 'F231V';
SQL
[ "$(control20)" = "$C20|1|0|REVISAR" ] && ok "F3.2 el mismo paquete USD con un Bloqueo SIN ACREDITAR (NULL) además: control 20 en REVISAR (cuenta el paquete, 1)" || fallo "F3.2 $(control20)"
$PSA -d "$DB" -c "delete from public.armado_vuelos where bloqueo_id = (select id from public.bloqueos_vuelo where record = 'F231V')" -c "delete from public.bloqueos_vuelo where record = 'F231V'" >/dev/null
[ "$(control20)" = "$C20|0|0|OK" ] && ok "F3.3 sin el Bloqueo NULL el control 20 vuelve a OK" || fallo "F3.3 $(control20)"
$PSA -d "$DB" >/dev/null <<'SQL'
insert into public.bloqueos_vuelo (record, aerolinea, ruta, fecha_ida, fecha_regreso, tarifa_neta, tarifa_para_empaquetar, fee_infante, cupos_total, destino_id, moneda)
values ('F231W', 'AEROTEST', 'BOG - CTG - BOG', '2030-08-10', '2030-08-13', 200000, 242022, 0, 0, 231900, 'COP');
insert into public.armado_vuelos (paquete_id, bloqueo_id) select 231902, id from public.bloqueos_vuelo where record = 'F231W';
SQL
[ "$(control20)" = "$C20|1|0|REVISAR" ] && ok "F3.4 un Bloqueo acreditado en COP vinculado al paquete USD: control 20 en REVISAR" || fallo "F3.4 $(control20)"
limpiar_c20
[ "$(control20)" = "$C20|0|0|OK" ] && ok "F3.5 escenario limpiado: control 20 en OK" || fallo "F3.5 $(control20)"
HUELLA_231="$(uno "$HUELLA_SQL")"
DEFS_231="$(uno "$DEFS_SQL")"

# ── F4 · batería SQL ──────────────────────────────────────────────
RC=0; correr "$AQUI/test_231_moneda_bloqueos.sql" > "$TMP/sql.out" 2>&1 || RC=$?
cat "$TMP/sql.out"
if [ "$RC" = 0 ] && grep -q 'TEST 231 SQL: TODO OK' "$TMP/sql.out" && ! grep -q 'FALLO ' "$TMP/sql.out"; then ok "F4 batería SQL en verde"; else fallo "F4 batería SQL en rojo (rc=$RC)"; fi
[ "$(uno "$DATOS_SQL")" = "$DATOS_ANTES" ] && ok "F4.1 la batería (ROLLBACK) no dejó rastro en los datos" || fallo "F4.1 la batería cambió los datos"

# ── F5 · acreditación en bloque ───────────────────────────────────
SIN="$(uno "select count(*) from public.bloqueos_vuelo where moneda is null")"
# Llevar a EXACTAMENTE 94 sin acreditar (aborta: se esperan 95), después a 95.
if [ "$SIN" -lt 94 ]; then
  $PSA -d "$DB" -c "insert into public.bloqueos_vuelo (record, tarifa_neta, tarifa_para_empaquetar, cupos_total) select 'F231R' || g, 200000, 242022, 0 from generate_series(1, 94 - $SIN) g" >/dev/null
elif [ "$SIN" -gt 94 ]; then echo "La base de prueba ya tiene $SIN Bloqueos sin acreditar (>94)." >&2; exit 1; fi
if correr "$AQUI/acreditar_231_bloqueos_cop.sql" > "$TMP/ac0.out" 2>&1; then fallo "F5.1 la acreditación procedió con 94 Bloqueos"; else
  grep -q 'se esperaban 95' "$TMP/ac0.out" && ok "F5.1 con 94 sin acreditar la acreditación ABORTA (se esperan exactamente los 95 de la decisión D2)" || fallo "F5.1 abortó por otra causa: $(cut -c1-300 "$TMP/ac0.out")"; fi
[ "$(uno "select count(*) from public.bloqueos_vuelo where moneda is not null")" = 0 ] && ok "F5.2 el aborto no escribió nada" || fallo "F5.2 el aborto dejó filas acreditadas"
$PSA -d "$DB" -c "insert into public.bloqueos_vuelo (record, tarifa_neta, tarifa_para_empaquetar, cupos_total) values ('F231X', 200000, 242022, 0)" >/dev/null
# Una tarifa de reventa de 415 (casi seguro USD) debe abortar aunque el conteo sea 95.
$PSA -d "$DB" -c "update public.bloqueos_vuelo set tarifa_para_empaquetar = 415 where record = 'F231X'" >/dev/null
if correr "$AQUI/acreditar_231_bloqueos_cop.sql" > "$TMP/ac1.out" 2>&1; then fallo "F5.3 la acreditación procedió con una reventa de 415"; else
  grep -q 'menor a 1.000' "$TMP/ac1.out" && grep -q 'F231X' "$TMP/ac1.out" && ok "F5.3 una tarifa positiva < 1.000 ABORTA la acreditación y nombra el Bloqueo" || fallo "F5.3 abortó por otra causa: $(cut -c1-300 "$TMP/ac1.out")"; fi
[ "$(uno "select count(*) from public.bloqueos_vuelo where moneda is not null")" = 0 ] && ok "F5.4 tampoco escribió nada" || fallo "F5.4 dejó filas acreditadas"
$PSA -d "$DB" -c "update public.bloqueos_vuelo set tarifa_para_empaquetar = 242022 where record = 'F231X'" >/dev/null
# Tarifario publicado: el paquete 231901 queda "listo/publicable"; acreditar NULL -> COP no debe invalidarlo.
$PSA -d "$DB" -c "update public.armado_paquetes set tarifario_estado = 'listo', tarifario_snapshot_publicable = true where id = 231901" >/dev/null
REV0="$(uno "$REV_SQL")"
BLOQ_ANTES="$(uno "select md5(string_agg(row(id, record, tarifa_neta, tarifa_para_empaquetar, fee_infante, cupos_total)::text, '|' order by id)) from public.bloqueos_vuelo")"
correr "$AQUI/acreditar_231_bloqueos_cop.sql" > "$TMP/ac2.out" 2>&1 && ok "F5.5 con exactamente 95 sin acreditar y ningún importe sospechoso la acreditación procede" || fallo "F5.5 acreditación: $(cut -c1-500 "$TMP/ac2.out")"
if [ "$(grep -c '|OK$' "$TMP/ac2.out")" = 2 ] && grep -q '^acreditados_en_bloque_en_COP_con_constancia_D2|95|95|OK$' "$TMP/ac2.out"; then ok "F5.6 el resultado integral de la acreditación: 0 sin acreditar y 95 en COP con constancia D2"; else fallo "F5.6 resultado: $(cut -c1-200 "$TMP/ac2.out")"; fi
[ "$(uno "$REV_SQL")" = "$REV0" ] && ok "F5.7 acreditar los 95 NO invalidó el tarifario publicado del paquete enlazado ($REV0)" || fallo "F5.7 el tarifario cambió: $REV0 -> $(uno "$REV_SQL")"
[ "$(uno "select count(*) from public.bloqueos_vuelo where moneda = 'COP' and moneda_acreditada_ref like 'D2 del dueño 2026-10-23%' and moneda_acreditada_en is not null")" = 95 ] \
  && ok "F5.8 los 95 llevan moneda COP, fecha de acreditación y la referencia a la decisión D2" || fallo "F5.8 constancia incompleta"
[ "$(uno "select md5(string_agg(row(id, record, tarifa_neta, tarifa_para_empaquetar, fee_infante, cupos_total)::text, '|' order by id)) from public.bloqueos_vuelo")" = "$BLOQ_ANTES" ] \
  && ok "F5.9 la acreditación no cambió ningún importe ni cupo" || fallo "F5.9 cambiaron importes"
if correr "$AQUI/acreditar_231_bloqueos_cop.sql" > "$TMP/ac3.out" 2>&1; then fallo "F5.10 la acreditación se pudo repetir"; else
  grep -q 'se esperaban 95' "$TMP/ac3.out" && ok "F5.10 repetirla ABORTA (escritura-una-vez: ya no hay 95 sin acreditar)" || fallo "F5.10 otra causa: $(cut -c1-300 "$TMP/ac3.out")"; fi

# ── F6 · postcheck tras la acreditación ───────────────────────────
correr "$AQUI/preflight_postcheck_231_moneda_bloqueos.sql" > "$TMP/post2.out" 2>&1 || fallo "F6 el postcheck falló: $(tail -3 "$TMP/post2.out")"
if [ "$(grep -c '|REVISAR$' "$TMP/post2.out")" = 1 ] && grep -Eq '^interruptor_estricto\|apagado\|.*\|REVISAR$' "$TMP/post2.out" && grep -Eq '^bloqueos_sin_acreditar .*\|0\|0\|OK$' "$TMP/post2.out" && grep -Eq '^acreditados_en_bloque_con_constancia_de_la_decision_D2 .*\|95 de 95\|95 de 95\|OK$' "$TMP/post2.out"; then
  ok "F6 postcheck tras acreditar: el ÚNICO REVISAR es 'interruptor_estricto' apagado (paso obligatorio pendiente); 0 sin acreditar y 95 de 95 con constancia D2"; else fallo "F6 postcheck: $(grep -E '\|REVISAR$' "$TMP/post2.out" | cut -c1-200)"; fi

# ── F7 · interruptor estricto ─────────────────────────────────────
$PSA -d "$DB" -c "insert into public.bloqueos_vuelo (record, cupos_total) values ('F231N', 0)" >/dev/null
if correr "$AQUI/encender_231_moneda_obligatoria.sql" > "$TMP/en0.out" 2>&1; then fallo "F7.1 el interruptor encendió con un Bloqueo sin acreditar"; else
  grep -q 'sin acreditar' "$TMP/en0.out" && ok "F7.1 no enciende mientras haya Bloqueos sin acreditar" || fallo "F7.1 otra causa: $(cut -c1-300 "$TMP/en0.out")"; fi
$PSA -d "$DB" -c "delete from public.bloqueos_vuelo where record = 'F231N'" >/dev/null
if correr "$AQUI/encender_231_moneda_obligatoria.sql" > "$TMP/en1.out" 2>&1 && [ "$(grep -c '|OK$' "$TMP/en1.out")" = 2 ]; then ok "F7.2 con todos acreditados el interruptor enciende (2 de 2 controles OK)"; else fallo "F7.2 $(cut -c1-300 "$TMP/en1.out")"; fi
# F7.2b — POSTCHECK FINAL con el interruptor ENCENDIDO: ningún REVISAR, interruptor OK, 0 sin acreditar, 95 de 95 con constancia D2.
correr "$AQUI/preflight_postcheck_231_moneda_bloqueos.sql" > "$TMP/post_final.out" 2>&1 || fallo "F7.2b el postcheck final falló: $(tail -3 "$TMP/post_final.out")"
if [ "$(grep -c '|REVISAR$' "$TMP/post_final.out")" = 0 ] && grep -Eq '^interruptor_estricto\|encendido\|.*\|OK$' "$TMP/post_final.out" \
   && grep -Eq '^bloqueos_sin_acreditar .*\|0\|0\|OK$' "$TMP/post_final.out" && grep -Eq '^acreditados_en_bloque_con_constancia_de_la_decision_D2 .*\|95 de 95\|95 de 95\|OK$' "$TMP/post_final.out" \
   && grep -Eq "^$C20\|0\|0\|OK\$" "$TMP/post_final.out"; then
  ok "F7.2b POSTCHECK FINAL con el interruptor encendido: SIN ningún REVISAR (21 controles, interruptor encendido OK)"
else fallo "F7.2b postcheck final: $(grep -E '\|REVISAR$' "$TMP/post_final.out" | cut -c1-200)"; fi
if $PSA -d "$DB" -c "insert into public.bloqueos_vuelo (record, cupos_total) values ('F231N2', 0)" >/dev/null 2>"$TMP/en2.err"; then fallo "F7.3 encendido, se creó un Bloqueo sin moneda"; else
  grep -q 'elige la moneda' "$TMP/en2.err" && ok "F7.3 encendido, crear un Bloqueo sin moneda lo rechaza la base (incluso por SQL directo)" || fallo "F7.3 $(cut -c1-300 "$TMP/en2.err")"; fi
if $PSA -d "$DB" -c "update p90_priv.config set exigir_moneda_bloqueo = false where id" >/dev/null; then ok "F7.4 el interruptor se apaga con una sola sentencia"; else fallo "F7.4 no se pudo apagar"; fi

# ── F8 · rollback de DATOS ────────────────────────────────────────
$PSA -d "$DB" -c "update public.armado_paquetes set tarifario_estado = 'listo', tarifario_snapshot_publicable = true where id = 231901" >/dev/null
REV1="$(uno "$REV_SQL")"
if correr "$AQUI/rollback_231_acreditacion_datos.sql" > "$TMP/rd.out" 2>&1 && [ "$(grep -c '|OK$' "$TMP/rd.out")" = 2 ]; then ok "F8.1 el rollback de datos procede y su resultado integral sale OK"; else fallo "F8.1 rollback datos: $(cut -c1-500 "$TMP/rd.out")"; fi
[ "$(uno "select count(*) from public.bloqueos_vuelo where moneda is not null")" = 0 ] && ok "F8.2 los 95 volvieron a NULL sin constancia" || fallo "F8.2 quedan acreditados"
[ "$(uno "$REV_SQL")" = "$REV1" ] && ok "F8.3 el rollback de datos NO invalidó el tarifario publicado" || fallo "F8.3 el tarifario cambió"
[ "$(uno "select count(*) from pg_trigger where tgrelid = 'public.bloqueos_vuelo'::regclass and tgname in ('trg_bloqueos_moneda_90','tarifario_trg_bloqueos_vuelo') and tgenabled = 'O'")" = 2 ] && ok "F8.4 los dos triggers quedaron activos" || fallo "F8.4 trigger desactivado"
if correr "$AQUI/rollback_231_acreditacion_datos.sql" > "$TMP/rd2.out" 2>&1; then ok "F8.5 el rollback de datos es idempotente"; else fallo "F8.5 segundo rollback: $(cut -c1-300 "$TMP/rd2.out")"; fi

# ── F9 · rollback de ESTRUCTURA ───────────────────────────────────
$PSA -d "$DB" -c "update public.bloqueos_vuelo set moneda = 'USD', tarifa_neta = 380, tarifa_para_empaquetar = 415 where record = 'F231A'" >/dev/null
if correr "$AQUI/rollback_231_moneda_bloqueos.sql" > "$TMP/rb0.out" 2>&1; then fallo "F9.1 el rollback de estructura procedió con una moneda acreditada"; else
  grep -q 'ROLLBACK 231 ABORTADO' "$TMP/rb0.out" && ok "F9.1 el rollback de estructura se NIEGA con monedas acreditadas (no perder la constancia)" || fallo "F9.1 otra causa: $(cut -c1-300 "$TMP/rb0.out")"; fi
[ "$(uno "$DEFS_SQL")" = "$DEFS_231" ] && ok "F9.2 el rollback rechazado no cambió ninguna definición" || fallo "F9.2 el rollback rechazado dejó cambios"
$PSA -d "$DB" -c "alter table public.bloqueos_vuelo disable trigger trg_bloqueos_moneda_90" -c "update public.bloqueos_vuelo set moneda = null, moneda_acreditada_en = null, moneda_acreditada_por = null, moneda_acreditada_ref = null, tarifa_neta = 200000, tarifa_para_empaquetar = 242022 where record = 'F231A'" -c "alter table public.bloqueos_vuelo enable trigger trg_bloqueos_moneda_90" >/dev/null
if correr "$AQUI/rollback_231_moneda_bloqueos.sql" > "$TMP/rb.out" 2>&1; then ok "F9.3 con todo en NULL el rollback de estructura procede"; else fallo "F9.3 rollback: $(cut -c1-500 "$TMP/rb.out")"; fi
[ "$(uno "$HUELLA_SQL")" = "$HUELLA_ANTES" ] && ok "F9.4 policies y ACL EXACTAMENTE como antes de la 231 (huella md5 idéntica)" || fallo "F9.4 policies/ACL no coinciden con el estado anterior"
[ "$(uno "$DEFS_SQL")" = "$DEFS_ANTES" ] && ok "F9.5 funciones, triggers, columnas y CHECK EXACTAMENTE como antes de la 231 (texto de la 181/195/226, comentarios incluidos)" || fallo "F9.5 las definiciones no coinciden con el estado anterior"
[ "$(uno "select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'bloqueos_vuelo' and column_name like 'moneda%'")" = 0 ] && ok "F9.6 las cuatro columnas nuevas quedaron retiradas" || fallo "F9.6 quedan columnas de la 231"
[ "$(uno "select count(*) from pg_namespace where nspname = 'p90_priv'")" = 0 ] && ok "F9.7 el esquema privado del interruptor se retiró" || fallo "F9.7 queda p90_priv"
if correr "$AQUI/rollback_231_moneda_bloqueos.sql" > "$TMP/rb2.out" 2>&1; then fallo "F9.8 un segundo rollback procedió"; else
  grep -q 'la 231 no está aplicada' "$TMP/rb2.out" && ok "F9.8 un segundo rollback se NIEGA con mensaje claro (no está aplicada)" || fallo "F9.8 otra causa: $(cut -c1-300 "$TMP/rb2.out")"; fi

# ── F10 · reaplicar ───────────────────────────────────────────────
aplicar && ok "F10.1 la 231 se reaplicó tras el rollback" || fallo "F10.1 reaplicación: $(cut -c1-600 "$TMP/m.out")"
[ "$(uno "$HUELLA_SQL")" = "$HUELLA_231" ] && [ "$(uno "$DEFS_SQL")" = "$DEFS_231" ] && ok "F10.2 tras reaplicar coinciden policies, ACL y definiciones con la primera aplicación" || fallo "F10.2 difieren tras reaplicar"
correr "$AQUI/preflight_postcheck_231_moneda_bloqueos.sql" > "$TMP/post3.out" 2>&1 || true
if grep -Eq '^migracion_231_estructura\|aplicada\|aplicada\|OK$' "$TMP/post3.out"; then ok "F10.3 postcheck tras reaplicar: estructura OK"; else fallo "F10.3 $(grep -E '\|REVISAR$' "$TMP/post3.out" | cut -c1-200)"; fi

echo ""
if [ "$FALLOS" = 0 ]; then echo "TEST 231 FASES: TODO OK ($OKS comprobaciones)"; else echo "TEST 231 FASES: $FALLOS FALLO(S) de $((OKS + FALLOS))"; exit 1; fi
