#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# BATERÍA #40 · CONVERSIÓN A UN SOLO CONTRATO — CAT. 4 (concurrencia REAL) y
# CAT. 10 (tooling: apply→rollback→reapply→postcheck) de la migración 164.
#
# Este script complementa a `test_164_conversion_battery.sql` (que cubre las
# categorías 1,2,3,5,6,7,8,9 en una sola sesión). Aquí hace falta DOS conexiones
# Postgres REALES y el ciclo de tooling, que una sola sesión no puede ejercitar:
#
#   ⚠️ CATEGORÍA 4 · CONCURRENCIA REAL DEL RPC `convertir_cotizacion_a_contrato`
#      Dos conexiones separadas convierten la MISMA cotización manual (congelada,
#      en el mínimo) AL MISMO TIEMPO. Como el RPC hace `select ... for update`
#      sobre la cotización y chequea idempotencia por `ventas.cotizacion_id`
#      (UNIQUE) ANTES de pedir el número, debe quedar EXACTAMENTE UNA venta y
#      ambas conexiones deben devolver el MISMO numero_contrato — nunca dos
#      contratos, nunca un número consumido dos veces.
#
#   ⚠️ CATEGORÍA 10 · TOOLING de la migración 164
#      Con la 164 REAL aplicada: rollback (borra sus objetos) → reapply (vuelve
#      a correr el archivo REAL) → postcheck (verifica que el esquema quedó
#      íntegro). Demuestra que la migración es limpiamente reversible y
#      re-aplicable, y que el postcheck la da por correcta tras re-aplicarla.
#
# PRECONDICIONES (base PostgreSQL DESECHABLE con las migraciones reales 1→164
# aplicadas — NO Supabase real, NO preview, NO la BD local persistente):
#   1. Docker con un contenedor postgres corriendo (p. ej. `pago164real`).
#   2. Las migraciones 1→163 + `20260601000164_condiciones_pago_componente.sql`
#      aplicadas (con su preflight/postcheck 53/53 OK).
#
# Uso:  supabase/scripts/test_164_conversion_concurrency.sh [contenedor] [bd] [user]
#       (valores por defecto: pago164real / postgres / postgres)
#
# ⚠️ En Windows Git Bash exportar MSYS_NO_PATHCONV=1 para docker/psql.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

CONT="${1:-pago164real}"
BD="${2:-postgres}"
USR="${3:-postgres}"
# En la imagen Supabase el superusuario que OWNA los objetos de las migraciones
# es `supabase_admin` (postgres NO es superuser). El rollback/reapply/postcheck
# (que hacen DROP/ALTER de esquema) deben correr como `supabase_admin`.
OWNER="${4:-supabase_admin}"
OPPASS="${5:-postgres}"
PSQL() { MSYS_NO_PATHCONV=1 docker exec -i "$CONT" psql -U "$USR" -d "$BD" -t -A -q "$@"; }
OPSQL() { MSYS_NO_PATHCONV=1 docker exec -e PGPASSWORD="$OPPASS" -i "$CONT" psql -U "$OWNER" -d "$BD" -v ON_ERROR_STOP=1 "$@"; }
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROLLBACK="$AQUI/rollback_164_condiciones_pago.sql"
MIGRATION="$AQUI/../migrations/20260601000164_condiciones_pago_componente.sql"
POSTCHECK="$AQUI/postcheck_164_condiciones_pago.sql"
FAILS=0
ok()   { echo "   OK: $1"; }
fail() { echo "   FALLÓ: $1"; FAILS=$((FAILS + 1)); }
ACTOR="aaaaaaaa-0000-0000-0000-000000000001"   # superadmin mayorista (seed de la batería)
extract_num() { tr -d ' \r\n'; }

# ── Comprobamos el andamiaje (¿está la 164 aplicada?). ──────────────────────
if [ "$(PSQL -c "select count(*) from pg_proc where proname='convertir_cotizacion_a_contrato';")" != "1" ]; then
  echo "   ERROR: el RPC convertir_cotizacion_a_contrato no está presente — ¿la 164 está aplicada en '$CONT'?"; exit 1
fi

# ═════════════════════════════════════════════════════════════════════════════
# CATEGORÍA 4 — CONCURRENCIA REAL: UNA cotización, DOS conexiones, UN contrato
# ═════════════════════════════════════════════════════════════════════════════
echo "== Cat.4: dos conexiones convierten la MISMA cotización AL MISMO TIEMPO"

# Limpia datos y siembra el fixture: cotización manual mayorista abierta con
# aéreo+hotel, congelada y en el mínimo (pago = exigido = 1.000.000).
PSQL -f - >/dev/null <<'SQL'
truncate table public.contrato_condiciones, public.contrato_items, public.contrato_pasajeros,
  public.aliados_b2b, public.abonos, public.cotizacion_pagos_previos,
  public.cotizacion_condiciones, public.cotizacion_servicios, public.cuentas_por_pagar,
  public.asiento_lineas, public.asientos_contables, public.ventas, public.cotizaciones
  cascade;
insert into auth.users (id, email, aud, role) values
  ('aaaaaaaa-0000-0000-0000-000000000001','adm@t','authenticated','authenticated')
  on conflict (id) do nothing;
insert into public.usuarios (id, email, nombre, rol, activo, tenant) values
  ('aaaaaaaa-0000-0000-0000-000000000001','adm@t','ADM','superadmin',true,'mayorista')
  on conflict (id) do update set rol=excluded.rol, activo=excluded.activo, tenant=excluded.tenant;
insert into public.proveedores (nombre, nit, tipo, ciudad, aplica_retencion, pct_retencion, clasificacion)
values ('PROV HOTEL RET', '900000001', 'hotel', 'Cartagena', true, 0.035, 'hotel') on conflict do nothing;
insert into public.cotizaciones
  (tenant, estado, tipo, cliente, cliente_documento, destino, fecha_salida, fecha_regreso,
   pax, precio_venta, moneda, asesor, payload, detalle)
values ('mayorista','abierta','manual','CLIENTE CONC','CC CONC','CARTAGENA','2026-10-01','2026-10-04',
  2, 2000000, 'COP', 'Asesor',
  jsonb_build_object('cliente',jsonb_build_object('nombres','Cliente','apellidos','Conc',
    'tipoDoc','CC','numeroDoc','9999','nacimiento','1990-01-01','telefono','300'),
    'tipoAsesor','interno','ninos',0,'tarifaNino',0,'recobro',0,'recobroAliado',0,
    'observaciones','conc'),
  '{}'::jsonb)
returning id as cot \gset
insert into public.cotizacion_servicios (cotizacion_id, orden, tipo_servicio, plataforma, nombre_servicio, proveedor, costo_neto)
values (:cot, 0, 'aereo', 'Avianca', 'VUELO BOG-CTG', NULL, 800000);
insert into public.cotizacion_servicios (cotizacion_id, orden, tipo_servicio, plataforma, nombre_servicio, proveedor, costo_neto)
values (:cot, 1, 'hotel', NULL, 'Hotel Test', 'PROV HOTEL RET', 700000);
select public.registrar_pago_previo(
  :cot, 1000000, 'COP', 1, 'Transferencia', 'REF-CONC', '2026-09-01',
  'aaaaaaaa-0000-0000-0000-000000000001', 'key-conc',
  jsonb_build_array(
    jsonb_build_object('orden',0,'tipo_componente','aereo_empaquetado','referencia_externa','Vuelo',
      'valor_componente',800000,'condicion_pago_tipo','sin_condicion','monto_exigido',0,'restriccion_comercial','normal'),
    jsonb_build_object('orden',1,'tipo_componente','hotel','referencia_externa','Hotel Test',
      'valor_componente',1200000,'condicion_pago_tipo','anticipo_saldo','condicion_pago_pct_aplicable',0.5,
      'condicion_pago_dias_saldo',30,'monto_exigido',1000000,'restriccion_comercial','normal')
  ),
  1000000, 50.0);
select :cot;
SQL
COT=$(PSQL -c "select id from public.cotizaciones where asesor='Asesor' order by id desc limit 1;")
echo "   cotización de prueba: id=$COT"

# Dos conexiones REALES, cada una en su propia transacción, con un pequeño
# retraso aleatorio para aumentar la probabilidad de solape real.
( PSQL -c "set role service_role; select public.convertir_cotizacion_a_contrato($COT,'$ACTOR');" | extract_num > /tmp/conc_conv_A.txt ) &
PID_A=$!
( PSQL -c "select pg_sleep(0.2); set role service_role; select public.convertir_cotizacion_a_contrato($COT,'$ACTOR');" | extract_num > /tmp/conc_conv_B.txt ) &
PID_B=$!
wait "$PID_A" "$PID_B"
RES_A=$(cat /tmp/conc_conv_A.txt)
RES_B=$(cat /tmp/conc_conv_B.txt)
echo "   conexión A -> $RES_A"
echo "   conexión B -> $RES_B"

NV=$(PSQL -c "select count(*) from public.ventas where cotizacion_id=$COT;")
echo "   ventas totales creadas para la cotización: $NV"

if [ "$NV" = "1" ] && [ -n "$RES_A" ] && [ "$RES_A" = "$RES_B" ]; then
  ok "concurrencia: UNA venta y ambas conexiones devolvieron el MISMO número ($RES_A) — el for update + UNIQUE cotizacion_id impiden el doble contrato"
else
  fail "concurrencia: se esperaba 1 venta y ambos devolviendo el mismo número; ventas=$NV A=$RES_A B=$RES_B"
fi

# Sanidad: hijas/abonos/CxP/asiento del contrato único, sin duplicar.
N_ABO=$(PSQL -c "select count(*) from public.abonos where numero_contrato='$RES_A';")
N_CXP=$(PSQL -c "select count(*) from public.cuentas_por_pagar where numero_contrato='$RES_A';")
N_PAY_APL=$(PSQL -c "select count(*) from public.cotizacion_pagos_previos where cotizacion_id=$COT and estado='aplicado';")
if [ "$N_ABO" = "1" ] && [ "$N_CXP" = "2" ] && [ "$N_PAY_APL" = "1" ]; then
  ok "sanidad del contrato único: 1 abono, 2 CxP, 1 pago aplicado (sin retransferir)"
else
  fail "sanidad: abonos=$N_ABO (esp 1) CxP=$N_CXP (esp 2) pagos aplicados=$N_PAY_APL (esp 1)"
fi

# ═════════════════════════════════════════════════════════════════════════════
# CATEGORÍA 10 — TOOLING: rollback → reapply → postcheck de la migración 164
# ═════════════════════════════════════════════════════════════════════════════
echo "== Cat.10: ciclo rollback → reapply → postcheck de la 164 REAL"

# La batería/concurrencia dejaron datos; los limpiamos antes del ciclo de tooling
# (el rollback solo borra OBJETOS de esquema de la 164, no los datos de otras
# tablas — pero dejamos limpio igual para medir con postcheck sobre base vacía).
PSQL -c "truncate table public.contrato_condiciones, public.contrato_items, public.contrato_pasajeros,
  public.aliados_b2b, public.abonos, public.cotizacion_pagos_previos,
  public.cotizacion_condiciones, public.cotizacion_servicios, public.cuentas_por_pagar,
  public.asiento_lineas, public.asientos_contables, public.ventas, public.cotizaciones cascade;" >/dev/null

echo "   1) rollback_164_condiciones_pago.sql"
if OPSQL -f - < "$ROLLBACK" >/tmp/cat10_rollback.log 2>&1; then
  ok "rollback ejecutado sin error"
else
  fail "rollback falló"; cat /tmp/cat10_rollback.log
fi
GONE=$(PSQL -c "select count(*) from pg_proc where proname='convertir_cotizacion_a_contrato';")
if [ "$GONE" = "0" ]; then
  ok "tras el rollback ya no existe el RPC convertir_cotizacion_a_contrato"
else
  fail "el RPC sigue presente ($GONE) tras el rollback"
fi

echo "   2) reapply del archivo REAL 20260601000164_condiciones_pago_componente.sql"
if OPSQL -f - < "$MIGRATION" >/tmp/cat10_reapply.log 2>&1; then
  ok "migración 164 re-aplicada sin error"
else
  fail "reapply falló"; cat /tmp/cat10_reapply.log
fi

echo "   3) postcheck_164_condiciones_pago.sql (debe dar todo OK / 0 fugas)"
# El postcheck referencia `i.indispartial` (válido en el Supabase real). En
# algunas imágenes postgres locales esa columna no existe y se verifica el mismo
# predicado con `(i.indpred is not null)` — intercambio de SOLO LECTURA equivalente,
# exclusivo del entorno de prueba local (NO se edita el postcheck versionado).
sed 's/\bi\.indispartial\b/(i.indpred is not null)/g' "$POSTCHECK" > /tmp/postcheck_164_env.sql
# Se pasa por stdin (`-f -`), igual que rollback/reapply: psql corre DENTRO del
# contenedor, donde no existe el /tmp del host.
if OPSQL -f - < /tmp/postcheck_164_env.sql >/tmp/cat10_postcheck.log 2>&1; then
  ok "postcheck tras reapply ejecutado sin error (ver /tmp/cat10_postcheck.log para el desglose)"
else
  fail "postcheck tras reapply falló"; cat /tmp/cat10_postcheck.log
fi

# Reconfirma la íntegra del esquema de la 164 tras el ciclo.
RPC_OK=$(PSQL -c "select count(*) from pg_proc where proname='convertir_cotizacion_a_contrato';")
UNIQ_OK=$(PSQL -c "select count(*) from pg_indexes where indexname='uq_pagos_previos_abono_id';")
if [ "$RPC_OK" = "1" ] && [ "$UNIQ_OK" = "1" ]; then
  ok "tras el reapply quedó el RPC y el UNIQUE parcial de abono_id"
else
  fail "esquema incompleto tras reapply: rpc=$RPC_OK uniq_abono=$UNIQ_OK"
fi

# ── Veredicto ───────────────────────────────────────────────────────────────
echo "═══════════════════════════════════════════════════════════════════════"
if [ "$FAILS" -eq 0 ]; then
  echo "CAT.4 (concurrencia real) y CAT.10 (tooling rollback→reapply→postcheck) PASARON."
else
  echo "$FAILS PRUEBA(S) FALLARON — ver detalle arriba."
  exit 1
fi
