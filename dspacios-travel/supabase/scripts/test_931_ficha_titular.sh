#!/bin/sh
# B2-11/B2-12a · lectura real por rol de titular/contacto de Cotizaciones (PostgREST → RLS → PostgreSQL) sobre una base desechable creada desde una plantilla local.
# Uso (desde dspacios-travel/):  sh supabase/scripts/test_931_ficha_titular.sh <contenedor_pg> <plantilla>   (p. ej. pgrevc rev_consolidada_base). NUNCA contra una base real.
set -eu
PG_REACT=1 sh supabase/scripts/test_pg_local.sh "${1:?contenedor}" "${2:?plantilla}" PG931 pruebas/fichaTitular931.rev2.pg.ts
