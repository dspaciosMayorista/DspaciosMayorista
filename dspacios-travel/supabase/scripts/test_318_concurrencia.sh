#!/usr/bin/env bash
# #98 — CONCURRENCIA real de la 318 con varias sesiones de psql a la vez, sobre una copia DESECHABLE del esquema real (plantilla 001-317; la 318 se aplica aquí).
#   · 8 aceptaciones simultáneas del MISMO contenido  → exactamente 1 fila (versión 1).
#   · 8 aceptaciones simultáneas de contenidos DISTINTOS → versiones 1..8 sin repetir ni saltar.
#   · 8 registros simultáneos de la MISMA imagen de firma → 1 sola fila vigente.
# Uso (desde dspacios-travel/):  bash supabase/scripts/test_318_concurrencia.sh <contenedor> <plantilla>     p. ej.  pgb2b plantillab2b
# ESTADO DE EVIDENCIA: escrito, NO ejecutado (Docker caído al preparar la entrega). Termina con «RESULTADO: TODO OK» solo si todas las fases corrieron y no hubo FALLO.
set -u -o pipefail
export MSYS_NO_PATHCONV=1
CT="${1:-pgb2b}"; PL="${2:-plantillab2b}"; DB=t318conc
A=(docker exec -e PGPASSWORD=postgres "$CT" psql -h 127.0.0.1 -U supabase_admin -X -q -At -P pager=off)
FALLOS=0; FASES=0
f() { echo "FALLO: $1"; FALLOS=$((FALLOS+1)); }
ok() { FASES=$((FASES+1)); }
M=supabase/migrations/20260601000318_cuenta_cobro_firma_aceptacion.sql
"${A[@]}" -d postgres -c "drop database if exists $DB with (force)" -c "create database $DB template $PL" >/dev/null 2>&1 || { echo "RESULTADO: FALLO — no se pudo crear la base"; exit 2; }
Q=("${A[@]}" -d "$DB")
docker exec -i -e PGPASSWORD=postgres "$CT" psql -h 127.0.0.1 -U supabase_admin -X -q -v ON_ERROR_STOP=1 -d "$DB" < "$M" >/dev/null 2>&1 && ok || { f "no se pudo aplicar la 318"; echo "RESULTADO: FALLO"; exit 2; }
AL="$("${Q[@]}" -c "insert into public.aliados (nombre) values ('Aliado concurrencia 318') returning id" | head -1)"
U="$("${Q[@]}" -c "select gen_random_uuid()")"
SHA="$(printf '1%.0s' $(seq 1 64))"
snap() { printf '{"v":1,"clave":"ab:77","aliado":{"id":%s},"n":%s}' "$AL" "$1"; }

echo "== 1 firma: 8 registros simultáneos de la misma imagen"
for i in $(seq 1 8); do "${Q[@]}" -c "select public.registrar_firma_aliado($AL, '$AL/c$i.png', '$SHA', 'image/png', 10, '$U')" >/dev/null 2>&1 & done; wait
N="$("${Q[@]}" -c "select count(*) || '/' || count(*) filter (where vigente) from public.aliado_firmas where aliado_id = $AL")"
[ "$N" = "1/1" ] && ok || f "firmas simultáneas: esperado 1/1, observado $N"

echo "== 2 aceptación: 8 simultáneas del MISMO contenido"
H="$(printf 'a%.0s' $(seq 1 64))"
for i in $(seq 1 8); do "${Q[@]}" -c "select public.aceptar_cuenta_cobro('ab:77', $AL, '$(snap 0)'::jsonb, '$H', '$U')" >/dev/null 2>&1 & done; wait
N="$("${Q[@]}" -c "select count(*) || '/' || min(version) from public.cuenta_cobro_aceptaciones where clave = 'ab:77'")"
[ "$N" = "1/1" ] && ok || f "mismo contenido: esperado 1/1, observado $N"

echo "== 3 aceptación: 8 simultáneas de contenidos DISTINTOS"
for i in $(seq 1 8); do HH="$(printf '%064d' "$i")"; "${Q[@]}" -c "select public.aceptar_cuenta_cobro('ab:77', $AL, '$(snap $i)'::jsonb, '$HH', '$U')" >/dev/null 2>&1 & done; wait
N="$("${Q[@]}" -c "select string_agg(version::text, ',' order by version) from public.cuenta_cobro_aceptaciones where clave = 'ab:77'")"
[ "$N" = "1,2,3,4,5,6,7,8,9" ] && ok || f "contenidos distintos: esperado 1..9 (la v1 de la fase 2 + 8), observado $N"

"${A[@]}" -d postgres -c "drop database if exists $DB with (force)" >/dev/null 2>&1
if [ "$FALLOS" -eq 0 ] && [ "$FASES" -eq 4 ]; then echo "RESULTADO: TODO OK ($FASES/4)"; exit 0; fi
echo "RESULTADO: FALLO ($FALLOS fallos, $FASES/4 fases)"; exit 1
