#!/usr/bin/env bash
# Ciclo de vida de las migraciones NUEVAS del bloque B2B sobre la imagen REAL de Supabase Postgres (Docker), en una copia DESECHABLE de la plantilla de esquema.
# Orden: 316 -> 314 -> 317 -> 318 -> 319 -> 322 -> 323 -> 324. Por migración (9 fases fijas): preflight -> aplicar (psql -1) -> postcheck -> re-aplicar -> postcheck -> pruebas SQL -> rollback sin datos -> preflight «por aplicar» -> re-aplicar -> postcheck.
#
# GARANTÍAS (corrección B8): (1) CADA comando conserva su código de salida y su salida de error completa (nada se descarta ni se enmascara con tuberías ni con «|| true» en las fases que cuentan);
# (2) preflight/postcheck se validan FILA A FILA: cantidad EXACTA de controles esperados, numeración contigua 1..N, veredicto válido, ninguno en REVISAR/FALLO;
# (3) la re-aplicación se valida contra el CONTRATO de cada migración: o termina sin error, o se rechaza con el motivo ESPERADO; cualquier otro fallo, o un rechazo con otro motivo, es FALLO con el error completo;
# (4) las pruebas SQL se validan por su salida real (sumario sin fallos, filas OK o aviso de éxito), no solo por «no hubo excepción»;
# (5) «RESULTADO: TODO OK» solo se imprime si se EJECUTARON Y VALIDARON todas las fases esperadas. Salida: 0 todo OK · 1 hay fallos · 2 no se pudo preparar el entorno.
# Variables de prueba (las usa ciclo_docker_mutaciones.sh): CICLO_DIR_SCRIPTS, CICLO_DIR_MIGRACIONES (copias MUTADAS), CICLO_DB (nombre de la base), CICLO_SOLO (lista, p. ej. «323»: solo esas migraciones; el resto no se ejecuta ni se cuenta).
# Uso: bash ciclo_docker.sh [contenedor=pgb2b] [plantilla=plantillab2b]      Crea la base m_ciclo (la borra antes); nunca toca otras bases.
set -u -o pipefail
export MSYS_NO_PATHCONV=1
PG="${1:-pgb2b}"; PLANTILLA="${2:-plantillab2b}"; DB="${CICLO_DB:-m_ciclo}"
AQUI="$(cd "$(dirname "$0")" && pwd)"
SCR="$(cd "${CICLO_DIR_SCRIPTS:-$AQUI/..}" && pwd)"; MIG="$(cd "${CICLO_DIR_MIGRACIONES:-$AQUI/../../migrations}" && pwd)"
SOLO="${CICLO_SOLO:-}"
DC="/tmp/cs_$DB"; DM="/tmp/cm_$DB"

# ── Plan: [preflight filas, postcheck filas, re-aplicación esperada, pruebas SQL «archivo:tipo»] ──────────────────────────────────────────────────────────────
declare -A PRE POST REAP TESTS NOMBRE
ORDEN="${CICLO_ORDEN:-316 314 317 318 319 322 323 324}"   # integración (#126/#127/B2B): CICLO_ORDEN="312 313 314 315 316 317 318 319 322 323 324"
PRE[316]=2;  POST[316]=6; REAP[316]="ok";                                      TESTS[316]=""
PRE[314]=6;  POST[314]=6; REAP[314]="ok";                                      TESTS[314]=""
PRE[317]=6;  POST[317]=8; REAP[317]="rechaza:no tiene la guarda esperada";     TESTS[317]="test_317_neto_manual.sql:sum3"
PRE[318]=5;  POST[318]=9; REAP[318]="ok";                                      TESTS[318]="test_318_firma_aceptacion.sql:f318"
PRE[319]=6;  POST[319]=9; REAP[319]="ok";                                      TESTS[319]="test_319_aliado_logo.sql:sum3"
PRE[322]=4;  POST[322]=7; REAP[322]="ok";                                      TESTS[322]="test_322_clientes_aliado.sql:f322"
PRE[323]=8;  POST[323]=9; REAP[323]="rechaza:ya aplicada";                     TESTS[323]="test_323_solicitud_contrato.sql:sum3 test_25_correccion_auditoria.sql:aviso test_25_historial_gemelas.sql:aviso"
PRE[324]=5;  POST[324]=8; REAP[324]="ok";                                      TESTS[324]="test_324_registro_candados.sql:sum3"
PRE[312]=${PRE312:-0}; POST[312]=${POST312:-0}; REAP[312]="ok"; TESTS[312]=""
PRE[313]=${PRE313:-0}; POST[313]=${POST313:-0}; REAP[313]="ok"; TESTS[313]=""
PRE[315]=${PRE315:-0}; POST[315]=${POST315:-0}; REAP[315]="ok"; TESTS[315]=""
NOMBRE[312]="abono_moneda_pago"; NOMBRE[313]="registrar_abono_moneda"; NOMBRE[315]="cierre_general"
NOMBRE[324]="registro_candados"; NOMBRE[316]="recuperaciones_consumidas"; NOMBRE[314]="comparativa_b2b_aliado"; NOMBRE[317]="neto_manual"; NOMBRE[318]="firma_aceptacion"; NOMBRE[319]="aliado_logo"; NOMBRE[322]="clientes_aliado"; NOMBRE[323]="solicitud_contrato"
ARCH_PRE() { ls "$SCR" | grep -E "^preflight_$1_" | head -1; }; ARCH_POST() { ls "$SCR" | grep -E "^postcheck_$1_" | head -1; }; ARCH_RB() { ls "$SCR" | grep -E "^rollback_$1_" | head -1; }
ARCH_MIG() { ls "$MIG" | grep -E "^2026060100$(printf %04d "$1")_" | head -1; }

# Migraciones a ejecutar (CICLO_SOLO filtra) y fases ESPERADAS: 9 por migración + una por cada prueba SQL.
EJECUTAR=""; for n in $ORDEN; do [ -z "$SOLO" ] || [[ ",${SOLO// /,}," == *",$n,"* ]] || continue; EJECUTAR="$EJECUTAR $n"; done
FASES_ESPERADAS=0; for n in $EJECUTAR; do k=0; for t in ${TESTS[$n]}; do k=$((k+1)); done; FASES_ESPERADAS=$((FASES_ESPERADAS + 9 + k)); done
FASES_HECHAS=0; FALLOS=0
ok()   { FASES_HECHAS=$((FASES_HECHAS+1)); echo "OK    $1"; }
fallo(){ FALLOS=$((FALLOS+1)); echo "FALLO $1"; [ -z "${2:-}" ] || printf '%s\n' "$2" | sed 's/^/        | /' | head -12; }

# ── Ejecutores: conservan el código de salida (RC), la salida estándar (OUT) y la de error COMPLETA (ERR) ────────────────────────────────────────────────────────
EJEC() { local t; t="$(mktemp)"; OUT="$("$@" 2>"$t")"; RC=$?; ERR="$(cat "$t")"; rm -f "$t"; }
PSQLBASE=(docker exec -e PGPASSWORD=postgres "$PG" psql -h 127.0.0.1 -U supabase_admin -X -q -t -A -F'|' -v ON_ERROR_STOP=1)
Q()      { EJEC "${PSQLBASE[@]}" -d "$DB" -f "$DC/$1"; }                              # consulta/archivo
APLICA() { EJEC "${PSQLBASE[@]}" -d "$DB" -1 -f "$DM/$1"; }                           # migración en UNA transacción
RBK()    { EJEC "${PSQLBASE[@]}" -d "$DB" -f "$DC/$1"; }                              # rollback: trae su propio begin/commit
TST()    { EJEC docker exec -w "$DC" -e PGPASSWORD=postgres "$PG" psql -h 127.0.0.1 -U supabase_admin -d "$DB" -X -q -t -A -F'|' -v ON_ERROR_STOP=1 -f "$1"; }
hay_error() { [ "$RC" -ne 0 ] || grep -qE '(^|[: ])ERROR:|FATAL:|psql: error' <<<"$ERR"; }

# Validación FILA A FILA de una consulta de controles: N filas exactas, numeración contigua, veredicto OK/INFO.
valida_controles() { # nombre esperadas
  local nombre="$1" esperadas="$2" n=0 mal="" linea sig=1
  if [ "$RC" -ne 0 ]; then fallo "$nombre: la consulta terminó con código $RC" "$ERR"; return 1; fi
  if grep -qiE 'ERROR:|FATAL:' <<<"$ERR"; then fallo "$nombre: la consulta emitió un error" "$ERR"; return 1; fi
  while IFS= read -r linea; do
    [ -n "$linea" ] || continue
    n=$((n+1))
    local ord="${linea%%|*}" est="${linea##*|}"
    if [ "${FMTSIN:-0}" = 1 ]; then
      # Formato «control|valor|esperado|estado» (preflight/postcheck de 312/313, sin columna de orden): se valida cada fila y su veredicto, no la numeración.
      [[ "$linea" =~ ^[^\|]+\|[^\|]*\|[^\|]*\|(OK|INFO|REVISAR|FALLO)$ ]] || { mal="$mal fila-$n-sin-formato-válido"; continue; }
      ord="$n"
    else
      [[ "$linea" =~ ^[0-9]+\|.*\|(OK|INFO|REVISAR|FALLO)$ ]] || { mal="$mal fila-$n-sin-formato-válido"; continue; }
      [ "$ord" = "$sig" ] || mal="$mal numeración-esperaba-$sig-vino-$ord"
    fi
    sig=$((sig+1))
    case "$est" in OK|INFO) ;; *) mal="$mal control-$ord-en-$est";; esac
  done <<<"$OUT"
  if [ "$n" -ne "$esperadas" ]; then fallo "$nombre: se esperaban $esperadas controles y hay $n" "$OUT"; return 1; fi
  if [ -n "$mal" ]; then fallo "$nombre: controles inválidos ($mal)" "$OUT"; return 1; fi
  ok "$nombre: $n controles OK/INFO (numeración 1..$n, veredictos válidos)"
}
# Validación de la salida REAL de cada prueba SQL
valida_prueba() { # archivo tipo
  local f="$1" tipo="$2"
  if hay_error; then fallo "prueba $f: código $RC o error de SQL" "$ERR"; return; fi
  case "$tipo" in
    sum3) local l; l="$(grep -E '^[0-9]+\|[0-9]+\|[0-9]+$' <<<"$OUT" | tail -1)"
      if [ -z "$l" ]; then fallo "prueba $f: no imprimió el sumario aciertos|fallos|total" "$OUT"; return; fi
      IFS='|' read -r a fa t <<<"$l"; if [ "$fa" = 0 ] && [ "$t" -gt 0 ] && [ "$a" = "$t" ]; then ok "prueba $f: $a/$t aciertos, 0 fallos"; else fallo "prueba $f: sumario $l" "$OUT"; fi;;
    f318) local filas ko sum; filas="$(grep -cE '^[0-9]+\|.*\|(OK|FALLO)$' <<<"$OUT")"; ko="$(grep -cE '^[0-9]+\|.*\|FALLO$' <<<"$OUT")"; sum="$(grep -E '^[0-9]+\|[0-9]+$' <<<"$OUT" | tail -1)"
      if [ "$filas" -gt 0 ] && [ "$ko" = 0 ] && [ "${sum%%|*}" = 0 ] && [ "${sum##*|}" = "$filas" ]; then ok "prueba $f: $filas controles, 0 en FALLO (sumario $sum)"; else fallo "prueba $f: filas=$filas fallos=$ko sumario=${sum:-ausente}" "$OUT"; fi;;
    f322) local filas otros; filas="$(grep -cE '^[0-9]+\|.*\|OK$' <<<"$OUT")"; otros="$(grep -E '^[0-9]+\|' <<<"$OUT" | grep -vcE '\|OK$')"
      if [ "$filas" -eq 14 ] && [ "$otros" = 0 ]; then ok "prueba $f: 14 controles OK"; else fallo "prueba $f: se esperaban 14 filas OK (hay $filas OK y $otros distintas)" "$OUT"; fi;;
    aviso) if grep -q 'NOTICE:  OK:' <<<"$ERR"; then ok "prueba $f: sin excepción y con el aviso de éxito del propio test"; else fallo "prueba $f: no emitió su aviso «OK:»" "$ERR"; fi;;
    *) fallo "prueba $f: tipo de validación desconocido ($tipo)";;
  esac
}

# ── Preparación (errores aquí → salida 2) ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
prep() { "$@" >/dev/null 2>&1 || { echo "PREPARACIÓN FALLIDA: $*"; exit 2; }; }
"${PSQLBASE[@]}" -d postgres -c "select pg_terminate_backend(pid) from pg_stat_activity where datname in ('$DB','$PLANTILLA') and pid <> pg_backend_pid()" >/dev/null 2>&1
prep "${PSQLBASE[@]}" -d postgres -c "drop database if exists $DB with (force)"
prep "${PSQLBASE[@]}" -d postgres -c "create database $DB template $PLANTILLA"
prep docker exec "$PG" sh -c "rm -rf '$DC' '$DM' && mkdir -p '$DM'"
prep docker cp "$(cygpath -m "$SCR")" "$PG:$DC"
for n in $EJECUTAR; do f="$(ARCH_MIG "$n")"; [ -n "$f" ] || { echo "PREPARACIÓN FALLIDA: no hay migración $n"; exit 2; }; prep docker cp "$(cygpath -m "$MIG/$f")" "$PG:$DM/"; done
EJEC "${PSQLBASE[@]}" -d "$DB" -f "$DC/local4360/dueno_auth_local4360.sql"; [ "$RC" -eq 0 ] || echo "INFO  entorno auth: código $RC (solo ajuste de dueños del esquema auth de la plantilla local)"
prep "${PSQLBASE[@]}" -d "$DB" -c "create or replace function auth.uid() returns uuid language sql stable as \$f\$ select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid \$f\$"
# La plantilla local trae un auth.users reducido; el GoTrue real SÍ tiene estas columnas (las lee la 324 y su preflight las exige). Solo en esta base desechable:
prep "${PSQLBASE[@]}" -d "$DB" -c "alter table auth.users add column if not exists email_confirmed_at timestamptz, add column if not exists raw_app_meta_data jsonb"
echo "Plan: migraciones [$EJECUTAR ] · fases esperadas: $FASES_ESPERADAS"

for n in $EJECUTAR; do
  echo; echo "=== $n (${NOMBRE[$n]}) ==="
  pre="$(ARCH_PRE "$n")"; post="$(ARCH_POST "$n")"; rb="$(ARCH_RB "$n")"; mg="$(ARCH_MIG "$n")"
  FMTSIN=0; [[ " ${SINORDEN:-} " == *" $n "* ]] && FMTSIN=1
  [ -n "$pre" ] && [ -n "$post" ] && [ -n "$rb" ] || { fallo "$n: faltan scripts (preflight='$pre' postcheck='$post' rollback='$rb')"; continue; }
  Q "$pre";  valida_controles "$n preflight antes" "${PRE[$n]}"
  APLICA "$mg"; if hay_error; then fallo "$n migración: código $RC o error de SQL" "$ERR"; else ok "$n migración aplicada (psql -1, código 0)"; fi
  Q "$post"; valida_controles "$n postcheck" "${POST[$n]}"
  APLICA "$mg"; esperado="${REAP[$n]}"
  if [ "$esperado" = ok ]; then
    if hay_error; then fallo "$n re-aplicación: se esperaba que terminara SIN error y falló (código $RC)" "$ERR"; else ok "$n re-aplicación: sin error (idempotente, como se espera)"; fi
  else
    patron="${esperado#rechaza:}"
    if [ "$RC" -ne 0 ] && grep -qF -- "$patron" <<<"$ERR"; then ok "$n re-aplicación: rechazada por el motivo ESPERADO («$patron»)"
    elif [ "$RC" -eq 0 ]; then fallo "$n re-aplicación: se esperaba un rechazo («$patron») y fue aceptada" "$ERR"
    else fallo "$n re-aplicación: rechazada por un motivo INESPERADO (se esperaba «$patron»)" "$ERR"; fi
  fi
  Q "$post"; valida_controles "$n postcheck tras re-aplicar" "${POST[$n]}"
  for spec in ${TESTS[$n]}; do TST "${spec%%:*}"; valida_prueba "${spec%%:*}" "${spec##*:}"; done
  RBK "$rb"; if hay_error; then fallo "$n rollback sin datos: código $RC o error de SQL" "$ERR"; else ok "$n rollback sin datos aplicado (código 0)"; fi
  Q "$pre";  valida_controles "$n preflight tras el rollback (vuelve a «por aplicar»)" "${PRE[$n]}"
  APLICA "$mg"; if hay_error; then fallo "$n re-aplicación tras el rollback: código $RC o error de SQL" "$ERR"; else ok "$n re-aplicada tras el rollback"; fi
  Q "$post"; valida_controles "$n postcheck tras re-aplicar el rollback" "${POST[$n]}"
done

echo
if [ "$FALLOS" -eq 0 ] && [ "$FASES_HECHAS" -eq "$FASES_ESPERADAS" ] && [ "$FASES_ESPERADAS" -gt 0 ]; then
  echo "RESULTADO: TODO OK ($FASES_HECHAS/$FASES_ESPERADAS fases)"; exit 0
fi
echo "RESULTADO: FALLO ($FALLOS fallo(s); fases validadas $FASES_HECHAS de $FASES_ESPERADAS)"; exit 1
