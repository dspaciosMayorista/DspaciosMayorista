#!/bin/sh
# ──────────────────────────────────────────────────────────────────
# ROLLBACK · migración 205 — SOLO base LOCAL DESECHABLE en Docker.
#
#   P   preflight sobre 201 sin 205: sin FALLA.
#   A   205 + postcheck: sin FALLA; filas legado con abono intactas.
#   S1  SIN datos nuevos: el rollback acotado se aplica; la FK sigue en
#       RESTRICT y borrar una comisión con abonos sigue fallando (el abono
#       se conserva); la 205 se reaplica y el postcheck vuelve a pasar.
#   S2  CON datos nuevos (base explícita / por valor / NETO marcada, cada uno
#       por separado): el rollback SE NIEGA y no cambia nada.
#
# Uso:  sh test_205_rollback.sh [contenedor] [plantilla_201]   (desde dspacios-travel/)
# ──────────────────────────────────────────────────────────────────
set -eu
CT="${1:-pg201_review}"
PLANTILLA="${2:-e201}"
DB=c38_rb_205
export MSYS_NO_PATHCONV=1
SQL="docker exec -i -e PGPASSWORD=postgres $CT psql -h 127.0.0.1 -U supabase_admin -X -q -t -A -d $DB"
FALLOS=0
ok()    { echo "OK    $1"; }
fallo() { echo "FALLO $1"; FALLOS=$((FALLOS + 1)); }
trap 'docker exec -e PGPASSWORD=postgres $CT psql -h 127.0.0.1 -U supabase_admin -d postgres -qc "drop database if exists $DB" >/dev/null 2>&1 || true' EXIT

docker exec -e PGPASSWORD=postgres "$CT" psql -h 127.0.0.1 -U supabase_admin -d postgres -qc "drop database if exists $DB" >/dev/null
n=0; until docker exec -e PGPASSWORD=postgres "$CT" psql -h 127.0.0.1 -U supabase_admin -d postgres -qc "create database $DB template $PLANTILLA" >/dev/null 2>&1; do
  n=$((n + 1)); [ $n -ge 12 ] && { echo "No se pudo clonar $PLANTILLA"; exit 2; }; sleep 5
done
for f in supabase/migrations/20260601000205_comisiones_b2b_integridad.sql supabase/scripts/rollback_205_comisiones_b2b_integridad.sql \
         supabase/scripts/preflight_205_comisiones_b2b.sql supabase/scripts/postcheck_205_comisiones_b2b.sql; do
  docker cp "$f" "$CT":/tmp/"$(basename "$f")"
done
M205=/tmp/20260601000205_comisiones_b2b_integridad.sql
RB=/tmp/rollback_205_comisiones_b2b_integridad.sql
estado() { $SQL -c "select
  (select count(*) from pg_trigger where tgname in ('trg_aliados_b2b_proteger_abonos','trg_comision_b2b_pagos_guardas','trg_aliados_b2b_neto_no_borrar','trg_aliados_b2b_neto_sin_segunda'))
  || '/' || (select count(*) from pg_proc where proname in ('registrar_comision_b2b_reserva','registrar_comision_b2b_manual'))
  || '/' || (select count(*) from pg_policy where polrelid = 'public.aliados_b2b'::regclass)
  || '/' || (select confdeltype::text from pg_constraint where conname = 'comision_b2b_pagos_aliado_b2b_id_fkey')
  || '/' || (select count(*) from public.comision_b2b_pagos)"; }

# ── P ──
PRE=$($SQL -f /tmp/preflight_205_comisiones_b2b.sql)
if echo "$PRE" | grep -q "|FALLA|"; then fallo "P preflight: $(echo "$PRE" | grep FALLA)"; else ok "P preflight sobre 201 sin 205: sin FALLA ($(echo "$PRE" | grep -c '|OK|') OK)"; fi

# Datos del código viejo: dos comisiones, una con abono.
$SQL -c "insert into public.ventas (numero_contrato, cliente, tenant, precio_venta) values ('DTM-9501', 'C', 'mayorista', 1000000);
  insert into public.aliados_b2b (id, numero_contrato, tenant, aliado, precio_venta, base_comision, pct_comision, estado)
  values (9505001, 'DTM-9501', 'mayorista', 'L1', 1000000, 1000000, 0.0833, 'pendiente'),
         (9505002, 'DTM-9501', 'mayorista', 'L2', 1000000, 0, 0.1, 'pendiente');
  insert into public.comision_b2b_pagos (aliado_b2b_id, fecha, valor, tenant) values (9505001, current_date, 40000, 'mayorista');" >/dev/null

# ── A ──
$SQL -v ON_ERROR_STOP=1 -f $M205 >/dev/null 2>&1
POST=$($SQL -f /tmp/postcheck_205_comisiones_b2b.sql)
if echo "$POST" | grep -q "|FALLA|"; then fallo "A postcheck: $(echo "$POST" | grep FALLA)"; \
else ok "A 205 + postcheck: sin FALLA; $(echo "$POST" | grep 'semántica 205' | sed 's/.*: /filas nuevas = /')"; fi
[ "$(estado)" = "4/2/5/r/1" ] && ok "A estado con 205: triggers 4, funciones de alta 2, policies 5, FK r, abonos 1" || fallo "A estado $(estado)"

# ── S1 ──
if $SQL -v ON_ERROR_STOP=1 -f $RB >/dev/null 2>/tmp/rb1.err; then ok "S1 sin datos nuevos: el rollback acotado se aplica"; else fallo "S1 rollback falló: $(cat /tmp/rb1.err)"; fi
[ "$(estado)" = "0/0/1/r/1" ] && ok "S1 tras rollback: sin triggers ni funciones de alta, policy de 116, FK SIGUE en RESTRICT, abono intacto" || fallo "S1 estado $(estado)"
if $SQL -c "delete from public.aliados_b2b where id = 9505001" >/dev/null 2>/tmp/rb1b.err; then fallo "S1 se pudo borrar una comisión con abono"; \
else grep -q "foreign key" /tmp/rb1b.err && [ "$($SQL -c 'select count(*) from public.comision_b2b_pagos')" = 1 ] \
  && ok "S1 con el código viejo, borrar una comisión con abono sigue fallando (FK) y el abono se conserva" || fallo "S1 borrado: $(cat /tmp/rb1b.err)"; fi
$SQL -v ON_ERROR_STOP=1 -f $M205 >/dev/null 2>&1 && POST2=$($SQL -f /tmp/postcheck_205_comisiones_b2b.sql) \
  && ! echo "$POST2" | grep -q "|FALLA|" && ok "S1 la 205 se reaplica y el postcheck vuelve a pasar" || fallo "S1 reaplicar: $POST2"

# ── S2 ──
for variante in "base_explicita=true|insert into public.aliados_b2b (id, numero_contrato, tenant, aliado, precio_venta, base_comision, base_explicita, pct_comision) values (9505009, 'DTM-9501', 'mayorista', 'N', 1000000, 0, true, 0.1)" \
                "comision_valor|insert into public.aliados_b2b (id, numero_contrato, tenant, aliado, precio_venta, base_comision, comision_valor, pct_comision) values (9505009, 'DTM-9501', 'mayorista', 'N', 4000000, 3250000, 300000, 0.0923)" \
                "NETO marcada|insert into public.aliados_b2b (id, numero_contrato, tenant, aliado, precio_venta, base_comision, pct_comision, estado, descontada_en_precio) values (9505009, 'DTM-9501', 'mayorista', 'N', 1000000, 800000, 0.1, 'pagada', true)"; do
  nombre="${variante%%|*}"; insert="${variante#*|}"
  $SQL -c "$insert" >/dev/null
  ANTES=$(estado)
  if $SQL -v ON_ERROR_STOP=1 -f $RB >/dev/null 2>/tmp/rb2.err; then fallo "S2 [$nombre] el rollback se aplicó con datos nuevos";
  elif grep -q "NO SEGURO" /tmp/rb2.err && [ "$(estado)" = "$ANTES" ] && [ "$ANTES" = "4/2/5/r/1" ]; then ok "S2 [$nombre] el rollback se NIEGA y no cambia nada";
  else fallo "S2 [$nombre] $(cat /tmp/rb2.err) antes=$ANTES después=$(estado)"; fi
  $SQL -c "delete from public.aliados_b2b where id = 9505009" >/dev/null
done

if [ "$FALLOS" = 0 ]; then echo "TODO OK"; else echo "FALLOS: $FALLOS"; exit 1; fi
