#!/bin/sh
# ──────────────────────────────────────────────────────────────────
# FASES · 226 (tarifa de infante, ADITIVA) sobre una base DESECHABLE (CI o local); nunca remota.
#
# Uso (desde dspacios-travel/):  sh supabase/scripts/test_226_fases.sh <contenedor> [plantilla]
#   plantilla = cadena 001-225 (la crea el workflow con preparar_esquema_local.sh ... 225 <plantilla>)
#
#   F1   preflight ANTES de la 226: columnas nuevas ausentes (P2 INFO, 0), prerrequisitos presentes (P1 INFO, 1), cuenta
#        los servicios sin precio de infante (P3 REVISAR) y los paquetes con tarifario publicado (P8 REVISAR); no bloquea
#   F2   la 226 se aplica sobre datos existentes sin tocarlos y SIN cambiar ninguna policy ni ACL (huella md5 igual)
#   F3   postcheck consolidado en OK (10 de 10 controles)
#   F4   batería SQL (test_226_tarifa_infante.sql): todo OK
#   F5   la 226 es idempotente: se aplica una segunda vez y el postcheck sigue en OK
#   F6   el rollback se NIEGA con datos en las columnas nuevas, y con ellas vacías deja el esquema EXACTAMENTE como estaba
#        (huella md5 de policies/ACL y de las definiciones de funciones, vistas y triggers idénticas); idempotente
#   F7   la 226 se vuelve a aplicar tras el rollback y el postcheck vuelve a OK con las mismas definiciones
# ──────────────────────────────────────────────────────────────────
set -eu
CT="${1:-}"
PLANTILLA="${2:-plantilla226}"
export MSYS_NO_PATHCONV=1
valido() { printf '%s' "$1" | grep -Eq "$2"; }
valido "$CT" '^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$' || { echo "Uso: test_226_fases.sh <contenedor> [plantilla]" >&2; exit 2; }
valido "$PLANTILLA" '^[a-z][a-z0-9_]{0,62}$' || { echo "Plantilla inválida." >&2; exit 2; }

AQUI="$(cd "$(dirname "$0")" && pwd)"
APP="$(cd "$AQUI/../.." && pwd)"
PW="${PGPASSWORD_226:-postgres}"
ROL_ADMIN="${ROL_ADMIN:-supabase_admin}"
ROL_MIGRA="${ROL_MIGRA:-supabase_admin}"
SUF="$(od -An -N3 -tx1 /dev/urandom | tr -d ' \n')"
MARCA="test_226f $SUF"
DB="t226_fa_$SUF"
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
MIG="$APP/supabase/migrations/20260601000226_tarifa_infante.sql"
aplicar() { docker exec -i -e PGPASSWORD="$PW" "$CT" psql -h 127.0.0.1 -U "$ROL_MIGRA" -d "$DB" -X -q -v ON_ERROR_STOP=1 < "$MIG" > "$TMP/m.out" 2>&1; }
correr() { docker exec -i -e PGPASSWORD="$PW" "$CT" psql -h 127.0.0.1 -U "$ROL_MIGRA" -d "$DB" -X -q -t -A -v ON_ERROR_STOP=1 < "$1"; }
uno() { $PSA -d "$DB" -t -A -c "$1"; }

# Huella de policies (nombre, comando, roles, USING y WITH CHECK) de las tablas que la 226 toca o lee, MÁS la ACL de las
# funciones y vistas que reemplaza: la 226 no debe cambiar ni una ni otra.
HUELLA_SQL="select md5(
  coalesce((select string_agg(tablename || '/' || policyname || '/' || cmd || '/' || permissive || '/' || array_to_string(roles, ',') || '/' || coalesce(qual, '') || '/' || coalesce(with_check, ''), '|' order by tablename, policyname)
              from pg_policies where schemaname = 'public'
               and tablename in ('tarifario_resultado', 'bloqueos_vuelo', 'servicios_adicionales', 'servicio_temporadas', 'empaquetados',
                                 'armado_paquetes', 'armado_vuelos', 'armado_servicios', 'armado_empaquetados', 'ventas', 'abonos', 'cuentas_por_pagar')), '')
  || '#' ||
  coalesce((select string_agg(c.relname || '=' || coalesce((select string_agg(a::text, ',' order by a::text) from unnest(c.relacl) a), '<null>'), '|' order by c.relname)
              from pg_class c join pg_namespace n on n.oid = c.relnamespace
             where n.nspname = 'public' and c.relname in ('tarifario_resultado_publicable', 'tarifario_resumen', 'tarifario_resultado', 'bloqueos_vuelo', 'servicios_adicionales')), '')
  || '#' ||
  coalesce((select string_agg(p.proname || '=' || coalesce((select string_agg(a::text, ',' order by a::text) from unnest(p.proacl) a), '<null>') || '/' || p.prosecdef::text || '/' || coalesce(p.proconfig::text, ''), '|' order by p.proname)
              from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname in ('publicar_tarifario_resultado', 'crear_bloqueo', 'tarifario_trg_bump_servicio_catalogo', 'tarifario_trg_bump_por_bloqueo', 'tarifario_trg_bump_por_empaquetado')), ''))"

# Definiciones EXACTAS de lo que la 226 reemplaza (el rollback debe devolverlas idénticas).
DEFS_SQL="select md5(
  coalesce((select string_agg(pg_get_functiondef(p.oid), '|' order by p.proname)
              from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname in ('publicar_tarifario_resultado', 'crear_bloqueo', 'tarifario_trg_bump_servicio_catalogo')), '')
  || '#' ||
  coalesce(pg_get_viewdef('public.tarifario_resultado_publicable'::regclass, true), '') || '#' ||
  coalesce(pg_get_viewdef('public.tarifario_resumen'::regclass, true), '') || '#' ||
  coalesce((select string_agg(pg_get_triggerdef(t.oid), '|' order by t.tgname)
              from pg_trigger t where not t.tgisinternal and t.tgname in ('tarifario_trg_servicios_adicionales', 'tarifario_trg_bloqueos_vuelo', 'tarifario_trg_empaquetados')), ''))"

# Datos existentes (columnas anteriores a la 226): se deben conservar intactos a lo largo de todas las fases.
$PSA -d "$DB" >"$TMP/fx.out" 2>&1 <<'SQL' || { echo "Fixtures: $(tail -5 "$TMP/fx.out")"; exit 1; }
insert into public.ventas (numero_contrato, cliente, tenant, precio_venta) values ('DTM-9227', 'Cliente fases 226', 'mayorista', 4765000);
insert into public.abonos (numero_contrato, tenant, valor_abono, fecha_abono) values ('DTM-9227', 'mayorista', 1000000, current_date);
insert into public.cuentas_por_pagar (numero_contrato, tenant, tipo_proveedor, servicio, valor_total) values ('DTM-9227', 'mayorista', 'hotel', 'Hotel fases 226', 860000);
insert into public.servicios_adicionales (id, nombre, precio_persona) values (97226, 'Tour fases 226', 100000);
insert into public.armado_paquetes (id, nombre, tipo, activo) values (97226, 'Paquete fases 226', 'bloqueo', true);
insert into public.armado_servicios (paquete_id, servicio_id) values (97226, 97226);
insert into public.tarifario_resultado (paquete_id, modulo, acomodacion, categoria, regimen, precio_pvp) values (97226, 'bloqueo', 'infante', 'ESTANDAR', 'PC', 1305000);
SQL
DATOS_SQL="select md5(coalesce((select string_agg(x, '|' order by x) from (
    select row(numero_contrato, cliente, tenant, precio_venta)::text as x from public.ventas where numero_contrato = 'DTM-9227'
    union all select row(numero_contrato, tenant, valor_abono, fecha_abono)::text from public.abonos where numero_contrato = 'DTM-9227'
    union all select row(numero_contrato, tenant, tipo_proveedor, servicio, valor_total)::text from public.cuentas_por_pagar where numero_contrato = 'DTM-9227'
    union all select row(id, nombre, precio_persona)::text from public.servicios_adicionales where id = 97226
    union all select row(paquete_id, modulo, acomodacion, categoria, regimen, precio_pvp)::text from public.tarifario_resultado where paquete_id = 97226) s), ''))"
DATOS_ANTES="$(uno "$DATOS_SQL")"
HUELLA_ANTES="$(uno "$HUELLA_SQL")"
DEFS_ANTES="$(uno "$DEFS_SQL")"
[ -n "$HUELLA_ANTES" ] && [ -n "$DATOS_ANTES" ] && [ -n "$DEFS_ANTES" ] || { echo "No se pudo tomar la huella inicial." >&2; exit 1; }

# ── F1 · preflight antes ──────────────────────────────────────────
correr "$AQUI/preflight_226_tarifa_infante.sql" > "$TMP/pre.out" 2>&1 || { fallo "F1 el preflight falló: $(tail -3 "$TMP/pre.out")"; exit 1; }
grep -Eq '^P1\|INFO\|1\|' "$TMP/pre.out" && ok "F1.1 preflight: prerrequisitos presentes (P1 INFO, 1)" || fallo "F1.1 P1: $(grep '^P1' "$TMP/pre.out")"
grep -Eq '^P2\|INFO\|0\|' "$TMP/pre.out" && ok "F1.2 preflight: la 226 aún no está aplicada (P2 INFO, 0)" || fallo "F1.2 P2: $(grep '^P2' "$TMP/pre.out")"
grep -Eq '^P3\|REVISAR\|[1-9][0-9]*\|' "$TMP/pre.out" && grep -Eq '^P8\|REVISAR\|[1-9][0-9]*\|' "$TMP/pre.out" \
  && ok "F1.3 preflight cuenta servicios sin precio de infante (P3) y paquetes con tarifario publicado a regenerar (P8) como REVISAR" \
  || fallo "F1.3 P3/P8: $(grep -E '^P(3|8)' "$TMP/pre.out" | cut -c1-200)"
! grep -q 'BLOQUEANTE' "$TMP/pre.out" && ok "F1.4 preflight no bloquea (ningún nivel BLOQUEANTE)" || fallo "F1.4 el preflight bloquea: $(grep BLOQUEANTE "$TMP/pre.out" | head -2)"

# ── F2 · aplicar ──────────────────────────────────────────────────
aplicar && ok "F2.1 la 226 se aplicó sobre datos existentes" || { fallo "F2.1 la 226 falló: $(cut -c1-600 "$TMP/m.out")"; exit 1; }
[ "$(uno "$DATOS_SQL")" = "$DATOS_ANTES" ] && ok "F2.2 contratos, abonos, cuentas por pagar, servicios y tarifario quedaron intactos" || fallo "F2.2 los datos cambiaron"
[ "$(uno "$HUELLA_SQL")" = "$HUELLA_ANTES" ] && ok "F2.3 la 226 no cambió ninguna policy ni ACL (huella md5 idéntica: es aditiva)" || fallo "F2.3 la 226 cambió policies o ACL"
[ "$(uno "select count(*) from public.servicios_adicionales where id = 97226 and precio_infante is null")" = 1 ] && ok "F2.4 el servicio existente nace con precio_infante NULL (sin configurar = paga como adulto)" || fallo "F2.4 precio_infante no es NULL"

# ── F3 · postcheck ────────────────────────────────────────────────
postcheck() { correr "$AQUI/postcheck_226_tarifa_infante.sql" > "$TMP/post.out" 2>&1; }
postcheck && grep -Eq '^OK\|10\|0\|10\|ninguno\|' "$TMP/post.out" && ok "F3 postcheck: 10 de 10 controles en OK (una fila consolidada)" || fallo "F3 postcheck: $(head -3 "$TMP/post.out" | cut -c1-400)"
HUELLA_226="$(uno "$HUELLA_SQL")"
DEFS_226="$(uno "$DEFS_SQL")"

# ── F4 · batería SQL ──────────────────────────────────────────────
RC=0; correr "$AQUI/test_226_tarifa_infante.sql" > "$TMP/sql.out" 2>&1 || RC=$?
cat "$TMP/sql.out"
if [ "$RC" = 0 ] && grep -q 'TEST 226 SQL: TODO OK' "$TMP/sql.out" && ! grep -q 'FALLO ' "$TMP/sql.out"; then ok "F4 batería SQL en verde"; else fallo "F4 batería SQL en rojo (rc=$RC)"; fi
[ "$(uno "$DATOS_SQL")" = "$DATOS_ANTES" ] && ok "F4.1 la batería (ROLLBACK) no dejó rastro en los datos" || fallo "F4.1 la batería cambió los datos"

# ── F5 · idempotencia ─────────────────────────────────────────────
aplicar && ok "F5.1 la 226 se aplica por segunda vez sin error" || fallo "F5.1 segunda aplicación: $(cut -c1-600 "$TMP/m.out")"
postcheck && grep -Eq '^OK\|10\|0\|10\|ninguno\|' "$TMP/post.out" && ok "F5.2 postcheck sigue en OK" || fallo "F5.2 postcheck: $(head -3 "$TMP/post.out" | cut -c1-400)"
[ "$(uno "$HUELLA_SQL")" = "$HUELLA_226" ] && [ "$(uno "$DEFS_SQL")" = "$DEFS_226" ] && ok "F5.3 la segunda aplicación dejó las mismas policies, ACL y definiciones" || fallo "F5.3 algo cambió al reaplicar"

# ── F6 · rollback ─────────────────────────────────────────────────
# F6.1 se NIEGA si las columnas nuevas ya tienen datos (forward-only tras el uso) y no toca nada.
$PSA -d "$DB" -c "update public.servicios_adicionales set precio_infante = 5000 where id = 97226" >/dev/null
if correr "$AQUI/rollback_226_tarifa_infante.sql" > "$TMP/rb0.out" 2>&1; then fallo "F6.1 el rollback procedió con datos en precio_infante"; else
  grep -q 'ROLLBACK 226 ABORTADO' "$TMP/rb0.out" && ok "F6.1 el rollback se niega con datos en las columnas nuevas (forward-only)" || fallo "F6.1 el rollback falló por otra causa: $(cut -c1-300 "$TMP/rb0.out")"; fi
[ "$(uno "$DEFS_SQL")" = "$DEFS_226" ] && ok "F6.2 el rollback rechazado no cambió ninguna definición" || fallo "F6.2 el rollback rechazado dejó cambios"
$PSA -d "$DB" -c "update public.servicios_adicionales set precio_infante = null where id = 97226" >/dev/null
correr "$AQUI/rollback_226_tarifa_infante.sql" > "$TMP/rb.out" 2>&1 && ok "F6.3 con las columnas vacías el rollback procede" || fallo "F6.3 rollback: $(cut -c1-500 "$TMP/rb.out")"
[ "$(uno "$HUELLA_SQL")" = "$HUELLA_ANTES" ] && ok "F6.4 policies y ACL EXACTAMENTE como antes de la 226 (huella md5 idéntica)" || fallo "F6.4 policies/ACL no coinciden con el estado anterior"
[ "$(uno "$DEFS_SQL")" = "$DEFS_ANTES" ] && ok "F6.5 funciones, vistas y triggers EXACTAMENTE como antes de la 226 (texto de la 181/182/195)" || fallo "F6.5 las definiciones no coinciden con el estado anterior"
[ "$(uno "select count(*) from information_schema.columns where table_schema = 'public' and ((table_name = 'bloqueos_vuelo' and column_name = 'fee_infante') or (table_name = 'servicios_adicionales' and column_name = 'precio_infante') or (table_name = 'servicio_temporadas' and column_name = 'precio_infante') or (table_name = 'tarifario_resultado' and column_name = 'precio_pvp_menor2'))")" = 0 ] \
  && ok "F6.6 las cuatro columnas nuevas quedaron retiradas" || fallo "F6.6 quedan columnas de la 226"
[ "$(uno "$DATOS_SQL")" = "$DATOS_ANTES" ] && ok "F6.7 los datos siguen intactos" || fallo "F6.7 los datos cambiaron"
correr "$AQUI/rollback_226_tarifa_infante.sql" > "$TMP/rb2.out" 2>&1 && ok "F6.8 el rollback es idempotente" || fallo "F6.8 segundo rollback: $(cut -c1-300 "$TMP/rb2.out")"

# ── F7 · reaplicar ────────────────────────────────────────────────
aplicar && ok "F7.1 la 226 se reaplicó tras el rollback" || fallo "F7.1 reaplicación: $(cut -c1-600 "$TMP/m.out")"
postcheck && grep -Eq '^OK\|10\|0\|10\|ninguno\|' "$TMP/post.out" && ok "F7.2 postcheck en OK tras reaplicar" || fallo "F7.2 postcheck: $(head -3 "$TMP/post.out" | cut -c1-400)"
[ "$(uno "$HUELLA_SQL")" = "$HUELLA_226" ] && [ "$(uno "$DEFS_SQL")" = "$DEFS_226" ] && ok "F7.3 tras reaplicar coinciden policies, ACL y definiciones con la primera aplicación" || fallo "F7.3 difieren tras reaplicar"

echo ""
if [ "$FALLOS" = 0 ]; then echo "TEST 226 FASES: TODO OK ($OKS comprobaciones)"; else echo "TEST 226 FASES: $FALLOS FALLO(S) de $((OKS + FALLOS))"; exit 1; fi
