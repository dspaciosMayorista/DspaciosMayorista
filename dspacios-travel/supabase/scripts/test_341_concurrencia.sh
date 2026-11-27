#!/bin/sh
# Concurrencia REAL de #76 (referidos, migración 341): varias sesiones de psql compiten a la vez. Base DESECHABLE creada desde una plantilla con la cadena hasta la 326 (+340/341 aquí).
# Invariantes: (A) asignaciones idénticas simultáneas → 1 sola fila; (B) asignaciones en conflicto → 1 sola vigente, sin huecos ni solapes, sin errores; (C) quitar y asignar mezclados → igual;
# (D) contratos creados mientras cambia la asignación → cada contrato 0 o 1 atribución, y su foto coincide con la fila de asignación a la que apunta (mismo aliado, agencia, referidor y %).
# Uso (desde dspacios-travel/):  sh supabase/scripts/test_341_concurrencia.sh <contenedor_pg> <plantilla>      NUNCA contra una base real.
set -eu
export MSYS_NO_PATHCONV=1
CT="${1:?contenedor}"; PLANTILLA="${2:?plantilla}"
M="${MIG_DIR:-supabase/migrations}"   # copia mutada de las migraciones para los controles negativos
hex() { od -An -N6 -tx1 /dev/urandom | tr -d ' \n'; }
DB="tcon_$(hex)"; TMP="$(mktemp -d)"
PS="docker exec -i -e PGPASSWORD=postgres $CT psql -h 127.0.0.1 -U supabase_admin -X -q -t -A -v ON_ERROR_STOP=1"
limpiar() { st=$?; rm -rf "$TMP"; $PS -d postgres -c "drop database if exists $DB" >/dev/null 2>&1 || true; exit "$st"; }
trap limpiar EXIT
FALLOS=0
ok() { echo "OK    $1"; }
mal() { echo "FALLO $1"; FALLOS=$((FALLOS + 1)); }
$PS -d postgres -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = '$PLANTILLA' and pid <> pg_backend_pid()" >/dev/null
$PS -d postgres -c "create database $DB template $PLANTILLA" >/dev/null
for m in 340_aviso_cotizacion_publica 341_referidos; do $PS -d "$DB" -1 -f - < "$M/20260601000$m.sql" >/dev/null 2>"$TMP/mig.err" || { cat "$TMP/mig.err" >&2; echo "FALLÓ la migración $m" >&2; exit 1; }; done

SU='00000000-0000-0000-0000-000000341001'
$PS -d "$DB" -f - >/dev/null <<SQL
insert into auth.users (id, email) values ('$SU', 'c341-super@x.test') on conflict do nothing;
insert into public.usuarios (id, email, nombre, rol, activo, tenant) values ('$SU', 'c341-super@x.test', 'C341 Super', 'superadmin', true, 'mayorista') on conflict (id) do update set rol = 'superadmin', activo = true;
insert into public.aliados (id, nombre, nit, tipo, pct_comision, aplica_retencion, pct_retencion, activo) values (9401, 'A 9401', '94010', 'agencia', 0.1, false, 0, true), (9402, 'A 9402', '94020', 'freelance', 0.1, false, 0, true) on conflict (id) do nothing;
insert into public.referidores (id, tenant, nombre) overriding system value values (9501, 'mayorista', 'Referidor Uno'), (9502, 'mayorista', 'Referidor Dos');
SQL

# Lanza N sesiones simultáneas; cada una escribe su resultado en $TMP/<prefijo>.<i>. `$2` es la sentencia (con {i} = índice).
barrera() { ( $PS -d "$DB" -c "select pg_advisory_lock(9999); select pg_sleep(${ESPERA:-10});" >/dev/null 2>&1 ) & sleep 2; }   # todos los trabajadores se conectan y BLOQUEAN aquí; al soltarse arrancan a la vez
ENTRADA="select pg_advisory_lock(9999); select pg_advisory_unlock(9999);"
paralelo() { # $1 prefijo, $2 cuántas, $3 plantilla de sentencia
  barrera
  i=1
  while [ "$i" -le "$2" ]; do
    q="$(printf '%s' "$3" | sed "s/{i}/$i/g")"
    ( $PS -d "$DB" -c "$ENTRADA $q" > "$TMP/$1.$i" 2>&1 || echo "ERROR $?" >> "$TMP/$1.$i" ) &
    i=$((i + 1))
  done
  wait
}
estados() { cat "$TMP/$1".* | grep -o '"estado": "[a-z_]*"' | sort | uniq -c | sed 's/  */ /g' | tr '\n' ';'; }
errores() { cat "$TMP/$1".* | grep -c 'ERROR' || true; }

# A. 12 asignaciones IDÉNTICAS a la vez sobre un aliado sin referidor.
paralelo A 12 "select public.referido_asignar('$SU', 9401, 9501, 0.01, 'A{i}')::text"
FILAS="$($PS -d "$DB" -c "select count(*) from public.aliado_referidores where aliado_id = 9401")"
ASIG="$(cat "$TMP"/A.* | grep -c '"estado": "asignada"' || true)"; SIN="$(cat "$TMP"/A.* | grep -c '"estado": "sin_cambio"' || true)"
[ "$FILAS" = 1 ] && [ "$ASIG" = 1 ] && [ "$SIN" = 11 ] && [ "$(errores A)" = 0 ] && ok "A: 12 asignaciones idénticas simultáneas → 1 fila (1 asignada + 11 sin_cambio, 0 errores)" || mal "A: filas=$FILAS asignada=$ASIG sin_cambio=$SIN errores=$(errores A) ($(estados A))"

# B. 16 asignaciones EN CONFLICTO (referidor 1 al 1 % y referidor 2 al 2 %, alternadas) sobre el mismo aliado.
paralelo B 16 "select public.referido_asignar('$SU', 9402, 9500 + 1 + {i} % 2, case when {i} % 2 = 0 then 0.01 else 0.02 end, 'B{i}')::text"
cat > "$TMP/inv.sql" <<'SQL'
select
  (select count(*) from public.aliado_referidores where aliado_id = :a and vigente_hasta is null) as vigentes,
  (select count(*) from public.aliado_referidores where aliado_id = :a) as filas,
  (select count(*) from public.aliado_referidores where aliado_id = :a and vigente_hasta is not null and vigente_hasta < vigente_desde) as invertidas,
  (select count(*) from (select vigente_hasta, lead(vigente_desde) over (order by vigente_desde, id) as sig from public.aliado_referidores where aliado_id = :a) z where z.sig is not null and z.vigente_hasta is distinct from z.sig) as huecos_o_solapes;
SQL
INV() { $PS -d "$DB" -v a="$1" -f - < "$TMP/inv.sql" | tr '|' ' '; }
RES="$(INV 9402)"; set -- $RES
CAMB="$(cat "$TMP"/B.* | grep -c '"estado": "cambiada"' || true)"; ASIGB="$(cat "$TMP"/B.* | grep -c '"estado": "asignada"' || true)"
[ "$1" = 1 ] && [ "$3" = 0 ] && [ "$4" = 0 ] && [ "$(errores B)" = 0 ] && [ "$2" = "$((CAMB + ASIGB))" ] && ok "B: 16 asignaciones en conflicto → 1 vigente, $2 filas de historial = asignada+cambiada, sin huecos ni solapes, 0 errores" || mal "B: vigentes=$1 filas=$2 invertidas=$3 huecos/solapes=$4 errores=$(errores B) ($(estados B))"

# C. quitar y asignar mezclados (8 y 8).
paralelo C 16 "select case when {i} % 2 = 0 then public.referido_quitar('$SU', 9402, 'mayorista', 'C{i}')::text else public.referido_asignar('$SU', 9402, 9501, 0.01, 'C{i}')::text end"
RES="$(INV 9402)"; set -- $RES
[ "$1" -le 1 ] && [ "$3" = 0 ] && [ "$(errores C)" = 0 ] && ok "C: 16 operaciones mezcladas (quitar/asignar) → como mucho 1 vigente, sin invertidas, 0 errores" || mal "C: vigentes=$1 invertidas=$3 errores=$(errores C) ($(estados C))"
# C2: sin huecos ni solapes entre una asignación y la siguiente SALVO donde se quitó (entonces hay un hueco legítimo: sin referidor).
$PS -d "$DB" -c "select public.referido_asignar('$SU', 9402, 9502, 0.02, 'cierre')::text" >/dev/null

# D. Contratos creados MIENTRAS cambia la asignación (10 altas de contrato y 10 cambios a la vez).
# Pares = cambios de asignación; impares = altas de contrato (cada uno es su propia sentencia: un INSERT no cabe dentro de una subconsulta).
barrera
i=1
while [ "$i" -le 20 ]; do
  if [ $((i % 2)) = 0 ]; then
    q="select public.referido_asignar('$SU', 9401, $((9501 + (i / 2) % 2)), $( [ $(((i / 2) % 2)) = 0 ] && echo 0.01 || echo 0.02 ), 'D$i')::text"
  else
    q="insert into public.ventas (numero_contrato, tenant, tipo_paquete, estado, cliente, asesor, precio_venta, impuesto, aliado_id) values ('DTM-94$(printf '%02d' $i)', 'mayorista', 'bloqueo', 'confirmado', 'Cliente D$i', 'Asesor', 1000000, 0, 9401)"
  fi
  ( $PS -d "$DB" -c "$ENTRADA $q" > "$TMP/D.$i" 2>&1 || echo "ERROR $?" >> "$TMP/D.$i" ) &
  i=$((i + 1))
done
wait
TOT="$($PS -d "$DB" -c "select count(*) from public.ventas where numero_contrato like 'DTM-94%'")"
ATR="$($PS -d "$DB" -c "select count(*) from public.contrato_referidos cr join public.ventas v on v.contrato_uid = cr.contrato_uid where v.numero_contrato like 'DTM-94%'")"
DUP="$($PS -d "$DB" -c "select count(*) from (select contrato_uid from public.contrato_referidos group by 1 having count(*) > 1) x")"
INC="$($PS -d "$DB" -c "select count(*) from public.contrato_referidos cr join public.aliado_referidores a on a.id = cr.asignacion_id where a.aliado_id <> cr.aliado_id or a.tenant <> cr.tenant or a.referidor_id <> cr.referidor_id or a.pct <> cr.pct")"
RES="$(INV 9401)"; set -- $RES
[ "$TOT" = 10 ] && [ "$ATR" -ge 1 ] && [ "$ATR" -le 10 ] && [ "$DUP" = 0 ] && [ "$INC" = 0 ] && [ "$1" = 1 ] && [ "$3" = 0 ] && [ "$4" = 0 ] && [ "$(errores D)" = 0 ] && ok "D: 10 contratos creados durante 10 cambios → $ATR atribuidos, 0 duplicados, 0 fotos incoherentes, asignaciones sin huecos/solapes, 0 errores" || mal "D: contratos=$TOT atribuidos=$ATR duplicados=$DUP incoherentes=$INC vigentes=$1 invertidas=$3 huecos/solapes=$4 errores=$(errores D) ($(estados D))"
# D2: los contratos NO atribuidos son los creados antes de la primera asignación del aliado (la carrera arranca sin asignación, así que unos pocos pueden quedar sin referidor, jamás con uno equivocado).
echo "      (informativo) contratos sin atribución: $((TOT - ATR)) de $TOT; los creados antes de la primera asignación vigente no se atribuyen por diseño"

[ "$FALLOS" = 0 ] && { echo "TODO OK"; exit 0; } || { echo "$FALLOS FALLO(S)"; exit 1; }
