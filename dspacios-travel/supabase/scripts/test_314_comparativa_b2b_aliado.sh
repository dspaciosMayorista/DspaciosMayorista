#!/usr/bin/env bash
# Prueba de la migración 314 (#35) contra Postgres REAL, en un contenedor propio y desechable (postgres:17 plano, esquema mínimo de test_314_stubs.sql).
# Recorre: baseline = cuerpo de la 211 (el hueco abierto) -> preflight -> 314 -> postcheck -> idempotencia -> grants -> rollback -> 314 de nuevo.
# No toca ningún otro contenedor ni base. Uso: bash supabase/scripts/test_314_comparativa_b2b_aliado.sh   (desde la carpeta dspacios-travel)
#
# GARANTÍAS DEL LANZADOR (corrección B3): cada fase conserva el código de salida de psql (sin tuberías que lo enmascaren), el contador de fallos vive en el
# shell PRINCIPAL (nunca dentro de una subshell de pipeline) y «RESULTADO: TODO OK» solo se imprime si se ejecutaron TODAS las fases esperadas, ninguna
# terminó con error de SQL y ninguna fila de control quedó en FALLO/REVISAR. La salida de cada fase se imprime completa.
# Variables de prueba del propio lanzador (ver test_314_launcher_mutaciones.sh): B2B314_DIR_SCRIPTS y B2B314_MIGRACION permiten apuntar a copias MUTADAS.
set -u -o pipefail
export MSYS_NO_PATHCONV=1
CT="${CT:-pg_b2b314}"
D="${B2B314_DIR_SCRIPTS:-supabase/scripts}"
M="${B2B314_MIGRACION:-supabase/migrations/20260601000314_comparativa_b2b_aliado_obligatorio.sql}"
FASES_ESPERADAS=14
FASES_OK=0
FALLOS=0
cleanup() { docker rm -f "$CT" >/dev/null 2>&1; }
trap cleanup EXIT
cleanup
docker run -d --name "$CT" -e POSTGRES_PASSWORD=postgres postgres:17 >/dev/null || { echo "RESULTADO: FALLO — no se pudo crear el contenedor"; exit 2; }
for i in $(seq 1 60); do docker exec "$CT" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
sleep 2

# Ejecuta un archivo SQL y devuelve 0 solo si psql terminó bien. Imprime TODO lo que psql dijo.
sql_archivo() { # etiqueta archivo [opciones de psql…]
  local etiqueta="$1" archivo="$2"; shift 2
  if [ ! -r "$archivo" ]; then echo "FALLO: $etiqueta — no se puede leer $archivo"; FALLOS=$((FALLOS+1)); return 1; fi
  local salida rc
  salida="$(docker exec -i "$CT" psql -U postgres -X -q -v ON_ERROR_STOP=1 "$@" -f - < "$archivo" 2>&1)"; rc=$?
  [ -n "$salida" ] && printf '%s\n' "$salida"
  if [ "$rc" -ne 0 ]; then echo "FALLO: $etiqueta — psql terminó con código $rc"; FALLOS=$((FALLOS+1)); return 1; fi
  return 0
}
sql_comando() { # etiqueta comando
  local salida rc
  salida="$(docker exec -i "$CT" psql -U postgres -X -q -v ON_ERROR_STOP=1 -c "$2" 2>&1)"; rc=$?
  [ -n "$salida" ] && printf '%s\n' "$salida"
  if [ "$rc" -ne 0 ]; then echo "FALLO: $1 — psql terminó con código $rc"; FALLOS=$((FALLOS+1)); return 1; fi
  return 0
}
# Una fase de CONTROLES (preflight / postcheck / casos): el SQL debe terminar bien, mostrar filas con estado y ninguna puede estar en FALLO/REVISAR.
fase_controles() { # etiqueta archivo [opciones de psql…]
  local etiqueta="$1" archivo="$2"; shift 2
  local salida rc
  if [ ! -r "$archivo" ]; then echo "FALLO: $etiqueta — no se puede leer $archivo"; FALLOS=$((FALLOS+1)); return 1; fi
  salida="$(docker exec -i "$CT" psql -U postgres -X -q -v ON_ERROR_STOP=1 -P pager=off "$@" -f - < "$archivo" 2>&1)"; rc=$?
  [ -n "$salida" ] && printf '%s\n' "$salida"
  if [ "$rc" -ne 0 ]; then echo "FALLO: $etiqueta — psql terminó con código $rc"; FALLOS=$((FALLOS+1)); return 1; fi
  if ! printf '%s\n' "$salida" | grep -Eq '\|[[:space:]]*(OK|INFO)[[:space:]]*$'; then echo "FALLO: $etiqueta — no devolvió ninguna fila de control con estado OK/INFO"; FALLOS=$((FALLOS+1)); return 1; fi
  if printf '%s\n' "$salida" | grep -Eq '\|[[:space:]]*(FALLO|REVISAR)[[:space:]]*$'; then echo "FALLO: $etiqueta — hay controles en FALLO/REVISAR"; FALLOS=$((FALLOS+1)); return 1; fi
  return 0
}
ok() { FASES_OK=$((FASES_OK+1)); }
limpiar_datos() { sql_comando "limpiar filas de prueba" "delete from public.cotizacion_opciones; delete from public.cotizacion_servicios; delete from public.cotizacion_comparativa_eventos; delete from public.cotizaciones where id > 2;" >/dev/null; }
terminar() {
  if [ "$FALLOS" -eq 0 ] && [ "$FASES_OK" -eq "$FASES_ESPERADAS" ]; then echo "RESULTADO: TODO OK ($FASES_OK/$FASES_ESPERADAS fases)"; exit 0; fi
  echo "RESULTADO: FALLO — fallos=$FALLOS, fases completadas=$FASES_OK/$FASES_ESPERADAS"; exit 1
}
abortar() { echo "RESULTADO: FALLO — $1 (fases completadas=$FASES_OK/$FASES_ESPERADAS)"; exit 2; }

echo "== 0a. esquema mínimo =="
sql_archivo "esquema mínimo" "$D/test_314_stubs.sql" && ok || abortar "no se pudo preparar el esquema mínimo"
echo "== 0b. baseline (cuerpo de la 211, vía el rollback) =="
sql_archivo "baseline 211" "$D/rollback_314_comparativa_b2b_aliado.sql" && ok || abortar "no se pudo instalar el baseline"
sql_comando "grants del baseline" "revoke all on function public.crear_cotizacion_comparativa(uuid, jsonb, jsonb, jsonb, bigint) from public, anon, authenticated; grant execute on function public.crear_cotizacion_comparativa(uuid, jsonb, jsonb, jsonb, bigint) to service_role;" || abortar "no se pudieron fijar los grants"

echo "== 1. PREFLIGHT (antes de la 314) =="
fase_controles "preflight" "$D/preflight_314_comparativa_b2b_aliado.sql" && ok
echo "== 2. casos ANTES: el hueco existe (B2B sin aliado se crea) =="
fase_controles "casos antes" "$D/test_314_casos.sql" -v fase=antes && ok
limpiar_datos

echo "== 3. aplicar la 314 =="
sql_archivo "migración 314" "$M" -1 && ok || abortar "la migración 314 falló"
echo "== 4. POSTCHECK =="
fase_controles "postcheck" "$D/postcheck_314_comparativa_b2b_aliado.sql" && ok
echo "== 5. casos DESPUÉS: B2B sin aliado se rechaza; el resto no cambia =="
fase_controles "casos después" "$D/test_314_casos.sql" -v fase=despues && ok
limpiar_datos

echo "== 6. idempotencia: aplicar la 314 por segunda vez + postcheck =="
sql_archivo "migración 314 (2.ª vez)" "$M" -1 && ok
fase_controles "postcheck tras idempotencia" "$D/postcheck_314_comparativa_b2b_aliado.sql" && ok

echo "== 7. grants: authenticated NO puede ejecutar la función =="
R="$(docker exec -i "$CT" psql -U postgres -X -q -c "set role authenticated; select public.crear_cotizacion_comparativa(null,'{}'::jsonb,'[]'::jsonb,'[]'::jsonb,null);" 2>&1)"
if printf '%s\n' "$R" | grep -q "permission denied"; then echo "OK  authenticated: permission denied"; ok; else echo "FALLO: authenticated pudo ejecutarla: $R"; FALLOS=$((FALLOS+1)); fi

echo "== 8. rollback: vuelve a permitir (confirma que el script restaura la 211) =="
sql_archivo "rollback" "$D/rollback_314_comparativa_b2b_aliado.sql" && ok
fase_controles "casos tras rollback" "$D/test_314_casos.sql" -v fase=revertida && ok
limpiar_datos
echo "== 9. re-aplicar la 314 tras el rollback =="
sql_archivo "migración 314 (tras rollback)" "$M" -1 && ok
fase_controles "postcheck tras re-aplicar" "$D/postcheck_314_comparativa_b2b_aliado.sql" && ok

terminar
