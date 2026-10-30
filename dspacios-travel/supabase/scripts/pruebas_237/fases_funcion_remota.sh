#!/bin/sh
# Fases de la 237 en Docker LOCAL partiendo de una función reemplazar_tarifas_hotel_calculadora IGUAL a la
# definición observada en Producción (fixtures/…remota.json, md5 d7e05c96…):
#   instala la función remota -> preflight -> (preflight negativo con una función alterada) -> aplica la 237
#   (ruta manual, sin -1) -> postcheck -> compara por tokens lo instalado -> rollback con fallo forzado
#   (debe abortar sin cambios) -> rollback real -> verifica md5 EXACTOS -> preflight -> reaplica -> postcheck.
# Uso (desde dspacios-travel/):  sh supabase/scripts/pruebas_237/fases_funcion_remota.sh [contenedor]
# CANDADO: solo contenedores supabase_db_* locales. Sale con código != 0 al primer control que falle.
set -u
CT="${1:-supabase_db_d5d8local}"
case "$CT" in supabase_db_*) ;; *) echo "CANDADO: contenedor no válido" >&2; exit 2;; esac
AQUI="$(cd "$(dirname "$0")" && pwd)"
APP="$(cd "$AQUI/../../.." && pwd)"
FX="$AQUI/fixtures/reemplazar_tarifas_hotel_calculadora.remota.json"
M="$APP/supabase/migrations/20260601000237_catalogos_globales_frontera_mayorista.sql"
S="$APP/supabase/scripts"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
PSQL="docker exec -i $CT psql -U postgres -X -q -A -t -v ON_ERROR_STOP=1"
PSQLF="docker exec -i $CT psql -U postgres -X -q -A -t"          # sin ON_ERROR_STOP: como el editor SQL
FALLAS=0
paso() { printf '\n== %s\n' "$1"; }
chk() { # descripcion esperado observado
  if [ "$2" = "$3" ]; then echo "PASA  $1 | esperado=$2 observado=$3"; else echo "FALLA $1 | esperado=$2 observado=$3"; FALLAS=$((FALLAS+1)); fi
}
md5_fn() { $PSQL -c "select md5(prosrc) from pg_proc where pronamespace='public'::regnamespace and proname='$1'"; }
sin_espacios() { tr -d ' \r\n'; }
def_completa() { $PSQL -c "select pg_get_functiondef(p.oid) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname='reemplazar_tarifas_hotel_calculadora'"; }
veredicto() { docker exec -i $CT psql -U postgres -X -q -A -t -F ' | ' < "$1" | grep -E "VEREDICTO" ; }
REM_MD5=d7e05c96e1260a76fbad22784e881c77

paso "0. Estado inicial: la función igual a la remota (definición del fixture, byte a byte)"
node -e 'const fs=require("fs");const f=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));fs.writeFileSync(process.argv[2],f.definicion);' "$(cygpath -w "$FX" 2>/dev/null || echo "$FX")" "$(cygpath -w "$TMP/remota.sql" 2>/dev/null || echo "$TMP/remota.sql")"
$PSQL < "$TMP/remota.sql" >/dev/null
chk "md5(prosrc) de la función instalada = md5 observado en Producción" "$REM_MD5" "$(md5_fn reemplazar_tarifas_hotel_calculadora)"
ANTES_FUS=$(md5_fn fn_fusionar_destino); ANTES_GEN=$(md5_fn generar_tarifas_hotel_calculadora); ANTES_APR=$(md5_fn aprobar_solicitud_b2b)

paso "1. PREFLIGHT (debe dar LISTO PARA APLICAR)"
V=$(veredicto "$S/preflight_237_catalogos_globales.sql"); echo "$V"
chk "preflight antes de aplicar" "VEREDICTO | LISTO PARA APLICAR | LISTO PARA APLICAR | OK" "$V"

paso "1b. PREFLIGHT NEGATIVO: función alterada (un token distinto) -> debe dar NO APLICAR"
$PSQL -c "create or replace function public.reemplazar_tarifas_hotel_calculadora(p_hotel_id bigint, p_regimenes text[], p_filas jsonb) returns jsonb language plpgsql security definer set search_path to 'public','pg_temp' as \$f\$ begin return '{}'::jsonb; end; \$f\$" >/dev/null
V=$(veredicto "$S/preflight_237_catalogos_globales.sql"); echo "$V"
case "$V" in *"NO APLICAR"*) chk "preflight con función alterada" "NO APLICAR" "NO APLICAR";; *) chk "preflight con función alterada" "NO APLICAR" "$V";; esac
$PSQL < "$TMP/remota.sql" >/dev/null
chk "función remota restaurada tras la prueba negativa" "$REM_MD5" "$(md5_fn reemplazar_tarifas_hotel_calculadora)"

paso "2. APLICAR la 237 (ruta manual: sin -1, sin ON_ERROR_STOP)"
$PSQLF < "$M" 2>&1 | tail -2
chk "función de catálogos con guarda tras aplicar" "4" "$($PSQL -c "select count(*) from pg_proc where pronamespace='public'::regnamespace and proname in ('fn_fusionar_destino','generar_tarifas_hotel_calculadora','reemplazar_tarifas_hotel_calculadora','aprobar_solicitud_b2b') and prosrc like '%puede_escribir_catalogo_global()%'")"
chk "respaldo exacto guardado (filas)" "4" "$($PSQL -c "select count(*) from public.catalogos_funciones_previas_237")"
chk "respaldo de reemplazar_tarifas = md5 de Producción" "$REM_MD5" "$($PSQL -c "select md5_prosrc from public.catalogos_funciones_previas_237 where firma like 'reemplazar_tarifas_hotel_calculadora%'")"

paso "3. POSTCHECK (debe dar CORRECTO)"
V=$(veredicto "$S/postcheck_237_catalogos_globales.sql"); echo "$V"
chk "postcheck tras aplicar" "VEREDICTO | CORRECTO | CORRECTO | OK" "$V"

paso "4. La función instalada = remota + SOLO la guarda (comparación por tokens contra la definición real de la base)"
$PSQL -c "select pg_get_functiondef(p.oid) from pg_proc p where p.pronamespace='public'::regnamespace and p.proname='reemplazar_tarifas_hotel_calculadora'" > "$TMP/instalada.sql"
node "$(cygpath -w "$AQUI/verificar_guarda_instalada.mjs" 2>/dev/null || echo "$AQUI/verificar_guarda_instalada.mjs")" "$(cygpath -w "$FX" 2>/dev/null || echo "$FX")" "$(cygpath -w "$TMP/instalada.sql" 2>/dev/null || echo "$TMP/instalada.sql")" > "$TMP/tok.txt" 2>&1
chk "tokens(instalada) - guarda = tokens(remota)" "IGUAL" "$(cat "$TMP/tok.txt")"

paso "5. ROLLBACK con respaldo corrupto (md5 alterado) -> debe ABORTAR sin dejar nada a medias"
$PSQL -c "update public.catalogos_funciones_previas_237 set md5_prosrc = 'x' where firma like 'reemplazar_tarifas_hotel_calculadora%'" >/dev/null
$PSQLF < "$S/rollback_237_catalogos_globales_frontera.sql" 2>&1 | tail -3
chk "tras el rollback fallido siguen las 78 policies" "78" "$($PSQL -c "select count(*) from pg_policy where polname like 'catalogo global:%'")"
chk "tras el rollback fallido sigue la guarda en las 4 funciones" "4" "$($PSQL -c "select count(*) from pg_proc where pronamespace='public'::regnamespace and proname in ('fn_fusionar_destino','generar_tarifas_hotel_calculadora','reemplazar_tarifas_hotel_calculadora','aprobar_solicitud_b2b') and prosrc like '%puede_escribir_catalogo_global()%'")"
chk "tras el rollback fallido sigue el respaldo" "4" "$($PSQL -c "select count(*) from public.catalogos_funciones_previas_237")"
$PSQL -c "update public.catalogos_funciones_previas_237 set md5_prosrc = '$REM_MD5' where firma like 'reemplazar_tarifas_hotel_calculadora%'" >/dev/null

paso "6. ROLLBACK real -> restaura EXACTAMENTE las funciones previas"
$PSQLF < "$S/rollback_237_catalogos_globales_frontera.sql" 2>&1 | tail -2
chk "reemplazar_tarifas_hotel_calculadora restaurada = md5 de Producción" "$REM_MD5" "$(md5_fn reemplazar_tarifas_hotel_calculadora)"
chk "fn_fusionar_destino restaurada" "$ANTES_FUS" "$(md5_fn fn_fusionar_destino)"
chk "generar_tarifas_hotel_calculadora restaurada" "$ANTES_GEN" "$(md5_fn generar_tarifas_hotel_calculadora)"
chk "aprobar_solicitud_b2b restaurada" "$ANTES_APR" "$(md5_fn aprobar_solicitud_b2b)"
chk "definición completa restaurada = fixture (sin espacios ni saltos)" "$(sin_espacios < "$TMP/remota.sql" | md5sum | cut -d' ' -f1)" "$(def_completa | sin_espacios | md5sum | cut -d' ' -f1)"
chk "sin objetos de la 237" "0" "$($PSQL -c "select (select count(*) from pg_policy where polname like 'catalogo global:%') + (select count(*) from pg_class where relnamespace='public'::regnamespace and relname in ('sesion_agencia','sesion_agencia_inicio','catalogos_funciones_previas_237')) + (select count(*) from pg_proc where pronamespace='public'::regnamespace and proname in ('agencia_activa_sesion','puede_escribir_catalogo_global','iniciar_contexto_agencia','cambiar_contexto_agencia','catalogos_globales_registro'))")"

paso "7. PREFLIGHT otra vez (debe volver a LISTO) y REAPLICAR + POSTCHECK"
V=$(veredicto "$S/preflight_237_catalogos_globales.sql"); echo "$V"
chk "preflight tras el rollback" "VEREDICTO | LISTO PARA APLICAR | LISTO PARA APLICAR | OK" "$V"
$PSQLF < "$M" 2>&1 | tail -1
V=$(veredicto "$S/postcheck_237_catalogos_globales.sql"); echo "$V"
chk "postcheck tras reaplicar" "VEREDICTO | CORRECTO | CORRECTO | OK" "$V"

echo; if [ "$FALLAS" -eq 0 ]; then echo "RESUMEN FASES: todos los controles PASAN"; else echo "RESUMEN FASES: $FALLAS control(es) FALLAN"; exit 1; fi
