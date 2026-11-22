#!/usr/bin/env bash
# Prueba DEL LANZADOR de la 314 (corrección B3): le entrega copias MUTADAS de los scripts reales y exige que cada fallo inyectado produzca salida distinta de cero
# y NUNCA imprima «TODO OK». Incluye un control sin mutar (debe salir 0 y decir TODO OK). Cada mutación corre en su propio contenedor; se lanzan en paralelo.
# Uso (desde dspacios-travel/):  bash supabase/scripts/test_314_launcher_mutaciones.sh
set -u -o pipefail
export MSYS_NO_PATHCONV=1
L="supabase/scripts/test_314_comparativa_b2b_aliado.sh"
S="supabase/scripts"
MIG="supabase/migrations/20260601000314_comparativa_b2b_aliado_obligatorio.sql"
# Carpeta RELATIVA (el /tmp de Git Bash y el de node en Windows no son el mismo directorio).
T=".tmp_mut314_$"; mkdir -p "$T"
trap 'rm -rf "$T"' EXIT

nueva() { # nombre → carpeta con copia de los scripts y de la migración
  mkdir -p "$T/$1"; cp "$S"/preflight_314_* "$S"/postcheck_314_* "$S"/rollback_314_* "$S"/test_314_stubs.sql "$S"/test_314_casos.sql "$T/$1/"; cp "$MIG" "$T/$1/migracion.sql"
}
reemplazar() { # archivo viejo nuevo (primera aparición; falla ruidosamente si no existe, para que una mutación nunca sea un no-op silencioso)
  node -e '
    const fs=require("fs"); const [p,a,b]=process.argv.slice(1); const s=fs.readFileSync(p,"utf8");
    if(!s.includes(a)){console.error("MUTACION SIN EFECTO en "+p+": "+a);process.exit(9);}
    fs.writeFileSync(p,s.replace(a,b));' "$1" "$2" "$3" || exit 9
}
anexar() { printf '\n%s\n' "$2" >> "$1"; }

# nombre | espera (0 = debe pasar, 1 = debe fallar)
MUTACIONES=(control sql_error_migracion sintaxis_migracion preflight_revisar postcheck_revisar caso_en_fallo sql_error_postcheck sql_error_casos preflight_vacio migracion_ausente rollback_roto stubs_roto)
declare -A ESPERA=([control]=0 [sql_error_migracion]=1 [sintaxis_migracion]=1 [preflight_revisar]=1 [postcheck_revisar]=1 [caso_en_fallo]=1 [sql_error_postcheck]=1 [sql_error_casos]=1 [preflight_vacio]=1 [migracion_ausente]=1 [rollback_roto]=1 [stubs_roto]=1)

for m in "${MUTACIONES[@]}"; do nueva "$m"; done
anexar "$T/sql_error_migracion/migracion.sql" "select 1/0;"
anexar "$T/sintaxis_migracion/migracion.sql" "selec 1;"
reemplazar "$T/preflight_revisar/preflight_314_comparativa_b2b_aliado.sql" "case when funciones = 1 then 'OK' else 'REVISAR' end" "'REVISAR'"
reemplazar "$T/postcheck_revisar/postcheck_314_comparativa_b2b_aliado.sql" "case when tiene_guarda is true then 'OK' else 'REVISAR' end" "'REVISAR'"
reemplazar "$T/caso_en_fallo/test_314_casos.sql" "then 'RECHAZADA(P0001)' else 'CREADA' end;" "then 'CREADA' else 'CREADA' end;"
anexar "$T/sql_error_postcheck/postcheck_314_comparativa_b2b_aliado.sql" "select * from tabla_que_no_existe_314;"
anexar "$T/sql_error_casos/test_314_casos.sql" "select * from tabla_que_no_existe_314;"
printf 'select 1 as orden, 1 as control, 1 as observado, 1 as esperado where false;\n' > "$T/preflight_vacio/preflight_314_comparativa_b2b_aliado.sql"
rm -f "$T/migracion_ausente/migracion.sql"
anexar "$T/rollback_roto/rollback_314_comparativa_b2b_aliado.sql" "select 1/0;"
anexar "$T/stubs_roto/test_314_stubs.sql" "select * from tabla_que_no_existe_314;"

i=0
for m in "${MUTACIONES[@]}"; do
  i=$((i+1))
  ( CT="pg_b2b314_mut_$i" B2B314_DIR_SCRIPTS="$T/$m" B2B314_MIGRACION="$T/$m/migracion.sql" bash "$L" > "$T/$m.log" 2>&1; echo $? > "$T/$m.rc" ) &
done
wait

FALLOS=0
printf '\n%-24s | %-9s | %-6s | %-12s | %s\n' mutacion espera salida "TODO OK?" veredicto
for m in "${MUTACIONES[@]}"; do
  rc="$(cat "$T/$m.rc" 2>/dev/null || echo 99)"
  if grep -q "TODO OK" "$T/$m.log"; then todo="sí"; else todo="no"; fi
  if [ "${ESPERA[$m]}" = "0" ]; then
    if [ "$rc" = "0" ] && [ "$todo" = "sí" ]; then v="OK (pasa, como debe)"; else v="FALLO"; FALLOS=$((FALLOS+1)); fi
    esp="pasar"
  else
    if [ "$rc" != "0" ] && [ "$todo" = "no" ]; then v="OK (falla, como debe)"; else v="FALLO"; FALLOS=$((FALLOS+1)); fi
    esp="fallar"
  fi
  printf '%-24s | %-9s | %-6s | %-12s | %s\n' "$m" "$esp" "$rc" "$todo" "$v"
  if [ "$v" = "FALLO" ]; then echo "---- salida de $m ----"; tail -15 "$T/$m.log"; fi
done
if [ "$FALLOS" -eq 0 ]; then echo "MUTACIONES DEL LANZADOR: TODAS DETECTADAS (${#MUTACIONES[@]} casos)"; exit 0; fi
echo "MUTACIONES DEL LANZADOR: $FALLOS sin la reacción esperada"; exit 1
