#!/usr/bin/env bash
# Pruebas de INYECCIÓN DE FALLOS del lanzador ciclo_docker.sh (corrección B8). Cada caso copia los scripts/migración de UNA migración a un directorio desechable, les INYECTA un defecto
# y exige que el lanzador (a) termine con código distinto de 0, (b) imprima «RESULTADO: FALLO», (c) NO imprima «TODO OK» y (d) nombre el defecto esperado. El caso base (sin defecto) debe dar 0 / «TODO OK».
# Si algún defecto pasa desapercibido, esta prueba falla: así se demuestra que el lanzador ya no enmascara códigos de salida, controles ausentes ni rechazos con motivo equivocado.
# Uso (desde dspacios-travel/):  bash supabase/scripts/real_62/ciclo_docker_mutaciones.sh [contenedor=pgb2b] [plantilla=plantillab2b] [migracion=323]
# No se reutiliza ninguna evidencia del lanzador 314: cada defecto se ejecuta de verdad contra la imagen real de Postgres.
set -u -o pipefail
export MSYS_NO_PATHCONV=1
PG="${1:-pgb2b}"; PLANTILLA="${2:-plantillab2b}"; N="${3:-323}"
AQUI="$(cd "$(dirname "$0")" && pwd)"; SCR0="$(cd "$AQUI/.." && pwd)"; MIG0="$(cd "$AQUI/../../migrations" && pwd)"
TMP="${CICLO_MUT_TMP:-$(mktemp -d)}"
TOTAL=0; MALOS=0
# Dependencias de plantilla: la plantilla de esquema trae hasta la 315; las anteriores del bloque se aplican como parte de la ejecución previa (CICLO_SOLO se amplía con ellas).
PREVIAS="${CICLO_PREVIAS:-316 314 317 318 319 322}"

preparar() { # directorio
  local W="$1"; rm -rf "$W"; mkdir -p "$W/scripts/local4360" "$W/mig"
  for f in $(ls "$SCR0" | grep -E "^(preflight|postcheck|rollback)_(${PREVIAS// /|}|$N)_"); do cp "$SCR0/$f" "$W/scripts/"; done
  for f in test_317_neto_manual.sql test_318_firma_aceptacion.sql test_319_aliado_logo.sql test_322_clientes_aliado.sql test_323_solicitud_contrato.sql test_25_correccion_auditoria.sql test_25_historial_gemelas.sql; do cp "$SCR0/$f" "$W/scripts/" 2>/dev/null; done
  cp "$SCR0"/test_*fixtures.sql "$W/scripts/"; cp "$SCR0/local4360/dueno_auth_local4360.sql" "$W/scripts/local4360/"
  for n in $PREVIAS $N; do cp "$MIG0"/2026060100$(printf %04d "$n")_*.sql "$W/mig/"; done
}
# caso NOMBRE ESPERADO_REGEX COMANDO_DE_INYECCIÓN(W)   — COMANDO = función bash definida abajo que recibe el directorio de trabajo
caso() {
  local nombre="$1" esperado="$2" inyecta="${3:-}" W="$TMP/$1"; TOTAL=$((TOTAL+1))
  preparar "$W"; [ -z "$inyecta" ] || "$inyecta" "$W"
  local salida rc
  salida="$(CICLO_DIR_SCRIPTS="$W/scripts" CICLO_DIR_MIGRACIONES="$W/mig" CICLO_DB="m_mut_$TOTAL" CICLO_SOLO="${CICLO_SOLO_MUT:-$N}" bash "$AQUI/ciclo_docker.sh" "$PG" "$PLANTILLA" 2>&1)"; rc=$?
  if [ "$esperado" = "TODO_OK" ]; then
    if [ "$rc" -eq 0 ] && grep -q "RESULTADO: TODO OK" <<<"$salida"; then echo "OK    [$nombre] sin defecto: código 0 y «TODO OK» (línea base válida)"; else MALOS=$((MALOS+1)); echo "FALLO [$nombre] la línea base debía dar 0/TODO OK: código $rc"; printf '%s\n' "$salida" | grep -E "FALLO|PREPARACIÓN" | head -8 | sed 's/^/        | /'; fi
  else
    if [ "$rc" -ne 0 ] && grep -q "RESULTADO: FALLO" <<<"$salida" && ! grep -q "TODO OK" <<<"$salida" && grep -Eq "$esperado" <<<"$salida"; then echo "OK    [$nombre] defecto DETECTADO (código $rc; mensaje esperado «$esperado»)"
    else MALOS=$((MALOS+1)); echo "FALLO [$nombre] el defecto NO fue detectado como se esperaba (código $rc; patrón «$esperado»)"; printf '%s\n' "$salida" | grep -E "RESULTADO|FALLO" | head -6 | sed 's/^/        | /'; fi
  fi
  rm -rf "$W"
}
f_pre()  { ls "$1/scripts" | grep -E "^preflight_${N}_" | head -1; }; f_post() { ls "$1/scripts" | grep -E "^postcheck_${N}_" | head -1; }; f_rb() { ls "$1/scripts" | grep -E "^rollback_${N}_" | head -1; }; f_mig() { ls "$1/mig" | grep -E "^2026060100$(printf %04d "$N")_" | head -1; }
# ── Inyectores ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
i_pre_pocos()      { echo "select 1 as n, 'solo uno' as control, 'OK' as estado;" > "$1/scripts/$(f_pre "$1")"; }
i_pre_vacio()      { echo "select 1 where false;" > "$1/scripts/$(f_pre "$1")"; }
i_pre_error()      { echo "select 1/0;" > "$1/scripts/$(f_pre "$1")"; }
i_post_fallo()     { echo "select g, 'control '||g, case when g = 5 then 'FALLO' else 'OK' end from generate_series(1, 9) g;" > "$1/scripts/$(f_post "$1")"; }
i_post_revisar()   { echo "select g, 'control '||g, case when g = 2 then 'REVISAR' else 'OK' end from generate_series(1, 9) g;" > "$1/scripts/$(f_post "$1")"; }
i_post_numeracion(){ echo "select g, 'control '||g, 'OK' from generate_series(2, 10) g;" > "$1/scripts/$(f_post "$1")"; }
i_post_veredicto() { echo "select g, 'control '||g, 'TAL VEZ' from generate_series(1, 9) g;" > "$1/scripts/$(f_post "$1")"; }
i_post_ausente()   { rm -f "$1/scripts/$(f_post "$1")"; }
i_mig_error()      { echo "select 1/0;" >> "$1/mig/$(f_mig "$1")"; }
i_reap_otro()      { sed -i 's/ya aplicada/otro motivo cualquiera/' "$1/mig/$(f_mig "$1")"; }
i_reap_acepta()    { sed -i "s/raise exception '323: ya aplicada[^;]*;/null;/" "$1/mig/$(f_mig "$1")"; }
i_rb_error()       { echo "select 1/0;" >> "$1/scripts/$(f_rb "$1")"; }
i_rb_noop()        { echo "select 1;" > "$1/scripts/$(f_rb "$1")"; }
i_test_cero()      { echo "select 1, 2, 3;" > "$1/scripts/test_${N}_solicitud_contrato.sql"; }
i_test_vacio()     { echo "select 1 where false;" > "$1/scripts/test_${N}_solicitud_contrato.sql"; }
i_test_error()     { echo "select 1/0;" > "$1/scripts/test_${N}_solicitud_contrato.sql"; }
i_test_sin_aviso() { echo "select 1;" > "$1/scripts/test_25_historial_gemelas.sql"; }

echo "Inyección de fallos sobre la migración $N (directorio de trabajo $TMP)"
caso "base"                       "TODO_OK"
caso "preflight-pocos-controles"  "se esperaban 8 controles y hay 1"                 i_pre_pocos
caso "preflight-vacio"            "se esperaban 8 controles y hay 0"                 i_pre_vacio
caso "preflight-con-error"        "preflight antes: la consulta terminó con código"  i_pre_error
caso "postcheck-control-FALLO"    "control-5-en-FALLO"                               i_post_fallo
caso "postcheck-control-REVISAR"  "control-2-en-REVISAR"                             i_post_revisar
caso "postcheck-numeracion"       "numeración-esperaba-1-vino-2"                     i_post_numeracion
caso "postcheck-veredicto-raro"   "sin-formato-válido"                               i_post_veredicto
caso "postcheck-ausente"          "faltan scripts"                                   i_post_ausente
caso "migracion-con-error"        "migración: código"                                i_mig_error
caso "reaplicacion-otro-motivo"   "motivo INESPERADO"                                i_reap_otro
caso "reaplicacion-aceptada"      "fue aceptada|motivo INESPERADO|re-aplicación"     i_reap_acepta
caso "rollback-con-error"         "rollback sin datos: código"                       i_rb_error
caso "rollback-no-revierte"       "preflight tras el rollback|re-aplicación tras el rollback" i_rb_noop
caso "prueba-sumario-con-fallos"  "prueba test_${N}_solicitud_contrato.sql: sumario"  i_test_cero
caso "prueba-sin-salida"          "no imprimió el sumario"                           i_test_vacio
caso "prueba-con-error"           "prueba test_${N}_solicitud_contrato.sql: código"  i_test_error
caso "prueba-sin-aviso-OK"        "no emitió su aviso"                               i_test_sin_aviso
CICLO_SOLO_MUT="999" caso "ninguna-fase-ejecutada" "fases validadas 0 de 0|faltan|PREPARACIÓN" ""
echo; echo "RESULTADO: $((TOTAL-MALOS))/$TOTAL casos como se esperaba; $MALOS FALLO"
rm -rf "$TMP" 2>/dev/null
[ "$MALOS" -eq 0 ]
