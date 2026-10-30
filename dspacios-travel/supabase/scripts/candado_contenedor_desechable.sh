#!/bin/sh
# ──────────────────────────────────────────────────────────────────
# CANDADO de contenedor para probar migraciones. Uso:  sh supabase/scripts/candado_contenedor_desechable.sh <contenedor>
# exit 0 = pasó las comprobaciones de abajo; != 0 = rechazado.
#
# QUÉ VERIFICA (con `docker inspect`, nada se deduce del nombre de un volumen):
#   1. el nombre empieza por pg (convención de los contenedores de prueba del repo),
#   2. el contenedor existe y está corriendo,
#   3. la imagen es supabase/postgres,
#   4. no tiene puertos publicados en el host (HostConfig.PortBindings vacío y ningún HostPort asignado),
#   5. no usa la red del host (NetworkMode != host),
#   6. montajes: se rechaza cualquier `bind`; `tmpfs` se acepta; un volumen solo se acepta si Docker lo marca como
#      ANÓNIMO (etiqueta com.docker.volume.anonymous en `docker volume inspect`). Un volumen con nombre, inexistente
#      o sin esa etiqueta se rechaza: si la procedencia desechable no se puede comprobar, se rechaza.
# QUÉ NO VERIFICA: que los datos del contenedor sean de prueba, ni aislamiento de red más allá de los puntos 4 y 5
# (p. ej. redes Docker compartidas con otros contenedores), ni qué hay dentro de la base. Quien lo use sigue siendo
# responsable de apuntar a un contenedor creado para esto (preparar_esquema_local.sh exige uno nuevo y vacío).
# ──────────────────────────────────────────────────────────────────
set -eu
export MSYS_NO_PATHCONV=1
CT="${1:-}"
TMPM="$(mktemp)"
trap 'rm -f "$TMPM"' EXIT
rechazo() { echo "CANDADO: $CT rechazado — $1" >&2; exit 3; }
printf '%s' "$CT" | grep -Eq '^pg[A-Za-z0-9_.-]{0,60}$' || rechazo "el nombre debe empezar por pg"
docker inspect "$CT" >/dev/null 2>&1 || rechazo "no existe"
[ "$(docker inspect -f '{{.State.Running}}' "$CT")" = true ] || rechazo "no está corriendo"
IMG="$(docker inspect -f '{{.Config.Image}}' "$CT")"
case "$IMG" in *supabase/postgres*) ;; *) rechazo "la imagen ($IMG) no es supabase/postgres";; esac
PB="$(docker inspect -f '{{json .HostConfig.PortBindings}}' "$CT")"
{ [ "$PB" = "{}" ] || [ "$PB" = "null" ]; } || rechazo "publica puertos en el host ($PB)"
HP="$(docker inspect -f '{{range $p, $c := .NetworkSettings.Ports}}{{range $c}}{{.HostPort}} {{end}}{{end}}' "$CT" | tr -d ' ')"
[ -z "$HP" ] || rechazo "tiene puertos del host asignados"
[ "$(docker inspect -f '{{.HostConfig.NetworkMode}}' "$CT")" != host ] || rechazo "usa la red del host"
docker inspect -f '{{range .Mounts}}{{.Type}}|{{.Name}}{{"\n"}}{{end}}' "$CT" > "$TMPM"
while IFS='|' read -r tipo nombre; do
  [ -n "$tipo" ] || continue
  case "$tipo" in
    tmpfs) ;;
    volume)
      [ -n "$nombre" ] || rechazo "montaje de volumen sin nombre verificable"
      docker volume inspect "$nombre" >/dev/null 2>&1 || rechazo "no se pudo inspeccionar el volumen montado; procedencia desechable no comprobable"
      docker volume inspect -f '{{json .Labels}}' "$nombre" | grep -q '"com.docker.volume.anonymous"' || rechazo "monta un volumen que Docker no marca como anónimo; procedencia desechable no comprobable"
      ;;
    *) rechazo "monta un recurso del host o de tipo no verificable ($tipo)";;
  esac
done < "$TMPM"
echo "CANDADO: $CT pasó las comprobaciones (nombre pg*, imagen supabase/postgres, sin puertos publicados, sin red host, montajes solo tmpfs o volúmenes anónimos). No verifica que los datos sean de prueba ni otro aislamiento."
