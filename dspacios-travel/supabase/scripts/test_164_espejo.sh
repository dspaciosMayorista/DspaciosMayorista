#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Guard de ESPEJO de la migración 164 (corrección R1).
#
# test_164_schema.sql levanta las funciones de dinero como ESPEJO manual de la
# migración 164 (no puede aplicar la 164 completa: requiere todo el esquema
# previo 1→163 + RLS + Supabase). Para eliminar el riesgo de una copia manual
# DIVERGENTE, este guard compara el `prosrc` VIVO de cada función espejada en el
# esquema de prueba contra el texto REAL de la propia migración 164 y FALLA si
# no es una subcadena exacta.
#
# Es una prueba de IGUALDAD/hash, no de la migración real aplicada: NO declara
# haber ejecutado la 164 completa. Precondición: test_164_schema.sql aplicado
# en el contenedor `pago164test`.
# ─────────────────────────────────────────────────────────────────────────────
set -u
PSQL() { MSYS_NO_PATHCONV=1 docker exec pago164test psql -U postgres -d test -t -A -q "$@"; }
MIG="supabase/migrations/20260601000164_condiciones_pago_componente.sql"

if [ ! -f "$MIG" ]; then echo "FALTA la migración: $MIG"; exit 2; fi

# $1 = proname, $2 = identity args exactos
prosrc_de() {
  PSQL -c "select p.prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace
           where n.nspname='public' and p.proname='$1'
             and pg_get_function_identity_arguments(p.oid)='$2';"
}

# $1 = proname (etiqueta) ; $2 = prosrc de la BD
esta_en_migracion() {
  local nombre="$1" body="$2"
  if node -e '
    const fs = require("fs");
    const body = fs.readFileSync(0, "utf8").trim();
    const mig = fs.readFileSync(process.argv[1], "utf8");
    process.exit(mig.includes(body) ? 0 : 1);
  ' "$MIG" <<<"$body"; then
    echo "  OK   $nombre: el cuerpo espejado está VERBATIM en la migración 164"
  else
    echo "  FAIL $nombre: el cuerpo espejado DIFIERE de la migración 164"
    return 1
  fi
}

fail=0
echo "Guard de espejo de la migración 164 (R1) contra: $MIG"
B=$(prosrc_de registrar_pago_previo 'bigint, numeric, text, numeric, text, text, date, uuid, text, jsonb, numeric, numeric'); esta_en_migracion 'registrar_pago_previo' "$B" || fail=1
B=$(prosrc_de anular_pago_previo 'bigint, uuid, text'); esta_en_migracion 'anular_pago_previo' "$B" || fail=1
B=$(prosrc_de _huella_pago_previo 'bigint, numeric, text, text, text, date'); esta_en_migracion '_huella_pago_previo' "$B" || fail=1

echo ""
if [ "$fail" = "0" ]; then echo "ESPEJO: OK — las funciones probadas son idénticas a la migración 164"; else echo "ESPEJO: DIVERGENCIA DETECTADA"; exit 1; fi
