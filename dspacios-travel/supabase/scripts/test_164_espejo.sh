#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Guard de ESPEJO de la migración 164 (R1, Commit 7 — cierre del falso positivo).
#
# test_164_schema.sql levanta las funciones de dinero como ESPEJO manual de la
# migración 164 (no puede aplicar la 164 completa: requiere todo el esquema
# previo 1→163 + RLS + Supabase). Para eliminar el riesgo de una copia manual
# DIVERGENTE, este guard compara el `prosrc` VIVO de cada función espejada en el
# esquema de prueba contra el texto REAL de la propia migración 164 y FALLA si
# no coincide EXACTAMENTE (tras trim).
#
# ⚠️ Corrección R1 (Commit 7): la versión anterior delegaba la comparación a
# `mig.includes(body)`. Como `"".includes("")` es `true` en JavaScript, una
# extracción vacía o fallida (prosrc NULL/"" en la BD, o el bloque no
# encontrado en la migración) reportaba "OK" sin comparar nada de verdad —
# falso positivo. Ahora TODA la decisión vive en un módulo puro compartido
# (`supabase/scripts/lib/espejo164.mjs`) que valida explícitamente, en orden:
#   1. la función esperada existe (por nombre) — si no, FALLA;
#   2. existe EXACTAMENTE con la firma (identity args) exacta — si no, FALLA;
#   3. `prosrc` no es NULL ni vacío tras trim — si lo es, FALLA;
#   4. hay EXACTAMENTE una fila con esa firma (ni cero ni overload) — si no, FALLA;
#   5. el bloque `$$...$$` de `create or replace function public.<nombre>(`
#      se pudo extraer del texto REAL de la migración — si no, FALLA;
#   6. el cuerpo extraído de la migración es IGUAL (tras trim) al `prosrc`
#      vivo — si difiere, FALLA.
# Ese mismo módulo tiene controles negativos reproducibles para cada uno de
# estos 6 modos en `pruebas/espejo164.test.ts` (sin Docker ni base de datos),
# así que un cambio futuro en la lógica de comparación no puede reintroducir
# el falso positivo sin romper esas pruebas.
#
# Es una prueba de IGUALDAD, no de la migración real aplicada: NO declara
# haber ejecutado la 164 completa. Precondición: test_164_schema.sql aplicado
# en el contenedor `pago164test`.
# ─────────────────────────────────────────────────────────────────────────────
set -u
PSQL() { MSYS_NO_PATHCONV=1 docker exec pago164test psql -U postgres -d test -t -A -q "$@"; }
MIG="supabase/migrations/20260601000164_condiciones_pago_componente.sql"
CLI="supabase/scripts/lib/verificar_espejo_cli.mjs"

if [ ! -f "$MIG" ]; then echo "FALTA la migración: $MIG"; exit 2; fi
if [ ! -f "$CLI" ]; then echo "FALTA el verificador: $CLI (supabase/scripts/lib/verificar_espejo_cli.mjs)"; exit 2; fi

# $1 = proname, $2 = identity args exactos.
# Consulta el conteo con la firma EXACTA y, aparte, el conteo con CUALQUIER
# firma (para poder distinguir "no existe" de "existe con otra firma" en el
# mensaje). El prosrc se lee SOLO si cnt=1, y se pasa por STDIN al CLI —
# nunca como campo separado por `|` de `psql -A`, que se rompería si el
# cuerpo de la función contiene el operador de concatenación `||`.
verificar_funcion() {
  local nombre="$1" args="$2"
  local cnt cnt_cualquier_firma prosrc

  cnt=$(PSQL -c "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
           where n.nspname='public' and p.proname='$nombre'
             and pg_get_function_identity_arguments(p.oid)='$args';" | tr -d '[:space:]')
  cnt_cualquier_firma=$(PSQL -c "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
           where n.nspname='public' and p.proname='$nombre';" | tr -d '[:space:]')

  if [ "$cnt" = "1" ]; then
    prosrc=$(PSQL -c "select p.prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace
             where n.nspname='public' and p.proname='$nombre'
               and pg_get_function_identity_arguments(p.oid)='$args' limit 1;")
  else
    prosrc=""
  fi

  printf '%s' "$prosrc" | node "$CLI" "$nombre" "$args" "$cnt" "$cnt_cualquier_firma" "$MIG"
}

fail=0
echo "Guard de espejo de la migración 164 (R1) contra: $MIG"
verificar_funcion registrar_pago_previo 'bigint, numeric, text, numeric, text, text, date, uuid, text, jsonb, numeric, numeric' || fail=1
verificar_funcion anular_pago_previo 'bigint, uuid, text' || fail=1
verificar_funcion _huella_pago_previo 'bigint, numeric, text, text, text, date' || fail=1

echo ""
if [ "$fail" = "0" ]; then
  echo "ESPEJO: OK — las funciones probadas son idénticas a la migración 164"
else
  echo "ESPEJO: DIVERGENCIA DETECTADA (o precondición de comparación no cumplida — ver FAIL arriba)"
  exit 1
fi
