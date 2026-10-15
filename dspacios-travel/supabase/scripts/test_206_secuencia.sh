#!/bin/sh
# ──────────────────────────────────────────────────────────────────
# SECUENCIA · #30 contrato manual NETO: preflight → aplicar → postcheck →
# NETO real confirmado → rollback → datos intactos y 205 en verde.
# SOLO en un contenedor Docker PROPIO y desechable (nunca remoto).
#
# Uso:  sh test_206_secuencia.sh <base_desechable_con_205> [contenedor]
#   La base queda con la migración QUITADA (rollback) y sin los datos de prueba.
#   Requiere copiados en /tmp del contenedor: m206.sql (la migración 206), pre206.sql,
#   post206.sql, rb206.sql, t205.sql y post205.sql.
# ──────────────────────────────────────────────────────────────────
set -eu
DB="${1:-}"
CT="${2:-pg30_neto}"
if [ -z "$DB" ] || [ "$DB" = "postgres" ]; then echo "Indica una base desechable." >&2; exit 2; fi
if [ "${DENTRO_CONTENEDOR:-}" != 1 ]; then
  exec docker exec -i -e PGPASSWORD=postgres -e DENTRO_CONTENEDOR=1 "$CT" sh -s -- "$DB" "$CT" < "$0"
fi
PSQL="psql -h 127.0.0.1 -U supabase_admin -d $DB -X -q -t -A -v ON_ERROR_STOP=1"
FALLOS=0
ok()    { echo "OK    $1"; }
fallo() { echo "FALLO $1"; FALLOS=$((FALLOS + 1)); }
cuenta_ok() { $PSQL -F '|' -f "$1" | grep -c '|OK|' || true; }
cuenta_falla() { $PSQL -F '|' -f "$1" | grep -c '|FALLA|' || true; }

[ "$(cuenta_falla /tmp/pre206.sql)" = 0 ] && [ "$(cuenta_ok /tmp/pre206.sql)" = 4 ] && ok "S1 preflight 4/4 antes de aplicar" || fallo "S1 preflight: $($PSQL -F '|' -f /tmp/pre206.sql)"
$PSQL -1 -f /tmp/m206.sql >/dev/null 2>&1 && ok "S2 la migración aplica" || fallo "S2 aplicar"
[ "$(cuenta_ok /tmp/post206.sql)" = 4 ] && ok "S3 postcheck 4/4" || fallo "S3 postcheck: $($PSQL -F '|' -f /tmp/post206.sql)"
[ "$(cuenta_falla /tmp/pre206.sql)" = 1 ] && ok "S4 el preflight detecta la migración ya aplicada" || fallo "S4 preflight tras aplicar"

U=00000000-0000-0000-0000-000000034501
$PSQL -c "insert into auth.users (id, email) values ('$U', 's30@x.test');
          insert into public.usuarios (id, email, nombre, rol, activo, tenant) values ('$U', 's30@x.test', 'S30', 'superadmin', true, 'mayorista')
          on conflict (id) do update set rol = 'superadmin', activo = true, tenant = 'mayorista';
          insert into public.aliados (id, nombre, nit, tipo, pct_comision) values (9345, 'S30 Agencia', '9345', 'agencia', 0.10);
          insert into public.ventas (numero_contrato, cliente, tenant, precio_venta, impuesto, tipo_asesor, aliado_id, canal, estado)
          values ('DTM-9345', 'C', 'mayorista', 2000000, 400000, 'agencia', 9345, 'B2B', 'activo');" >/dev/null
$PSQL -c "select set_config('request.jwt.claims', '{\"sub\":\"$U\",\"role\":\"authenticated\"}', false); set role authenticated;
          select public.aplicar_neto_contrato_manual('DTM-9345', 9345, 160000);" >/dev/null && ok "S5 NETO real confirmado" || fallo "S5 NETO real"
ANTES=$($PSQL -c "select v.precio_venta::numeric(15,0)||'|'||v.comision_estado||'|'||b.precio_venta::numeric(15,0)||'|'||b.descontada_en_precio from public.ventas v join public.aliados_b2b b using (numero_contrato) where v.numero_contrato = 'DTM-9345'")

$PSQL -f /tmp/rb206.sql >/dev/null && ok "S6 rollback corre" || fallo "S6 rollback"
[ "$(cuenta_falla /tmp/pre206.sql)" = 0 ] && ok "S7 tras el rollback no queda ningún objeto (preflight 4/4)" || fallo "S7 objetos residuales"
DESPUES=$($PSQL -c "select v.precio_venta::numeric(15,0)||'|'||v.comision_estado||'|'||b.precio_venta::numeric(15,0)||'|'||b.descontada_en_precio from public.ventas v join public.aliados_b2b b using (numero_contrato) where v.numero_contrato = 'DTM-9345'")
[ "$ANTES" = "1840000|descontada|2000000|true" ] && [ "$ANTES" = "$DESPUES" ] && ok "S8 el NETO ya registrado queda intacto ($DESPUES)" || fallo "S8 antes=$ANTES despues=$DESPUES"
$PSQL -f /tmp/t205.sql | grep -q "TODO OK (135 casos)" && ok "S9 batería 205 tras el rollback: 135/135" || fallo "S9 batería 205"
[ "$(cuenta_ok /tmp/post205.sql)" -ge 14 ] && [ "$(cuenta_falla /tmp/post205.sql)" = 0 ] && ok "S10 postcheck 205 tras el rollback" || fallo "S10 postcheck 205"

$PSQL -c "set session_replication_role = replica;
          delete from public.aliados_b2b where numero_contrato = 'DTM-9345'; delete from public.ventas where numero_contrato = 'DTM-9345';
          delete from public.aliados where id = 9345; delete from public.usuarios where id = '$U'; delete from auth.users where id = '$U';" >/dev/null
if [ "$FALLOS" = 0 ]; then echo "TODO OK (10 pasos)"; else echo "FALLOS: $FALLOS"; exit 1; fi
