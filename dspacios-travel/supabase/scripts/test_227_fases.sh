#!/bin/sh
# ──────────────────────────────────────────────────────────────────
# FASES · 227 (salida vinculada a Empaquetados sin record + modo cop_trm_63 + cierre E/F/G de la aceptación atómica, ADITIVA) sobre una base DESECHABLE
# (CI o local); nunca remota.
#
# Uso (desde dspacios-travel/):  sh supabase/scripts/test_227_fases.sh <contenedor> [plantilla]
#   plantilla = cadena 001-226 (la crea el workflow con preparar_esquema_local.sh ... 226 <plantilla>)
#
#   F1   preflight ANTES de la 227: prerrequisitos presentes (P1 INFO, 1), la 227 aún no aplicada (P2 INFO, 1: solo la 226), no bloquea
#   F2   la 227 se aplica sobre datos existentes sin tocarlos y SIN cambiar ninguna policy ni ACL existente (huella md5 igual)
#   F3   postcheck consolidado en OK (20 de 20 controles)
#   F4   batería SQL (test_227_salida_vinculada.sql): todo OK
#   F5   la 227 NO se re-aplica (se niega con mensaje claro) y no cambia nada; el postcheck sigue en OK
#   F6   el rollback se NIEGA con datos en las columnas nuevas y con lo que crea E/F/G (oferta cotizada, contador de costos: en una copia
#        desechable), y con todo vacío deja el esquema EXACTAMENTE como estaba
#        (huella md5 de policies/ACL y de las definiciones de funciones, vistas y triggers idénticas); no se repite
#   F7   la 227 se vuelve a aplicar tras el rollback y el postcheck vuelve a OK con las mismas definiciones
# ──────────────────────────────────────────────────────────────────
set -eu
CT="${1:-}"
PLANTILLA="${2:-plantilla227}"
export MSYS_NO_PATHCONV=1
valido() { printf '%s' "$1" | grep -Eq "$2"; }
valido "$CT" '^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$' || { echo "Uso: test_227_fases.sh <contenedor> [plantilla]" >&2; exit 2; }
valido "$PLANTILLA" '^[a-z][a-z0-9_]{0,62}$' || { echo "Plantilla inválida." >&2; exit 2; }

AQUI="$(cd "$(dirname "$0")" && pwd)"
APP="$(cd "$AQUI/../.." && pwd)"
PW="${PGPASSWORD_227:-postgres}"
ROL_ADMIN="${ROL_ADMIN:-supabase_admin}"
ROL_MIGRA="${ROL_MIGRA:-supabase_admin}"
SUF="$(od -An -N3 -tx1 /dev/urandom | tr -d ' \n')"
MARCA="test_227f $SUF"
DB="t227_fa_$SUF"
DB2="t227_fb_$SUF"
PSA="docker exec -i -e PGPASSWORD=$PW $CT psql -h 127.0.0.1 -U $ROL_ADMIN -X -q -v ON_ERROR_STOP=1"
TMP="$(mktemp -d)"
FALLOS=0
OKS=0
ok()    { echo "OK    $1"; OKS=$((OKS + 1)); }
fallo() { echo "FALLO $1"; FALLOS=$((FALLOS + 1)); }
limpiar() {
  st=$?
  if [ "${KEEP:-}" != 1 ]; then
    for base in "$DB" "$DB2"; do
      m="$($PSA -d postgres -t -A -c "select coalesce((select shobj_description(oid, 'pg_database') from pg_database where datname = '$base'), '<ausente>')" 2>/dev/null || true)"
      [ "$m" = "$MARCA" ] && $PSA -d postgres -c "drop database if exists $base with (force)" >/dev/null 2>&1 || true
    done
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
MIG="$APP/supabase/migrations/20260601000227_salida_vinculada_empaquetado.sql"
aplicar() { docker exec -i -e PGPASSWORD="$PW" "$CT" psql -h 127.0.0.1 -U "$ROL_MIGRA" -d "$DB" -X -q -v ON_ERROR_STOP=1 < "$MIG" > "$TMP/m.out" 2>&1; }
correr() { docker exec -i -e PGPASSWORD="$PW" "$CT" psql -h 127.0.0.1 -U "$ROL_MIGRA" -d "$DB" -X -q -t -A -v ON_ERROR_STOP=1 < "$1"; }
uno() { $PSA -d "$DB" -t -A -c "$1"; }

# Huella de policies (nombre, comando, roles, USING y WITH CHECK) de las tablas EXISTENTES que la 227 toca o lee, MÁS la ACL
# de las funciones y vistas que reemplaza o envuelve: la 227 no debe cambiar ni una ni otra.
HUELLA_SQL="select md5(
  coalesce((select string_agg(tablename || '/' || policyname || '/' || cmd || '/' || permissive || '/' || array_to_string(roles, ',') || '/' || coalesce(qual, '') || '/' || coalesce(with_check, ''), '|' order by tablename, policyname)
              from pg_policies where schemaname = 'public'
               and tablename in ('tarifario_resultado', 'salidas_dinamicas', 'empaquetados', 'armado_paquetes', 'armado_vuelos', 'armado_empaquetados',
                                 'armado_paquete_destinos_aereos', 'ventas', 'abonos', 'cuentas_por_pagar', 'contrato_financiero_pendiente')), '')
  || '#' ||
  coalesce((select string_agg(c.relname || '=' || coalesce((select string_agg(a::text, ',' order by a::text) from unnest(c.relacl) a), '<null>'), '|' order by c.relname)
              from pg_class c join pg_namespace n on n.oid = c.relnamespace
             where n.nspname = 'public' and c.relname in ('tarifario_resultado_publicable', 'tarifario_resumen', 'tarifario_resultado', 'empaquetados_basica', 'salidas_dinamicas')), '')
  || '#' ||
  coalesce((select string_agg(p.proname || '=' || coalesce((select string_agg(a::text, ',' order by a::text) from unnest(p.proacl) a), '<null>') || '/' || p.prosecdef::text || '/' || coalesce(p.proconfig::text, ''), '|' order by p.proname)
              from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname in ('publicar_tarifario_resultado', 'validar_config_destinos_aereos_67', 'validar_vinculo_aereo_67', 'registrar_financiero_contrato',
                                                           'revertir_contrato_incompleto', 'tarifario_invalidar', 'tarifario_trg_bump_por_empaquetado')), ''))"

# Definiciones EXACTAS de lo que la 227 reemplaza o debe dejar intacto (el rollback debe devolverlas idénticas).
DEFS_SQL="select md5(
  coalesce((select string_agg(pg_get_functiondef(p.oid), '|' order by p.proname)
              from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname in ('publicar_tarifario_resultado', 'validar_config_destinos_aereos_67', 'validar_vinculo_aereo_67',
                                                           'registrar_financiero_contrato', 'revertir_contrato_incompleto', 'tarifario_invalidar', 'tarifario_trg_bump_por_empaquetado')), '')
  || '#' ||
  coalesce(pg_get_viewdef('public.tarifario_resultado_publicable'::regclass, true), '') || '#' ||
  coalesce((select string_agg(pg_get_triggerdef(t.oid), '|' order by t.tgname)
              from pg_trigger t where not t.tgisinternal and t.tgname in ('tarifario_trg_empaquetados', 'tr_inv_destino_empaquetado_67', 'tr_vinculo_aereo_67',
                                                                           'tr_config_paquete_aereo_67_ins', 'tr_config_paquete_aereo_67_upd', 'tr_config_alternativa_aerea_67')), ''))"

# Datos existentes (anteriores a la 227): se deben conservar intactos a lo largo de todas las fases.
$PSA -d "$DB" >"$TMP/fx.out" 2>&1 <<'SQL' || { echo "Fixtures: $(tail -5 "$TMP/fx.out")"; exit 1; }
insert into public.ventas (numero_contrato, cliente, tenant, precio_venta) values ('DTM-9327', 'Cliente fases 227', 'mayorista', 4765000);
insert into public.abonos (numero_contrato, tenant, valor_abono, fecha_abono) values ('DTM-9327', 'mayorista', 1000000, current_date);
insert into public.cuentas_por_pagar (numero_contrato, tenant, tipo_proveedor, servicio, valor_total) values ('DTM-9327', 'mayorista', 'hotel', 'Hotel fases 227', 860000);
insert into public.destinos (id, nombre, codigo_iata, pais, activo) values (97227, 'Destino fases 227', 'CTG', 'Colombia', true);
insert into public.armado_paquetes (id, nombre, tipo, activo, destino_id) values (97227, 'Paquete dinamico fases 227', 'dinamico', true, 97227);
insert into public.empaquetados (id, record, aerolinea, ruta, destino_id, fecha_ida, tarifa_proveedor, tarifa_para_empaquetar, fee_infante, activo)
values (97227, null, 'AEROTEST', 'BOG - CTG - BOG', 97227, current_date + 40, 1000000, 1130000, 80500, true);
insert into public.salidas_dinamicas (id, paquete_id, fecha_ida, fecha_regreso, valor_tiquete) values (97227, 97227, current_date + 40, current_date + 43, 400000);
SQL
DATOS_SQL="select md5(coalesce((select string_agg(x, '|' order by x) from (
    select row(numero_contrato, cliente, tenant, precio_venta)::text as x from public.ventas where numero_contrato = 'DTM-9327'
    union all select row(numero_contrato, tenant, valor_abono, fecha_abono)::text from public.abonos where numero_contrato = 'DTM-9327'
    union all select row(numero_contrato, tenant, tipo_proveedor, servicio, valor_total)::text from public.cuentas_por_pagar where numero_contrato = 'DTM-9327'
    union all select row(id, nombre, tipo, activo, destino_id)::text from public.armado_paquetes where id = 97227
    union all select row(id, record, aerolinea, ruta, tarifa_proveedor, tarifa_para_empaquetar, fee_infante)::text from public.empaquetados where id = 97227
    union all select row(id, paquete_id, fecha_ida, fecha_regreso, valor_tiquete)::text from public.salidas_dinamicas where id = 97227) s), ''))"
DATOS_ANTES="$(uno "$DATOS_SQL")"
HUELLA_ANTES="$(uno "$HUELLA_SQL")"
DEFS_ANTES="$(uno "$DEFS_SQL")"
[ -n "$HUELLA_ANTES" ] && [ -n "$DATOS_ANTES" ] && [ -n "$DEFS_ANTES" ] || { echo "No se pudo tomar la huella inicial." >&2; exit 1; }

# ── F1 · preflight antes ──────────────────────────────────────────
correr "$AQUI/preflight_227_salida_vinculada_empaquetado.sql" > "$TMP/pre.out" 2>&1 || { fallo "F1 el preflight falló: $(tail -3 "$TMP/pre.out")"; exit 1; }
grep -Eq '^P1\|INFO\|1\|' "$TMP/pre.out" && ok "F1.1 preflight: prerrequisitos presentes (P1 INFO, 1)" || fallo "F1.1 P1: $(grep '^P1' "$TMP/pre.out")"
grep -Eq '^P2\|INFO\|1\|' "$TMP/pre.out" && ok "F1.2 preflight: solo la 226 está aplicada, la 227 no (P2 INFO, 1)" || fallo "F1.2 P2: $(grep '^P2' "$TMP/pre.out")"
grep -Eq '^P5\|INFO\|[1-9][0-9]*\|' "$TMP/pre.out" && grep -Eq '^P4\|INFO\|[1-9][0-9]*\|' "$TMP/pre.out" \
  && ok "F1.3 preflight cuenta los Empaquetados sin record candidatos (P5) y las salidas existentes que quedarán manuales (P4)" \
  || fallo "F1.3 P4/P5: $(grep -E '^P(4|5)' "$TMP/pre.out" | cut -c1-200)"
! grep -q 'BLOQUEANTE' "$TMP/pre.out" && ok "F1.4 preflight no bloquea (ningún nivel BLOQUEANTE)" || fallo "F1.4 el preflight bloquea: $(grep BLOQUEANTE "$TMP/pre.out" | head -2)"

# ── F2 · aplicar ──────────────────────────────────────────────────
aplicar && ok "F2.1 la 227 se aplicó sobre datos existentes" || { fallo "F2.1 la 227 falló: $(cut -c1-600 "$TMP/m.out")"; exit 1; }
[ "$(uno "$DATOS_SQL")" = "$DATOS_ANTES" ] && ok "F2.2 contratos, abonos, cuentas por pagar, paquetes, empaquetados y salidas quedaron intactos" || fallo "F2.2 los datos cambiaron"
[ "$(uno "$HUELLA_SQL")" = "$HUELLA_ANTES" ] && ok "F2.3 la 227 no cambió ninguna policy ni ACL existente (huella md5 idéntica: es aditiva)" || fallo "F2.3 la 227 cambió policies o ACL"
[ "$(uno "select count(*) from public.salidas_dinamicas where id = 97227 and empaquetado_id is null and moneda = 'COP'")" = 1 ] \
  && ok "F2.4 la salida existente queda MANUAL (empaquetado_id NULL, moneda COP)" || fallo "F2.4 la salida existente cambió"
[ "$(uno "select count(*) from public.armado_paquetes where id = 97227 and modo_oferta = 'legacy' and trm_oferta is null")" = 1 ] \
  && ok "F2.5 el paquete existente queda en modo legacy sin TRM" || fallo "F2.5 el paquete existente cambió de modo"

# ── F3 · postcheck ────────────────────────────────────────────────
postcheck() { correr "$AQUI/postcheck_227_salida_vinculada_empaquetado.sql" > "$TMP/post.out" 2>&1; }
postcheck && grep -Eq '^OK\|20\|0\|20\|ninguno\|' "$TMP/post.out" && ok "F3 postcheck: 20 de 20 controles en OK (una fila consolidada)" || fallo "F3 postcheck: $(head -3 "$TMP/post.out" | cut -c1-400)"
HUELLA_227="$(uno "$HUELLA_SQL")"
DEFS_227="$(uno "$DEFS_SQL")"

# ── F4 · batería SQL ──────────────────────────────────────────────
RC=0; correr "$AQUI/test_227_salida_vinculada.sql" > "$TMP/sql.out" 2>&1 || RC=$?
cat "$TMP/sql.out"
if [ "$RC" = 0 ] && grep -q 'TEST 227 SQL: TODO OK' "$TMP/sql.out" && ! grep -q 'FALLO ' "$TMP/sql.out"; then ok "F4 batería SQL en verde"; else fallo "F4 batería SQL en rojo (rc=$RC)"; fi
[ "$(uno "$DATOS_SQL")" = "$DATOS_ANTES" ] && ok "F4.1 la batería (ROLLBACK) no dejó rastro en los datos" || fallo "F4.1 la batería cambió los datos"

# ── F5 · la 227 NO se re-aplica ───────────────────────────────────
if aplicar; then fallo "F5.1 la 227 se aplicó por segunda vez (debía negarse)"; else
  grep -q '227 ya aplicada' "$TMP/m.out" && ok "F5.1 la 227 se niega a re-aplicarse con un mensaje claro" || fallo "F5.1 segunda aplicación falló por otra causa: $(cut -c1-300 "$TMP/m.out")"; fi
postcheck && grep -Eq '^OK\|20\|0\|20\|ninguno\|' "$TMP/post.out" && ok "F5.2 postcheck sigue en OK" || fallo "F5.2 postcheck: $(head -3 "$TMP/post.out" | cut -c1-400)"
[ "$(uno "$HUELLA_SQL")" = "$HUELLA_227" ] && [ "$(uno "$DEFS_SQL")" = "$DEFS_227" ] && ok "F5.3 el intento de re-aplicar no cambió policies, ACL ni definiciones" || fallo "F5.3 algo cambió al reaplicar"

# ── F6 · rollback ─────────────────────────────────────────────────
# F6.1 se NIEGA si las columnas nuevas ya tienen datos (forward-only tras el uso) y no toca nada.
$PSA -d "$DB" -c "update public.armado_paquetes set modo_oferta = 'cop_trm_63', trm_oferta = 4000 where id = 97227" >/dev/null
if correr "$AQUI/rollback_227_salida_vinculada_empaquetado.sql" > "$TMP/rb0.out" 2>&1; then fallo "F6.1 el rollback procedió con un paquete en modo cop_trm_63"; else
  grep -q 'rollback 227 ABORTADO' "$TMP/rb0.out" && ok "F6.1 el rollback se niega con datos en las columnas nuevas (forward-only)" || fallo "F6.1 el rollback falló por otra causa: $(cut -c1-300 "$TMP/rb0.out")"; fi
[ "$(uno "$DEFS_SQL")" = "$DEFS_227" ] && ok "F6.2 el rollback rechazado no cambió ninguna definición" || fallo "F6.2 el rollback rechazado dejó cambios"
# F6.1b: también se NIEGA con lo que crea el cierre E/F/G. Una oferta cotizada es historia (no se borra de vuelta), así que se prueba
# en una COPIA desechable de la base (marcada para su limpieza) y no en la principal.
if $PSA -d postgres -c "create database $DB2 template $DB" >/dev/null 2>"$TMP/db2.err"; then
  $PSA -d postgres -c "comment on database $DB2 is '$MARCA'" >/dev/null
  PS2="docker exec -i -e PGPASSWORD=$PW $CT psql -h 127.0.0.1 -U $ROL_ADMIN -X -q -v ON_ERROR_STOP=1 -d $DB2"
  correr2() { docker exec -i -e PGPASSWORD="$PW" "$CT" psql -h 127.0.0.1 -U "$ROL_MIGRA" -d "$DB2" -X -q -t -A -v ON_ERROR_STOP=1 < "$1"; }
  $PS2 -c "update public.armado_paquetes set p63_rev_costos = 3 where id = 97227" >/dev/null
  if correr2 "$AQUI/rollback_227_salida_vinculada_empaquetado.sql" > "$TMP/rb1b.out" 2>&1; then fallo "F6.1b.1 el rollback procedió con un paquete con revisión de costos acumulada"; else
    grep -q 'revisión de costos' "$TMP/rb1b.out" && ok "F6.1b.1 el rollback se niega con revisión de costos acumulada (forward-only)" || fallo "F6.1b.1 rechazo por otra causa: $(cut -c1-300 "$TMP/rb1b.out")"; fi
  $PS2 -c "update public.armado_paquetes set p63_rev_costos = 0 where id = 97227" >/dev/null
  $PS2 -c "insert into public.cotizaciones (tenant) values ('mayorista'); insert into public.p63_oferta (cotizacion_id, tenant, paquete_id, trm, rev_fuente, rev_costos, huella, huella_financiera, snapshot) select id, 'mayorista', 97227, 4000, 0, 0, 'h', 'f', '{}'::jsonb from public.cotizaciones order by id desc limit 1" >/dev/null
  if correr2 "$AQUI/rollback_227_salida_vinculada_empaquetado.sql" > "$TMP/rb1c.out" 2>&1; then fallo "F6.1b.2 el rollback procedió con una oferta cotizada"; else
    grep -q 'oferta(s) cotizada' "$TMP/rb1c.out" && ok "F6.1b.2 el rollback se niega con una oferta cotizada (snapshot privado = historia; forward-only)" || fallo "F6.1b.2 rechazo por otra causa: $(cut -c1-300 "$TMP/rb1c.out")"; fi
  $PSA -d postgres -c "drop database if exists $DB2 with (force)" >/dev/null 2>&1 || true
else fallo "F6.1b no se pudo crear la copia desechable: $(cut -c1-200 "$TMP/db2.err")"; fi
$PSA -d "$DB" -c "update public.armado_paquetes set modo_oferta = 'legacy', trm_oferta = null where id = 97227" >/dev/null
correr "$AQUI/rollback_227_salida_vinculada_empaquetado.sql" > "$TMP/rb.out" 2>&1 && ok "F6.3 con las columnas vacías el rollback procede" || fallo "F6.3 rollback: $(cut -c1-500 "$TMP/rb.out")"
[ "$(uno "$HUELLA_SQL")" = "$HUELLA_ANTES" ] && ok "F6.4 policies y ACL EXACTAMENTE como antes de la 227 (huella md5 idéntica)" || fallo "F6.4 policies/ACL no coinciden con el estado anterior"
[ "$(uno "$DEFS_SQL")" = "$DEFS_ANTES" ] && ok "F6.5 funciones, vistas y triggers EXACTAMENTE como antes de la 227 (texto de la 181/210/220/226)" || fallo "F6.5 las definiciones no coinciden con el estado anterior"
[ "$(uno "select count(*) from information_schema.columns c join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE' where c.table_schema = 'public' and ((c.table_name = 'armado_paquetes' and c.column_name in ('modo_oferta', 'trm_oferta', 'p63_rev_costos')) or (c.table_name = 'salidas_dinamicas' and c.column_name in ('empaquetado_id', 'moneda')) or (c.table_name = 'empaquetados' and c.column_name = 'moneda') or (c.table_name = 'cuentas_por_pagar' and c.column_name in ('valor_cop_63', 'trm_63', 'aceptacion_63_id', 'obligacion_63')) or (c.table_name = 'ventas' and c.column_name = 'aceptacion_63_id'))")" = 0 ] \
  && [ "$(uno "select count(*) from pg_class where relnamespace = 'public'::regnamespace and relname in ('p63_oferta', 'p63_aceptacion', 'tarifario_oferta_63')")" = 0 ] \
  && [ "$(uno "select count(*) from pg_proc where pronamespace = 'public'::regnamespace and (proname like '%\_63' escape '\' or proname like 'p63\_%' escape '\')")" = 0 ] \
  && ok "F6.6 las columnas, las tablas privadas y las funciones nuevas quedaron retiradas" || fallo "F6.6 quedan objetos de la 227"
[ "$(uno "$DATOS_SQL")" = "$DATOS_ANTES" ] && ok "F6.7 los datos siguen intactos" || fallo "F6.7 los datos cambiaron"
if correr "$AQUI/rollback_227_salida_vinculada_empaquetado.sql" > "$TMP/rb2.out" 2>&1; then fallo "F6.8 un segundo rollback procedió (debía negarse: la 227 ya no está aplicada)"; else
  grep -q 'la 227 no está aplicada' "$TMP/rb2.out" && ok "F6.8 un segundo rollback se niega con un mensaje claro y no cambia nada" || fallo "F6.8 segundo rollback: $(cut -c1-300 "$TMP/rb2.out")"; fi

# ── F7 · reaplicar ────────────────────────────────────────────────
aplicar && ok "F7.1 la 227 se reaplicó tras el rollback" || fallo "F7.1 reaplicación: $(cut -c1-600 "$TMP/m.out")"
postcheck && grep -Eq '^OK\|20\|0\|20\|ninguno\|' "$TMP/post.out" && ok "F7.2 postcheck en OK tras reaplicar" || fallo "F7.2 postcheck: $(head -3 "$TMP/post.out" | cut -c1-400)"
[ "$(uno "$HUELLA_SQL")" = "$HUELLA_227" ] && [ "$(uno "$DEFS_SQL")" = "$DEFS_227" ] && ok "F7.3 tras reaplicar coinciden policies, ACL y definiciones con la primera aplicación" || fallo "F7.3 difieren tras reaplicar"

echo ""
if [ "$FALLOS" = 0 ]; then echo "TEST 227 FASES: TODO OK ($OKS comprobaciones)"; else echo "TEST 227 FASES: $FALLOS FALLO(S) de $((OKS + FALLOS))"; exit 1; fi
