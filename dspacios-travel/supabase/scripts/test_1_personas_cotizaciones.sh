#!/bin/sh
# #1 · personas de TODA cotización en el CRM (migración 308). Corre las dos pruebas de recorrido REAL (acciones de la app → PostgREST → PostgreSQL) sobre bases
# desechables creadas desde una plantilla de esquema. NUNCA contra una base real; el contenedor y la plantilla deben ser locales.
# Uso (desde dspacios-travel/):  sh supabase/scripts/test_1_personas_cotizaciones.sh <contenedor_pg> <plantilla> [con308|sin308]
#   - La plantilla debe traer hasta la 306 (si no, aplica 303..306 antes: ver ESQUEMA_PREVIO).
#   - `sin308` mide la línea base (código y esquema actuales de main): las pruebas que cubren los huecos DEBEN fallar.
set -eu
CT="${1:?contenedor}"; PLANTILLA="${2:?plantilla}"; MODO="${3:-con308}"
M=supabase/migrations
ESQUEMA_PREVIO="$M/20260601000303_hotel_categoria_descripcion.sql $M/20260601000304_contrato_resumen_precios.sql $M/20260601000305_recobro_comision_reserva.sql $M/20260601000306_cotizacion_clave_envio.sql"
if [ "$MODO" = "con308" ]; then EXTRA="$M/20260601000308_personas_cotizacion_fuentes.sql"; else EXTRA=""; fi
# Las DOS suites corren siempre (cada una limpia su base y su PostgREST al terminar) y el estado final es distinto de 0 si CUALQUIERA falla (F3 de la auditoría).
RC=0
# shellcheck disable=SC2086
PG_REACT=1 sh supabase/scripts/test_pg_local.sh "$CT" "$PLANTILLA" PG901 pruebas/personasCotizaciones1.pg.ts $ESQUEMA_PREVIO $EXTRA || RC=1
# shellcheck disable=SC2086
PG_REACT=1 sh supabase/scripts/test_pg_local.sh "$CT" "$PLANTILLA" PG902 pruebas/personasCotizaciones1Carrito.pg.ts $ESQUEMA_PREVIO $EXTRA || RC=1
[ "$RC" = 0 ] && echo "#1: las dos suites pasaron (estado 0)" || echo "#1: al menos una suite FALLÓ (estado 1)" >&2
exit "$RC"
