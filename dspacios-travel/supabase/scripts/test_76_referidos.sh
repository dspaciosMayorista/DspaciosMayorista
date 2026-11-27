#!/bin/sh
# #76 · Referidos (migración 341) + #78 (340). Corre el recorrido REAL (acciones del CRM y de aprobación B2B, lectura de servidor y la reversa financiera real → PostgREST → PostgreSQL) sobre una base
# desechable creada desde una plantilla con la cadena hasta la 326 (las migraciones 340 y 341 se aplican aquí). NUNCA contra una base real; el contenedor y la plantilla deben ser locales.
# Uso (desde dspacios-travel/):  sh supabase/scripts/test_76_referidos.sh <contenedor_pg> <plantilla>
set -eu
CT="${1:?contenedor}"; PLANTILLA="${2:?plantilla}"
M=supabase/migrations
PG_REACT=1 sh supabase/scripts/test_pg_local.sh "$CT" "$PLANTILLA" PG76 pruebas/referidos76.pg.ts "$M/20260601000340_aviso_cotizacion_publica.sql" "$M/20260601000341_referidos.sql" "$M/20260601000342_registro_b2b_codigo_referido.sql"
