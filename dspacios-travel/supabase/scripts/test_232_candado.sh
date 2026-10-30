#!/bin/sh
# Prueba positiva y negativa de candado_contenedor_desechable.sh con contenedores mínimos (sin base de datos:
# `--entrypoint sleep`). Uso (desde dspacios-travel/):
#   sh supabase/scripts/test_232_candado.sh <contenedor-bueno> [imagen-supabase]
#
# SEGURIDAD DE LIMPIEZA: los nombres llevan un sufijo único por ejecución; antes de crear nada se comprueba que NINGÚN
# nombre/volumen previsto exista (si existe, se ABORTA sin tocarlo); los IDs de contenedor y los nombres de volumen que
# crea este script se registran y la limpieza borra EXCLUSIVAMENTE esos registros. Nunca se borra nada por nombre.
set -eu
export MSYS_NO_PATHCONV=1
BUENO="${1:-}"
IMG="${2:-public.ecr.aws/supabase/postgres:15.8.1.085}"
AQUI="$(cd "$(dirname "$0")" && pwd)"
C="sh $AQUI/candado_contenedor_desechable.sh"
SUF="${SUFIJO_232:-$(od -An -N4 -tx1 /dev/urandom | tr -d ' \n')}"
OKS=0; FALLOS=0
ok()    { echo "OK    $1"; OKS=$((OKS + 1)); }
fallo() { echo "FALLO $1"; FALLOS=$((FALLOS + 1)); }
TMPD="$(mktemp -d)"
IDS="$TMPD/ids_contenedores"; VOLS="$TMPD/vols_creados"; : > "$IDS"; : > "$VOLS"
limpiar() {
  # Solo lo registrado por esta ejecución.
  while read -r id; do [ -z "$id" ] || docker rm -f -v "$id" >/dev/null 2>&1 || true; done < "$IDS"
  while read -r v; do [ -z "$v" ] || docker volume rm "$v" >/dev/null 2>&1 || true; done < "$VOLS"
  rm -rf "$TMPD"
}
trap limpiar EXIT

N_PUERTO="pg_t232_${SUF}_puerto"; N_OTRO="t232o_${SUF}"; N_BIND="pg_t232_${SUF}_bind"; N_PARADO="pg_t232_${SUF}_parado"
N_IMG="pg_t232_${SUF}_otraimg"; N_HOST="pg_t232_${SUF}_host"; N_ANON="pg_t232_${SUF}_anonimo"; N_VOLC="pg_t232_${SUF}_volnombre"
N_CENT="pg_t232_${SUF}_centinela"; V_NOMBRE="t232_vol_${SUF}"

# Colisiones: se aborta SIN borrar ni modificar nada.
for n in $N_PUERTO $N_OTRO $N_BIND $N_PARADO $N_IMG $N_HOST $N_ANON $N_VOLC $N_CENT; do
  if docker inspect --type container "$n" >/dev/null 2>&1; then echo "ABORTADO por colisión: ya existe un contenedor llamado $n. No se tocó nada." >&2; exit 4; fi
done
if docker volume inspect "$V_NOMBRE" >/dev/null 2>&1; then echo "ABORTADO por colisión: ya existe el volumen $V_NOMBRE. No se tocó nada." >&2; exit 4; fi

# Crea un contenedor PROPIO y registra su ID. Nunca reemplaza: si el nombre existe, falla sin tocarlo.
crear() { # $1 = nombre, resto = argumentos de docker run
  nombre="$1"; shift
  if docker inspect --type container "$nombre" >/dev/null 2>&1; then echo "colisión: $nombre ya existe; no se crea ni se toca" >&2; return 4; fi
  id="$(docker run -d --name "$nombre" "$@")" || return 1
  printf '%s\n' "$id" >> "$IDS"
}
espera_rechazo() { # $1 nombre  $2 texto esperado en el motivo
  salida="$($C "$1" 2>&1 || true)"; $C "$1" >/dev/null 2>&1 && rc=0 || rc=$?
  if [ "$rc" -ne 0 ] && printf '%s' "$salida" | grep -q "$2"; then ok "rechazado ($2): $1"; else fallo "$1 debía rechazarse por '$2' -> rc=$rc $salida"; fi
}

$C "$BUENO" >/dev/null 2>&1 && ok "pasa las comprobaciones el contenedor $BUENO" || fallo "no pasa $BUENO"

crear "$N_PUERTO" -p 127.0.0.1:0:5432 --entrypoint sleep "$IMG" 300 >/dev/null
espera_rechazo "$N_PUERTO" "puertos"
crear "$N_OTRO" --entrypoint sleep "$IMG" 300 >/dev/null
espera_rechazo "$N_OTRO" "nombre"
crear "$N_BIND" -v "$TMPD:/datos" --entrypoint sleep "$IMG" 300 >/dev/null
espera_rechazo "$N_BIND" "recurso del host"
crear "$N_PARADO" --entrypoint sleep "$IMG" 300 >/dev/null; docker stop -t 1 "$N_PARADO" >/dev/null
espera_rechazo "$N_PARADO" "no está corriendo"

# Volumen CON NOMBRE creado por este script: nombre de longitud cualquiera, nunca se acepta por su longitud.
docker volume create "$V_NOMBRE" >/dev/null; printf '%s\n' "$V_NOMBRE" >> "$VOLS"
crear "$N_VOLC" -v "$V_NOMBRE:/datos" --entrypoint sleep "$IMG" 300 >/dev/null
espera_rechazo "$N_VOLC" "no marca como anónimo"

# Volumen ANÓNIMO real (creado por Docker con el contenedor): se acepta porque Docker lo etiqueta como tal.
crear "$N_ANON" -v /datos_anonimos --entrypoint sleep "$IMG" 300 >/dev/null
if $C "$N_ANON" >/dev/null 2>"$TMPD/anon.err"; then ok "acepta un volumen anónimo comprobado por la etiqueta de Docker: $N_ANON"; else fallo "volumen anónimo rechazado: $(cat "$TMPD/anon.err")"; fi

if docker image inspect busybox >/dev/null 2>&1 || docker pull -q busybox >/dev/null 2>&1; then
  crear "$N_IMG" busybox sleep 300 >/dev/null
  espera_rechazo "$N_IMG" "imagen"
else fallo "no se pudo obtener busybox para probar la imagen"; fi

if crear "$N_HOST" --network host --entrypoint sleep "$IMG" 300 >/dev/null 2>&1; then
  espera_rechazo "$N_HOST" "red del host"
else echo "OMITIDO --network host no disponible en este motor Docker"; fi

# ── Colisión con un contenedor PREEXISTENTE de nombre coincidente: se rechaza y NO se modifica ──────────────────
# El centinela hace de contenedor ajeno ya existente. Se toma su huella, se intenta crear otro con ese nombre (y se
# relanza este mismo script con un sufijo que lo hace chocar) y se comprueba que sigue idéntico y que nada se borró.
crear "$N_CENT" --entrypoint sleep "$IMG" 300 >/dev/null
huella() { docker inspect -f '{{.Id}} {{.Created}} {{.State.StartedAt}} {{.State.Running}} {{.Config.Image}} {{.HostConfig.PortBindings}}' "$N_CENT"; }
ANTES="$(huella)"; N_IDS_ANTES="$(wc -l < "$IDS" | tr -d ' ')"
if crear "$N_CENT" --entrypoint sleep "$IMG" 300 >/dev/null 2>"$TMPD/col.err"; then fallo "crear() reemplazó o duplicó un contenedor preexistente"; else grep -q colisión "$TMPD/col.err" && ok "crear() rechaza el nombre de un contenedor preexistente" || fallo "crear() falló sin explicar la colisión: $(cat "$TMPD/col.err")"; fi
[ "$(huella)" = "$ANTES" ] && ok "el contenedor preexistente no se modificó (mismo ID, creación, arranque y configuración)" || fallo "el preexistente cambió"
[ "$(wc -l < "$IDS" | tr -d ' ')" = "$N_IDS_ANTES" ] && ok "no se registró ningún ID nuevo tras la colisión" || fallo "se registró un ID tras la colisión"
if [ -z "${T232_ANIDADO:-}" ]; then
  # Ejecución completa anidada con el sufijo del centinela: parte del nombre ya existe -> debe ABORTAR sin tocar nada.
  SUF_CENT="$SUF"
  T232_ANIDADO=1 SUFIJO_232="$SUF_CENT" sh "$AQUI/test_232_candado.sh" "$BUENO" "$IMG" > "$TMPD/anidado.out" 2>&1 && rc=0 || rc=$?
  [ "$rc" = 4 ] && grep -q "ABORTADO por colisión: ya existe un contenedor llamado" "$TMPD/anidado.out" && ok "una segunda ejecución con el mismo sufijo ABORTA por colisión (rc=4)" || fallo "la ejecución anidada no abortó como se esperaba (rc=$rc): $(tail -2 "$TMPD/anidado.out")"
  [ "$(huella)" = "$ANTES" ] && ok "tras la ejecución anidada el preexistente sigue idéntico y en pie (no se borró por nombre)" || fallo "la ejecución anidada alteró al preexistente"
fi

[ "$(docker inspect -f '{{.State.Running}}' "$BUENO")" = true ] && ok "el contenedor bueno sigue intacto" || fallo "el bueno se alteró"
echo "Resultado candado: $OKS OK, $FALLOS FALLO"
[ "$FALLOS" -eq 0 ]
