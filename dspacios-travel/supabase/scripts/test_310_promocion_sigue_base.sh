#!/usr/bin/env bash
# Prueba de la 310 (#125) en una base DESECHABLE clonada de una plantilla local que ya trae la 300/301.
# No toca ninguna otra base: crea `$DB_NAME`, corre preflight → 310 → postcheck → pruebas → rollback → preflight, y la borra.
# Uso (desde dspacios-travel/): MSYS_NO_PATHCONV=1 bash supabase/scripts/test_310_promocion_sigue_base.sh
set -euo pipefail
C="${PG_CONTAINER:-pg304}"; T="${TEMPLATE_DB:-plantilla304}"; DB="${DB_NAME:-t310_desechable}"
ADM() { docker exec -i -e PGPASSWORD=postgres "$C" psql -v ON_ERROR_STOP=1 -U supabase_admin -At "$@"; }
SQL() { docker exec -i -e PGPASSWORD=postgres "$C" psql -v ON_ERROR_STOP=1 -U supabase_admin -d "$DB" "$@"; }
MIG="supabase/migrations/20260601000310_promocion_sigue_base_nino_gratis.sql"
S="supabase/scripts"
trap 'ADM -d postgres -c "drop database if exists \"$DB\" with (force)" >/dev/null 2>&1 || true' EXIT
ADM -d postgres -c "drop database if exists \"$DB\" with (force)" >/dev/null
ADM -d postgres -c "create database \"$DB\" template \"$T\"" >/dev/null
echo "== PREFLIGHT (antes)";   SQL < "$S/preflight_310_promocion_sigue_base.sql"
echo "== MIGRACIÓN 310";       SQL < "$MIG" >/dev/null && echo aplicada
echo "== POSTCHECK";           SQL < "$S/postcheck_310_promocion_sigue_base.sql"
echo "== PRUEBAS";             SQL < "$S/test_310_promocion_sigue_base.sql"
echo "== MIGRACIÓN 310 por segunda vez (debe ABORTAR sin cambiar nada: su guarda exige la firma de 4 parámetros)"
if SQL < "$MIG" >/dev/null 2>&1; then echo "ERROR: la 310 se aplicó dos veces"; exit 1; else echo "aborta como se espera"; fi
echo "== ROLLBACK";            SQL < "$S/rollback_310_promocion_sigue_base.sql" >/dev/null && echo revertida
echo "== PREFLIGHT (después del rollback, debe volver a decir LISTA PARA 310)"; SQL < "$S/preflight_310_promocion_sigue_base.sql" | tail -3
