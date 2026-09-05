#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# B15 (ronda 6) — INTEGRACIÓN REAL de `consolidarReservasSillasPorBloqueo`
# contra el RPC `crear_pasajeros_contrato_multi` (migración 167).
#
# La prueba anterior enviaba `holdersMin` a MANO, así que no probaba la
# integración descrita: el piso lo decidía el test, no el helper. Aquí el
# payload de `p_reservas_sillas` lo GENERA el helper de producción
# (`_b15_gen_payload.ts`, que usa las funciones puras reales) y se pasa TAL
# CUAL al RPC de verdad. Se verifica que el número de sillas reservadas sea el
# de PERSONAS ÚNICAS CON SILLA — nunca la suma de pisos por ítem (que
# sobre-reservaba).
#
# Uso: bash supabase/scripts/pruebas/local-desde-cero.sh <db> <puerto>
#      bash supabase/scripts/test_b15_consolidacion_rpc.sh <db> <puerto>
# ═══════════════════════════════════════════════════════════════════════════
set -u
BD="${1:-dspacios_local}"
PUERTO="${2:-5432}"
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PSQL() { psql -p "$PUERTO" -d "$BD" -t -A -q "$@"; }
UID_TEST="44444444-4444-4444-4444-444444444444"
CLAIMS="select set_config('request.jwt.claims', json_build_object('sub','$UID_TEST')::text, false);"
FECHA="2027-05-01"
fail=0

PSQL -v ON_ERROR_STOP=1 -c "
insert into auth.users (id, email, raw_user_meta_data)
values ('$UID_TEST', 'b15-$(date +%s)@test.local', jsonb_build_object('rol','superadmin','nombre','B15'))
on conflict (id) do nothing;" >/dev/null

# Ejecuta UN escenario: crea fixtures, genera el payload REAL con el helper,
# llama al RPC y compara las sillas reservadas con lo esperado.
#   $1 = etiqueta · $2 = esperado · $3 = spec JSON (pasajeros/items/fechaRef con bloqueoId como marcador @BID@)
correr() {
  local etiqueta="$1" esperado="$2" spec_tpl="$3"
  local run="$(date +%s%N)-$RANDOM"
  local digitos="$(date +%s%N | tail -c 8)$RANDOM"; digitos="${digitos:0:8}"
  local contrato="DTM-15${digitos}"
  local bid
  bid=$(PSQL -v ON_ERROR_STOP=1 -c "insert into bloqueos_vuelo (record,aerolinea,ruta,fecha_ida,cupos_total) values ('B15-$run','AV','BOG-SMR','$FECHA',20) returning id;")
  PSQL -v ON_ERROR_STOP=1 -c "insert into sillas (bloqueo_id,numero_silla,estado) select $bid, g, 'disponible' from generate_series(1,20) g;" >/dev/null
  PSQL -v ON_ERROR_STOP=1 -c "insert into ventas (numero_contrato,tenant,cliente,fecha_salida,pax,precio_venta,estado,canal,tipo_paquete) values ('$contrato','mayorista','Cliente B15','$FECHA',4,100000,'pendiente','B2C','carrito');" >/dev/null

  local spec="${spec_tpl//@BID@/$bid}"
  local payload; payload=$(node --experimental-strip-types "$AQUI/_b15_gen_payload.ts" "$spec" 2>/dev/null)
  local pasajeros reservas
  pasajeros=$(node -e "process.stdout.write(JSON.stringify(JSON.parse(process.argv[1]).pasajeros))" "$payload")
  reservas=$(node -e "process.stdout.write(JSON.stringify(JSON.parse(process.argv[1]).reservas))" "$payload")

  PSQL -c "$CLAIMS select 1 from crear_pasajeros_contrato_multi('$contrato', '$pasajeros'::jsonb, '$reservas'::jsonb, '$UID_TEST');" >/dev/null 2>/tmp/b15_rpc_err.txt
  local sillas; sillas=$(PSQL -c "select count(*) from sillas where numero_contrato='$contrato' and estado in ('en_plazo','confirmada');")
  local hmin; hmin=$(node -e "const r=JSON.parse(process.argv[1]).reservas; process.stdout.write(String(r[0]?r[0].holdersMin:'-'))" "$payload")
  if [ "$sillas" = "$esperado" ]; then
    echo "  PASS  $etiqueta -> helper holdersMin=$hmin, sillas reservadas=$sillas (esperado $esperado)"
  else
    echo "  FAIL  $etiqueta -> helper holdersMin=$hmin, sillas reservadas=$sillas (esperado $esperado)"
    cat /tmp/b15_rpc_err.txt
    fail=1
  fi
}

echo "== B15: la salida REAL del helper alimenta el RPC de verdad =="
# 1) mismos pasajeros en dos ítems del mismo bloqueo -> 2 sillas (no 4)
correr "mismos pasajeros [1,2]+[1,2]" 2 \
  '{"pasajeros":[{"nombre":"A1","fechaNacimiento":"1990-01-01"},{"nombre":"A2","fechaNacimiento":"1991-01-01"}],"items":[{"bloqueoId":@BID@,"posicionesGlobal":[1,2]},{"bloqueoId":@BID@,"posicionesGlobal":[1,2]}],"fechaRef":"2027-05-01"}'
# 2) solapamiento parcial [1,2]+[2,3] -> 3 sillas
correr "solapamiento [1,2]+[2,3]" 3 \
  '{"pasajeros":[{"nombre":"A1","fechaNacimiento":"1990-01-01"},{"nombre":"A2","fechaNacimiento":"1991-01-01"},{"nombre":"A3","fechaNacimiento":"1992-01-01"}],"items":[{"bloqueoId":@BID@,"posicionesGlobal":[1,2]},{"bloqueoId":@BID@,"posicionesGlobal":[2,3]}],"fechaRef":"2027-05-01"}'
# 3) grupos disjuntos [1,2]+[3,4] -> 4 sillas
correr "disjuntos [1,2]+[3,4]" 4 \
  '{"pasajeros":[{"nombre":"A1","fechaNacimiento":"1990-01-01"},{"nombre":"A2","fechaNacimiento":"1991-01-01"},{"nombre":"A3","fechaNacimiento":"1992-01-01"},{"nombre":"A4","fechaNacimiento":"1993-01-01"}],"items":[{"bloqueoId":@BID@,"posicionesGlobal":[1,2]},{"bloqueoId":@BID@,"posicionesGlobal":[3,4]}],"fechaRef":"2027-05-01"}'
# 4) INF compartido (pos 2) no ocupa silla -> 1 silla (solo el adulto pos 1)
correr "INF no ocupa silla [1,2]+[1,2]" 1 \
  '{"pasajeros":[{"nombre":"Adulto","fechaNacimiento":"1990-01-01"},{"nombre":"Bebe","fechaNacimiento":"2026-06-01","responsableOrden":1}],"items":[{"bloqueoId":@BID@,"posicionesGlobal":[1,2]},{"bloqueoId":@BID@,"posicionesGlobal":[1,2]}],"fechaRef":"2027-05-01"}'

# Limpieza de fixtures de esta corrida.
PSQL -v ON_ERROR_STOP=1 -c "delete from sillas where bloqueo_id in (select id from bloqueos_vuelo where record like 'B15-%');" >/dev/null
PSQL -v ON_ERROR_STOP=1 -c "delete from contrato_pasajeros where numero_contrato like 'DTM-15%';" >/dev/null
PSQL -v ON_ERROR_STOP=1 -c "delete from ventas where numero_contrato like 'DTM-15%';" >/dev/null
PSQL -v ON_ERROR_STOP=1 -c "delete from bloqueos_vuelo where record like 'B15-%';" >/dev/null

if [ "$fail" = "0" ]; then echo "== RESULTADO: PASS =="; else echo "== RESULTADO: FAIL =="; fi
exit $fail
