#!/bin/sh
# ──────────────────────────────────────────────────────────────────
# FASES · 232 (#109 D1: retirar escritura de anon en cxp_pagos / retenciones_cxp) sobre una base
# DESECHABLE (CI o local); nunca remota.
#
# Uso (desde dspacios-travel/):  sh supabase/scripts/test_232_fases.sh <contenedor> [plantilla]
#   plantilla = cadena 001-231 (se crea con: sh supabase/scripts/preparar_esquema_local.sh <ct> 231 plantilla232)
#   Sin plantilla se usa la base `postgres` del contenedor como origen (debe tener el esquema hasta la 231).
#
#   F1  ANTES: preflight corre (una consulta) y no tiene FALLA; anon conserva escritura (si no, el hallazgo no aplica)
#   F2  ANTES: SET ROLE anon (permisos SQL de Postgres; NO es una petición HTTP real a PostgREST/Data API, que no se
#       levanta aquí): INSERT/UPDATE/DELETE llegan a la RLS (no los rechaza el privilegio) y TRUNCATE, que no pasa
#       por RLS, TIENE ÉXITO como anon -> el hueco medido en permisos SQL
#   F3  ANTES: regresión de roles autorizados (authenticated) -> huella de resultados A
#   F4  se aplica la 232 por la RUTA MANUAL EXACTA del dueño (aplicar_manual_232_*.sql: begin; migración; commit; enviado
#       ENTERO como una sola consulta, igual que el editor SQL); además se comprueba que su cuerpo es byte a byte la migración
#   F5  DESPUÉS: postcheck en una consulta, cero FALLA
#   F6  DESPUÉS: SET ROLE anon rechazado POR PRIVILEGIO (42501 "permission denied for table") en INSERT/UPDATE/DELETE/TRUNCATE
#   F7  DESPUÉS: la misma regresión de authenticated da una huella B idéntica a A (nada se cortó)
#   F8  DESPUÉS: service_role sigue escribiendo; la guarda de la 228 sigue activa (Z9601 / Z9604)
#   F9  la 232 no cambia datos ni policies ni triggers (conteos y huella de policies)
#   F10 ruta manual con INSERT heredado de PUBLIC: ABORTA y REVIERTE AMBOS REVOKE (anon conserva los 8 privilegios),
#       sin transacción abierta; con el runner (psql -1) pasa lo mismo
#   F11 el rollback (solo decisión excepcional) devuelve a anon sus privilegios; reaplicar la 232 por el runner (-1) y
#       luego por la ruta manual es idempotente
# ──────────────────────────────────────────────────────────────────
set -eu
CT="${1:-}"
PLANTILLA="${2:-postgres}"
export MSYS_NO_PATHCONV=1
valido() { printf '%s' "$1" | grep -Eq "$2"; }
valido "$CT" '^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$' || { echo "Uso: test_232_fases.sh <contenedor> [plantilla]" >&2; exit 2; }
valido "$PLANTILLA" '^[a-z][a-z0-9_]{0,62}$' || { echo "Plantilla inválida." >&2; exit 2; }

AQUI="$(cd "$(dirname "$0")" && pwd)"
APP="$(cd "$AQUI/../.." && pwd)"
PW="${PGPASSWORD_232:-postgres}"
ROL_ADMIN="${ROL_ADMIN:-supabase_admin}"
SUF="$(od -An -N3 -tx1 /dev/urandom | tr -d ' \n')"
MARCA="test_232f $SUF"
DB="t232_fa_$SUF"
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
# CANDADO real (no solo el nombre): contenedor pg*, imagen supabase/postgres, sin puertos publicados, sin red host y
# sin montajes persistentes. Se prueba en test_232_candado.sh con contenedores que deben ser rechazados.
sh "$AQUI/candado_contenedor_desechable.sh" "$CT" >&2 || exit 2
i=1
until $PSA -d postgres -c "create database $DB template $PLANTILLA" >/dev/null 2>"$TMP/cb.err"; do
  [ "$i" -lt 8 ] || { cat "$TMP/cb.err" >&2; exit 1; }
  i=$((i + 1)); sleep 2
done
$PSA -d postgres -c "comment on database $DB is '$MARCA'" >/dev/null

q()  { $PSA -d "$DB" -t -A -F '|' -c "$1"; }
qf() { $PSA -d "$DB" -t -A -F '|' < "$1"; }

# auth.uid()/auth.role() a partir de los claims, como los deja PostgREST en la sesión (aquí se simulan con set_config).
$PSA -d "$DB" >/dev/null <<'SQL'
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
$$;
create or replace function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'))::text
$$;
SQL

# Fixture (se queda en la base desechable): un usuario por rol y una CxP COP de 1000 y una USD de 100.
$PSA -d "$DB" >/dev/null <<'SQL'
do $$
declare r text; v_id uuid; v_num text;
begin
  foreach r in array array['superadmin', 'gerencia', 'administracion', 'operaciones', 'venta'] loop
    v_id := md5('t232' || r)::uuid;
    insert into auth.users (id, email) values (v_id, 't232_' || r || '@prueba.test') on conflict do nothing;
    insert into public.usuarios (id, email, nombre, rol, activo, tenant)
      values (v_id, 't232_' || r || '@prueba.test', 'T232 ' || r, r::rol_usuario, true, 'mayorista') on conflict (id) do update set rol = excluded.rol, activo = true, tenant = 'mayorista';
  end loop;
  select numero_contrato into v_num from public.ventas order by numero_contrato limit 1;
  if v_num is null then
    insert into public.ventas (numero_contrato, cliente, tenant) values ('DTM-9232', 'T232', 'mayorista');
    v_num := 'DTM-9232';
  end if;
  insert into public.cuentas_por_pagar (numero_contrato, proveedor, tipo_proveedor, valor_total, moneda, tenant)
    values (v_num, 'T232 COP', 'hotel', 1000000, 'COP', 'mayorista'), (v_num, 'T232 USD', 'hotel', 100000, 'USD', 'mayorista');
end $$;
SQL
CXP_COP="$(q "select id from public.cuentas_por_pagar where proveedor = 'T232 COP'")"
CXP_USD="$(q "select id from public.cuentas_por_pagar where proveedor = 'T232 USD'")"
[ -n "$CXP_COP" ] && [ -n "$CXP_USD" ] || { echo "No se pudo crear el fixture (revisar columnas obligatorias de ventas/auth.users)." >&2; exit 1; }

# ── Intento de una sentencia bajo SET ROLE (permisos SQL, no una petición HTTP). Devuelve "sqlstate|mensaje corto" o "ok". ──
# $1 = rol (anon|authenticated|service_role)  $2 = sub (uuid o vacío)  $3 = sentencia
intento() {
  $PSA -d "$DB" -t -A <<SQL 2>&1 | tail -1
begin;
create or replace function pg_temp.intento(p_sql text) returns text language plpgsql as \$f\$
begin execute p_sql; return 'ok'; exception when others then return sqlstate || '|' || split_part(sqlerrm, E'\n', 1); end \$f\$;
grant execute on function pg_temp.intento(text) to public;
select set_config('request.jwt.claims', json_build_object('role', '$1', 'sub', nullif('$2', ''))::text, true);
set local role $1;
select pg_temp.intento(\$s\$$3\$s\$);
rollback;
SQL
}

# ── Regresión de roles autorizados: el mismo guion de Pagos/Conciliaciones/Retenciones para cada rol. ───────────
# Rutas reales: pagos/actions.ts (insert/select/delete en cxp_pagos), conciliaciones/actions.ts (insert + delete
# de pagos creados al conciliar), retenciones/actions.ts (insert/update base_gravable/delete en retenciones_cxp).
huella_autorizados() {
  for rol in superadmin gerencia administracion operaciones venta; do
    $PSA -d "$DB" -t -A -F '|' <<SQL | sed "s/^/$rol|/"
begin;
create or replace function pg_temp.intento(p_sql text) returns text language plpgsql as \$f\$
begin execute p_sql; return 'ok'; exception when others then return sqlstate || '|' || split_part(sqlerrm, E'\n', 1); end \$f\$;
grant execute on function pg_temp.intento(text) to public;
\o /dev/null
select set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', md5('t232$rol')::uuid)::text, true);
\o
set local role authenticated;
select 'pago_insert', pg_temp.intento('insert into public.cxp_pagos (cuenta_por_pagar_id, fecha, valor, trm) values ($CXP_COP, current_date, 1000, 1)');
select 'pago_select', (select count(*) from public.cxp_pagos where cuenta_por_pagar_id = $CXP_COP)::text;
select 'pago_delete', pg_temp.intento('delete from public.cxp_pagos where cuenta_por_pagar_id = $CXP_COP');
select 'pago_insert_usd', pg_temp.intento('insert into public.cxp_pagos (cuenta_por_pagar_id, fecha, valor, trm) values ($CXP_USD, current_date, 10, 3700)');
select 'pago_update', pg_temp.intento('update public.cxp_pagos set trm = 3800 where cuenta_por_pagar_id = $CXP_USD');
select 'ret_insert', pg_temp.intento('insert into public.retenciones_cxp (cuenta_por_pagar_id, valor, fecha_practica, mes_declaracion) values ($CXP_COP, 500, current_date, ''2026-01'')');
select 'ret_select', (select count(*) from public.retenciones_cxp where cuenta_por_pagar_id = $CXP_COP)::text;
select 'ret_update_base', pg_temp.intento('update public.retenciones_cxp set base_gravable = 1 where cuenta_por_pagar_id = $CXP_COP');
select 'ret_delete', pg_temp.intento('delete from public.retenciones_cxp where cuenta_por_pagar_id = $CXP_COP');
rollback;
SQL
  done
}

# ═════════════ F1 · preflight ANTES ═════════════
qf "$APP/supabase/scripts/preflight_232_revocar_escritura_anon_cxp.sql" > "$TMP/pre.out" 2> "$TMP/pre.err" || { cat "$TMP/pre.err" >&2; fallo "F1.0 el preflight no se ejecuta"; }
N_PRE="$(wc -l < "$TMP/pre.out" | tr -d ' ')"
[ "$N_PRE" -ge 30 ] && ok "F1.1 preflight devuelve una sola tabla integral ($N_PRE filas)" || fallo "F1.1 preflight devolvió $N_PRE filas"
grep -q '|FALLA$' "$TMP/pre.out" && { grep '|FALLA$' "$TMP/pre.out"; fallo "F1.2 preflight con FALLA"; } || ok "F1.2 preflight sin FALLA"
ANON_SI="$(grep -c '^anon puede .*|si|' "$TMP/pre.out" || true)"
[ "$ANON_SI" -ge 1 ] && ok "F1.3 antes de la 232 anon conserva $ANON_SI privilegios de escritura (el hallazgo se reproduce)" || fallo "F1.3 anon no tiene privilegios de escritura antes de la 232: el hallazgo no se reproduce en este esquema"

# ═════════════ F2 · permisos SQL de anon ANTES (SET ROLE) ═════════════
R="$(intento anon '' "insert into public.cxp_pagos (cuenta_por_pagar_id, fecha, valor, trm) values ($CXP_COP, current_date, 1, 1)")"
echo "      anon INSERT antes: $R"
printf '%s' "$R" | grep -qi 'permission denied' && fallo "F2.1 anon ya era rechazado por privilegio antes de la 232" || ok "F2.1 anon INSERT NO es rechazado por privilegio (llega a RLS/trigger): $R"
R="$($PSA -d "$DB" -t -A <<SQL 2>&1 | tail -1
begin; set local role anon; select set_config('request.jwt.claims','{"role":"anon"}',true);
truncate table public.retenciones_cxp;
select 'truncate_ok';
rollback;
SQL
)"
[ "$R" = "truncate_ok" ] && ok "F2.2 antes de la 232 anon puede TRUNCATE retenciones_cxp (sin RLS ni trigger de fila: el hueco real; se revierte en ROLLBACK)" || fallo "F2.2 anon no pudo TRUNCATE antes ($R)"

# ═════════════ F3 · regresión autorizados ANTES ═════════════
huella_autorizados > "$TMP/A.out"
[ "$(wc -l < "$TMP/A.out" | tr -d ' ')" -ge 45 ] && ok "F3.1 regresión de 5 roles ejecutada ($(wc -l < "$TMP/A.out" | tr -d ' ') resultados)" || fallo "F3.1 regresión incompleta"
grep -q '^administracion|pago_insert|ok' "$TMP/A.out" && ok "F3.2 administracion inserta pagos" || fallo "F3.2 administracion no inserta pagos: $(grep "^administracion" "$TMP/A.out" | head -3)"
grep -q '^operaciones|pago_insert|ok' "$TMP/A.out" && ok "F3.3 operaciones inserta pagos (Pagos)" || fallo "F3.3 operaciones no inserta pagos"
grep -q '^venta|pago_insert|42501' "$TMP/A.out" && ok "F3.4 venta rechazada por RLS (sin cambio esperado)" || fallo "F3.4 venta inesperado: $(grep '^venta|pago_insert' "$TMP/A.out")"

# conteos y policies antes
q "select (select count(*) from public.cxp_pagos), (select count(*) from public.retenciones_cxp), (select count(*) from public.cuentas_por_pagar)" > "$TMP/cnt_antes"
q "select md5(string_agg(tablename || policyname || cmd || coalesce(qual,'') || coalesce(with_check,''), ',' order by tablename, policyname)) from pg_policies where tablename in ('cxp_pagos','retenciones_cxp')" > "$TMP/pol_antes"
q "select md5(string_agg(c.relname || g.tgname || g.tgenabled::text, ',' order by c.relname, g.tgname)) from pg_trigger g join pg_class c on c.oid = g.tgrelid where not g.tgisinternal and c.relname in ('cxp_pagos','retenciones_cxp')" > "$TMP/trg_antes"

# ═════════════ F4 · aplicar la 232 por la RUTA MANUAL EXACTA del dueño ═════════════
MANUAL="$APP/supabase/scripts/aplicar_manual_232_revocar_escritura_anon_cxp.sql"
MIGRACION="$APP/supabase/migrations/20260601000232_revocar_escritura_anon_cxp.sql"
{ printf 'begin;\n\n'; cat "$MIGRACION"; printf '\ncommit;\n'; } > "$TMP/esperado_manual.sql"
if tail -c "$(wc -c < "$TMP/esperado_manual.sql")" "$MANUAL" | cmp -s - "$TMP/esperado_manual.sql"; then ok "F4.0 el cuerpo de la ruta manual es byte a byte la migración 232 envuelta en begin/commit"; else fallo "F4.0 la ruta manual difiere de la migración"; fi
[ "$(grep -c "^begin;$" "$MANUAL")" -ge 1 ] && [ "$(grep -c "^commit;$" "$MANUAL")" = 1 ] || fallo "F4.0b la ruta manual debe tener un único commit;"
# Se envía ENTERO como UNA sola consulta (-c), igual que el editor SQL: una falla deja la transacción abortada y el commit final revierte.
if $PSA -d "$DB" -c "$(cat "$MANUAL")" > "$TMP/mig.out" 2>&1; then ok "F4 la 232 se aplica por la ruta manual (una sola consulta begin..commit)"; else cat "$TMP/mig.out" >&2; fallo "F4 la ruta manual falló"; fi

# ═════════════ F5 · postcheck ═════════════
qf "$APP/supabase/scripts/postcheck_232_revocar_escritura_anon_cxp.sql" > "$TMP/post.out" 2> "$TMP/post.err" || { cat "$TMP/post.err" >&2; fallo "F5.0 el postcheck no se ejecuta"; }
grep -q '|FALLA$' "$TMP/post.out" && { grep '|FALLA$' "$TMP/post.out"; fallo "F5.1 postcheck con FALLA"; } || ok "F5.1 postcheck sin FALLA ($(grep -c '|OK$' "$TMP/post.out") OK)"
[ "$(grep -c '^anon puede .*|no|no|OK$' "$TMP/post.out")" = 8 ] && ok "F5.2 los 8 controles de anon dan 'no'" || fallo "F5.2 controles de anon: $(grep '^anon' "$TMP/post.out")"

# ═════════════ F6 · permisos SQL de anon DESPUÉS (SET ROLE) ═════════════
for s in \
  "insert into public.cxp_pagos (cuenta_por_pagar_id, fecha, valor, trm) values ($CXP_COP, current_date, 1, 1)" \
  "update public.cxp_pagos set valor = 1" \
  "delete from public.cxp_pagos" \
  "truncate table public.cxp_pagos" \
  "insert into public.retenciones_cxp (cuenta_por_pagar_id, valor, fecha_practica, mes_declaracion) values ($CXP_COP, 1, current_date, '2026-01')" \
  "update public.retenciones_cxp set valor = 1" \
  "delete from public.retenciones_cxp" \
  "truncate table public.retenciones_cxp"; do
  R="$(intento anon '' "$s")"
  printf '%s' "$R" | grep -q '^42501|permission denied for table' && ok "F6 anon rechazado por privilegio: ${s%% (*}" || fallo "F6 anon NO rechazado por privilegio: ${s%% (*} -> $R"
done
R="$(intento anon '00000000-0000-0000-0000-000000000001' "insert into public.cxp_pagos (cuenta_por_pagar_id, fecha, valor, trm) values ($CXP_COP, current_date, 1, 1)")"
printf '%s' "$R" | grep -q '^42501|permission denied for table' && ok "F6 anon con sub falso también rechazado por privilegio" || fallo "F6 anon con sub: $R"

# ═════════════ F7 · misma regresión DESPUÉS ═════════════
huella_autorizados > "$TMP/B.out"
if diff "$TMP/A.out" "$TMP/B.out" > "$TMP/ab.diff"; then ok "F7 regresión de authenticated idéntica antes y después ($(wc -l < "$TMP/B.out" | tr -d ' ') resultados)"; else cat "$TMP/ab.diff"; fallo "F7 la 232 cambió el comportamiento de roles autorizados"; fi

# ═════════════ F8 · service_role y guarda 228 ═════════════
R="$(intento service_role '' "insert into public.cxp_pagos (cuenta_por_pagar_id, fecha, valor, trm) values ($CXP_COP, current_date, 1000, 1)")"
[ "$R" = ok ] && ok "F8.1 service_role inserta pagos" || fallo "F8.1 service_role: $R"
R="$(intento service_role '' "insert into public.cxp_pagos (cuenta_por_pagar_id, fecha, valor, trm) values ($CXP_COP, current_date, 2000000, 1)")"
printf '%s' "$R" | grep -q '^Z9601' && ok "F8.2 la guarda de saldo (228) sigue activa: Z9601" || fallo "F8.2 guarda 228: $R"
R="$(intento service_role '' "insert into public.cxp_pagos (cuenta_por_pagar_id, fecha, valor, trm) values ($CXP_COP, current_date, 0, 1)")"
printf '%s' "$R" | grep -q '^Z9604' && ok "F8.3 importe no positivo: Z9604" || fallo "F8.3 Z9604: $R"

# ═════════════ F9 · sin cambios de datos, policies ni triggers ═════════════
[ "$(q "select (select count(*) from public.cxp_pagos), (select count(*) from public.retenciones_cxp), (select count(*) from public.cuentas_por_pagar)")" = "$(cat "$TMP/cnt_antes")" ] && ok "F9.1 conteos de filas intactos" || fallo "F9.1 conteos cambiaron"
[ "$(q "select md5(string_agg(tablename || policyname || cmd || coalesce(qual,'') || coalesce(with_check,''), ',' order by tablename, policyname)) from pg_policies where tablename in ('cxp_pagos','retenciones_cxp')")" = "$(cat "$TMP/pol_antes")" ] && ok "F9.2 policies idénticas" || fallo "F9.2 policies cambiaron"
[ "$(q "select md5(string_agg(c.relname || g.tgname || g.tgenabled::text, ',' order by c.relname, g.tgname)) from pg_trigger g join pg_class c on c.oid = g.tgrelid where not g.tgisinternal and c.relname in ('cxp_pagos','retenciones_cxp')")" = "$(cat "$TMP/trg_antes")" ] && ok "F9.3 triggers idénticos" || fallo "F9.3 triggers cambiaron"

# ═════════════ F11 · rollback e idempotencia (antes de F10, que ensucia ACL a propósito) ═════════════
$PSA -d "$DB" < "$APP/supabase/scripts/rollback_232_revocar_escritura_anon_cxp.sql" >/dev/null 2>&1 && ok "F11.1 rollback se ejecuta" || fallo "F11.1 rollback falló"
qf "$APP/supabase/scripts/postcheck_232_revocar_escritura_anon_cxp.sql" | grep -c '^anon puede .*|si|no|FALLA$' | grep -qx 8 && ok "F11.2 tras el rollback anon recupera los 8 privilegios (postcheck los marca FALLA)" || fallo "F11.2 rollback no restauró"
$PSA -d "$DB" -1 < "$APP/supabase/migrations/20260601000232_revocar_escritura_anon_cxp.sql" >/dev/null 2>&1 && ok "F11.3 la 232 se reaplica tras el rollback" || fallo "F11.3 reaplicar falló"
$PSA -d "$DB" -c "$(cat "$MANUAL")" >/dev/null 2>&1 && ok "F11.4 la 232 es idempotente por la ruta manual (segunda aplicación)" || fallo "F11.4 no idempotente"

# ═════════════ F10 · INSERT heredado de PUBLIC: la aplicación ABORTA y REVIERTE AMBOS REVOKE ═════════════
# Precondición realista: anon con los 8 privilegios (default privileges de Supabase) y PUBLIC con INSERT sobre cxp_pagos.
anon_privs() { q "select (select count(*) from (values ('public.cxp_pagos'),('public.retenciones_cxp')) t(x), (values ('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE')) p(y) where case when y in ('INSERT','UPDATE') then has_any_column_privilege('anon', x, y) else has_table_privilege('anon', x, y) end)"; }
tx_abiertas() { q "select count(*) from pg_stat_activity where datname = '$DB' and pid <> pg_backend_pid() and state like 'idle in transaction%'"; }
preparar_public() {
  $PSA -d "$DB" -c "grant insert, update, delete, truncate on table public.cxp_pagos, public.retenciones_cxp to anon" >/dev/null
  $PSA -d "$DB" -c "grant insert on table public.cxp_pagos to public" >/dev/null
}
verificar_aborto() { # $1 = etiqueta  $2 = archivo con la salida del intento
  grep -q '232: anon conserva INSERT sobre public.cxp_pagos' "$2" && ok "$1.a aborta con mensaje claro: $(grep -o '232: anon conserva[^(]*' "$2" | head -1)" || fallo "$1.a abortó con otro mensaje: $(tail -2 "$2")"
  [ "$(anon_privs)" = 8 ] && ok "$1.b AMBOS revoke revertidos: anon conserva los 8 privilegios en las dos tablas" || fallo "$1.b quedó a medias: anon tiene $(anon_privs) de 8"
  [ "$(q "select has_table_privilege('authenticated','public.cxp_pagos','INSERT') and has_table_privilege('authenticated','public.retenciones_cxp','DELETE')")" = t ] && ok "$1.c authenticated intacto" || fallo "$1.c authenticated alterado"
  [ "$(tx_abiertas)" = 0 ] && ok "$1.d sin transacción abierta tras el fallo" || fallo "$1.d quedó una transacción abierta"
}
preparar_public
[ "$(anon_privs)" = 8 ] || fallo "F10.0 la precondición no se cumplió"
if $PSA -d "$DB" -c "$(cat "$MANUAL")" > "$TMP/mig_manual_fail.out" 2>&1; then fallo "F10 la ruta manual NO abortó con INSERT heredado de PUBLIC"; else verificar_aborto "F10 ruta manual" "$TMP/mig_manual_fail.out"; fi
# El postcheck detecta el estado resultante como lo vería el dueño: los controles de anon dan 'si' y FALLA.
qf "$APP/supabase/scripts/postcheck_232_revocar_escritura_anon_cxp.sql" | grep -q '^anon puede insert en public.cxp_pagos|si|no|FALLA$' && ok "F10.e el postcheck marca FALLA tras el aborto (el dueño se detiene y diagnostica)" || fallo "F10.e el postcheck no marcó FALLA"
# Mismo escenario con el runner (psql -1).
preparar_public
if $PSA -d "$DB" -1 < "$MIGRACION" > "$TMP/mig_runner_fail.out" 2>&1; then fallo "F10 el runner NO abortó con INSERT heredado de PUBLIC"; else verificar_aborto "F10 runner" "$TMP/mig_runner_fail.out"; fi
$PSA -d "$DB" -c "revoke insert on table public.cxp_pagos from public" >/dev/null

echo "──────────────────────────────────────"
echo "Resultado: $OKS OK, $FALLOS FALLO"
[ "$FALLOS" -eq 0 ]
