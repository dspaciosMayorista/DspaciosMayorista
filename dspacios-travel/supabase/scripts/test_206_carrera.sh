#!/bin/sh
# ──────────────────────────────────────────────────────────────────
# CARRERAS · #30 contrato manual NETO (migración 206, 20260601000206_contrato_manual_neto.sql).
# DOS SESIONES REALES, SOLO base LOCAL DESECHABLE dentro de un contenedor
# Docker propio (nunca remota). Datos DTM-934x, borrados al final.
#
# Uso:  sh test_206_carrera.sh <base_desechable> [contenedor]
#
#   N1  A aplica NETO (sin confirmar) · B aplica NETO al MISMO contrato
#       → B espera y se niega: una sola fila de comisión, un solo descuento.
#   N2  A aplica NETO (sin confirmar) · B (administración) cambia el precio
#       → B espera y el trigger lo rechaza: el NETO queda coherente.
#   N3  A (administración) sube el precio de un PVP (sin confirmar) · B aplica
#       NETO con la comisión que vio antes → B espera y se niega: la comisión
#       ya no es la que vio el asesor; el contrato queda en PVP.
# ──────────────────────────────────────────────────────────────────
set -eu
DB="${1:-}"
CT="${2:-pg30_neto}"
if [ -z "$DB" ] || [ "$DB" = "postgres" ]; then
  echo "Indica una base desechable distinta de 'postgres'." >&2; exit 2
fi
if [ "${DENTRO_CONTENEDOR:-}" != 1 ]; then
  exec docker exec -i -e PGPASSWORD=postgres -e DENTRO_CONTENEDOR=1 "$CT" sh -s -- "$DB" "$CT" < "$0"
fi
PSQL="psql -h 127.0.0.1 -U supabase_admin -d $DB -X -q -t -A -v ON_ERROR_STOP=1"
TMP="$(mktemp -d)"
FALLOS=0
ok()    { echo "OK    $1"; }
fallo() { echo "FALLO $1"; FALLOS=$((FALLOS + 1)); }

SUPER=00000000-0000-0000-0000-000000034001
ADMIN=00000000-0000-0000-0000-000000034002
como() { echo "select set_config('request.jwt.claims', '{\"sub\":\"$1\",\"role\":\"authenticated\"}', false); set role authenticated;"; }

limpiar() {
  $PSQL -c "set session_replication_role = replica;
            delete from public.aliados_b2b where numero_contrato in ('DTM-9341','DTM-9342','DTM-9343');
            delete from public.ventas where numero_contrato in ('DTM-9341','DTM-9342','DTM-9343');
            delete from public.aliados where id = 9341;
            delete from public.usuarios where id in ('$SUPER','$ADMIN');
            delete from auth.users where id in ('$SUPER','$ADMIN');" >/dev/null
}
sembrar() {
  limpiar
  $PSQL -c "insert into auth.users (id, email) values ('$SUPER', 'c30-super@x.test'), ('$ADMIN', 'c30-admin@x.test');
            insert into public.usuarios (id, email, nombre, rol, activo, tenant) values
              ('$SUPER', 'c30-super@x.test', 'C30 Super', 'superadmin', true, 'mayorista'),
              ('$ADMIN', 'c30-admin@x.test', 'C30 Admin', 'administracion', true, 'mayorista')
            on conflict (id) do update set rol = excluded.rol, activo = true, tenant = 'mayorista';
            insert into public.aliados (id, nombre, nit, tipo, pct_comision) values (9341, 'C30 Agencia', '9341', 'agencia', 0.10);
            insert into public.ventas (numero_contrato, cliente, tenant, precio_venta, impuesto, tipo_asesor, aliado_id, canal, estado) values
              ('DTM-9341', 'C', 'mayorista', 2000000, 400000, 'agencia', 9341, 'B2B', 'activo'),
              ('DTM-9342', 'C', 'mayorista', 2000000, 400000, 'agencia', 9341, 'B2B', 'activo'),
              ('DTM-9343', 'C', 'mayorista', 2000000, 400000, 'agencia', 9341, 'B2B', 'activo');" >/dev/null
}
estado() {
  $PSQL -c "select v.precio_venta::numeric(15,0) || '|' || coalesce(v.comision_estado, '-') || '|' ||
                   (select count(*) from public.aliados_b2b b where b.numero_contrato = v.numero_contrato)
              from public.ventas v where v.numero_contrato = '$1'"
}

sembrar

# ── N1 ──
( $PSQL -c "$(como $SUPER) begin; select public.aplicar_neto_contrato_manual('DTM-9341', 9341, 160000); select pg_sleep(3); commit;" >"$TMP/a1" 2>&1 ) &
sleep 1
if $PSQL -c "$(como $ADMIN) select public.aplicar_neto_contrato_manual('DTM-9341', 9341, 160000);" >"$TMP/b1" 2>&1; then B1=paso; else B1=fallo; fi
wait
E1=$(estado DTM-9341)
if [ "$B1" = fallo ] && grep -q "ya tiene modalidad" "$TMP/b1" && ! grep -qi error "$TMP/a1" && [ "$E1" = "1840000|descontada|1" ]; then
  ok "N1 dos NETO simultáneos del mismo contrato: uno entra, el otro se niega; un descuento y una fila"
else fallo "N1 ($B1) $(cat "$TMP/a1" "$TMP/b1") estado=$E1"; fi

# ── N2 ──
( $PSQL -c "$(como $SUPER) begin; select public.aplicar_neto_contrato_manual('DTM-9342', 9341, 160000); select pg_sleep(3); commit;" >"$TMP/a2" 2>&1 ) &
sleep 1
if $PSQL -c "$(como $ADMIN) update public.ventas set precio_venta = 2000000 where numero_contrato = 'DTM-9342';" >"$TMP/b2" 2>&1; then B2=paso; else B2=fallo; fi
wait
E2=$(estado DTM-9342)
if [ "$B2" = fallo ] && grep -q "vendido en NETO" "$TMP/b2" && [ "$E2" = "1840000|descontada|1" ]; then
  ok "N2 cambiar el precio mientras se aplica NETO: espera y se rechaza; el NETO queda coherente"
else fallo "N2 ($B2) $(cat "$TMP/b2") estado=$E2"; fi

# ── N3 ──
( $PSQL -c "$(como $ADMIN) begin; update public.ventas set precio_venta = 2100000 where numero_contrato = 'DTM-9343'; select pg_sleep(3); commit;" >"$TMP/a3" 2>&1 ) &
sleep 1
if $PSQL -c "$(como $SUPER) select public.aplicar_neto_contrato_manual('DTM-9343', 9341, 160000);" >"$TMP/b3" 2>&1; then B3=paso; else B3=fallo; fi
wait
E3=$(estado DTM-9343)
if [ "$B3" = fallo ] && grep -q "no coincide con la calculada (170000)" "$TMP/b3" && [ "$E3" = "2100000|-|0" ]; then
  ok "N3 aplicar NETO mientras cambia el PVP: espera, ve el precio nuevo y se niega; el contrato queda en PVP"
else fallo "N3 ($B3) $(cat "$TMP/b3") estado=$E3"; fi

limpiar
rm -rf "$TMP"
if [ "$FALLOS" = 0 ]; then echo "TODO OK (3 carreras)"; else echo "FALLOS: $FALLOS"; exit 1; fi
