#!/bin/bash
# ──────────────────────────────────────────────────────────────────
# CARRERAS · #35 cotizaciones comparativas (migración 211).
# VARIAS SESIONES REALES en paralelo, SOLO base LOCAL DESECHABLE dentro de un
# contenedor Docker propio (nunca remota). La base debe ser NUEVA (migraciones
# 001–211 recién aplicadas): las comparativas son inmutables y esta prueba
# COMMITEA sus datos, así que no se limpia; se descarta la base entera.
#
# Uso:  bash test_211_carrera.sh <base_desechable> [contenedor]
#
#   C1  dos sesiones consumen el MISMO recibo con la misma clave → la misma hija
#   C2  dos sesiones consumen el MISMO recibo con claves distintas → una sola gana
#   C3  dos recibos de opciones distintas a la vez → una sola hija activa
#   C4  8 solicitudes simultáneas de la MISMA IP → exactamente 3 (tope por IP/hora)
#   C5  6 solicitudes simultáneas del MISMO contacto → una sola pendiente
#   C6  58 solicitudes simultáneas de contactos e IP distintos → exactamente 50 (tope por madre)
#   C7  dos confirmaciones simultáneas de la MISMA solicitud → una sola hija
#   C8  dos confirmaciones simultáneas de solicitudes distintas → una sola hija activa
#   C9  elegir y descartar la madre a la vez → nunca queda una hija huérfana
# ──────────────────────────────────────────────────────────────────
set -u
DB="${1:-}"
CT="${2:-pg35_comparativas}"
if [ -z "$DB" ] || [ "$DB" = "postgres" ]; then
  echo "Indica una base desechable distinta de 'postgres'." >&2; exit 2
fi
if [ "${DENTRO_CONTENEDOR:-}" != 1 ]; then
  export MSYS_NO_PATHCONV=1
  AQUI="$(cd "$(dirname "$0")" && pwd)"
  docker cp "$(cygpath -w "$AQUI/test_211_fixtures.sql" 2>/dev/null || echo "$AQUI/test_211_fixtures.sql")" "$CT:/tmp/test_211_fixtures.sql"
  exec docker exec -i -w /tmp -e PGPASSWORD=postgres -e DENTRO_CONTENEDOR=1 "$CT" bash -s -- "$DB" "$CT" < "$0"
fi
PSQL="psql -h 127.0.0.1 -U supabase_admin -d $DB -X -q -t -A"
TMP="$(mktemp -d)"
FALLOS=0
ok()    { echo "OK    $1"; }
fallo() { echo "FALLO $1"; FALLOS=$((FALLOS + 1)); }

ADMIN=00000000-0000-0000-0000-000000211002
VENTA=00000000-0000-0000-0000-000000211003

# Fixtures (usuarios, aliados, funciones de armado). `begin`/`commit` explícitos: el archivo
# está pensado para correr dentro de una transacción de prueba, aquí la COMMITEAMOS.
$PSQL -v ON_ERROR_STOP=1 -c "begin;" -f /tmp/test_211_fixtures.sql -c "commit;" >/dev/null 2>"$TMP/fx.err" || { echo "No se pudieron crear las fixtures"; cat "$TMP/fx.err"; exit 2; }

# Ejecuta SQL como authenticated con el JWT de un usuario; imprime la ÚLTIMA línea de salida o el error.
como_auth() {  # $1 uid, $2 sql
  printf "set request.jwt.claims = '{\\"sub\\":\\"%s\\",\\"role\\":\\"authenticated\\"}';
set request.jwt.claim.sub = '%s';
set role authenticated;
%s
" "$1" "$1" "$2" | $PSQL -v ON_ERROR_STOP=1 2>&1 | tr '
' ' ' | sed 's/ *$//'
}
como_service() {  # $1 sql
  printf "set role service_role;
%s
" "$1" | $PSQL -v ON_ERROR_STOP=1 2>&1 | tr '
' ' ' | sed 's/ *$//'
}
admin_sql() { $PSQL -v ON_ERROR_STOP=1 -c "$1"; }

nueva_madre() {  # imprime el id de una madre manual nueva
  $PSQL -v ON_ERROR_STOP=1 -c "select t211.madre_manual('$ADMIN');" | tail -1
}
recibo() {  # $1 madre, $2 opción, $3 total  → uuid
  $PSQL -v ON_ERROR_STOP=1 -c "select public.registrar_validacion_comparativa($1, '$2', 'unica', 1, 'interno', '$ADMIN', $3, 'COP', true, null);" | tail -1
}
hijas_activas() { $PSQL -c "select count(*) from public.cotizaciones where cotizacion_origen_id = $1 and estado <> 'descartada';" | tail -1; }
hijas_total()   { $PSQL -c "select count(*) from public.cotizaciones where cotizacion_origen_id = $1;" | tail -1; }

# ── C1 · mismo recibo, misma clave, dos sesiones ─────────────────────────────
M=$(nueva_madre); R=$(recibo $M A 1600000)
como_auth $ADMIN "select public.elegir_opcion_comparativa_sesion('$R', 'c1-clave-0001');" > "$TMP/c1a" &
como_auth $ADMIN "select public.elegir_opcion_comparativa_sesion('$R', 'c1-clave-0001');" > "$TMP/c1b" &
wait
A=$(cat "$TMP/c1a"); B=$(cat "$TMP/c1b")
if [ "$A" = "$B" ] && echo "$A" | grep -qE '^[0-9]+$' && [ "$(hijas_total $M)" = 1 ]; then ok "C1 mismo recibo y clave: ambas sesiones obtienen LA MISMA hija ($A) y existe una sola"; else fallo "C1 (a=$A b=$B total=$(hijas_total $M))"; fi

# ── C2 · mismo recibo, claves distintas ──────────────────────────────────────
M=$(nueva_madre); R=$(recibo $M A 1600000)
como_auth $ADMIN "select public.elegir_opcion_comparativa_sesion('$R', 'c2-clave-AAAA');" > "$TMP/c2a" &
como_auth $ADMIN "select public.elegir_opcion_comparativa_sesion('$R', 'c2-clave-BBBB');" > "$TMP/c2b" &
wait
A=$(cat "$TMP/c2a"); B=$(cat "$TMP/c2b")
GAN=0; echo "$A" | grep -qE '^[0-9]+$' && GAN=$((GAN+1)); echo "$B" | grep -qE '^[0-9]+$' && GAN=$((GAN+1))
if [ "$GAN" = 1 ] && [ "$(hijas_total $M)" = 1 ] && (echo "$A$B" | grep -q 'ya fue usado'); then ok "C2 mismo recibo con claves distintas: gana UNA, la otra recibe «ya fue usado»"; else fallo "C2 (a=$A b=$B ganan=$GAN)"; fi

# ── C3 · dos recibos de opciones distintas ───────────────────────────────────
M=$(nueva_madre); RA=$(recibo $M A 1600000); RB=$(recibo $M B 1800000)
como_auth $ADMIN "select public.elegir_opcion_comparativa_sesion('$RA', 'c3-clave-AAAA');" > "$TMP/c3a" &
como_auth $ADMIN "select public.elegir_opcion_comparativa_sesion('$RB', 'c3-clave-BBBB');" > "$TMP/c3b" &
wait
A=$(cat "$TMP/c3a"); B=$(cat "$TMP/c3b")
if [ "$(hijas_activas $M)" = 1 ] && [ "$(hijas_total $M)" = 1 ] && (echo "$A$B" | grep -q 'HIJA_ACTIVA'); then ok "C3 dos opciones a la vez: UNA sola hija activa; la otra recibe HIJA_ACTIVA"; else fallo "C3 (a=$A b=$B activas=$(hijas_activas $M))"; fi
# el perdedor NO consumió su recibo ni dejó evento
PERD=$($PSQL -c "select count(*) from public.cotizacion_comparativa_validaciones where cotizacion_id = $M and consumida_en is null;" | tail -1)
EVT=$($PSQL -c "select count(*) from public.cotizacion_comparativa_eventos where cotizacion_id = $M and tipo = 'elegida';" | tail -1)
if [ "$PERD" = 1 ] && [ "$EVT" = 1 ]; then ok "C3b el intento perdedor no consumió su recibo ni dejó evento"; else fallo "C3b (sin_consumir=$PERD eventos_elegida=$EVT)"; fi

# ── C4 · 8 solicitudes de la MISMA IP ────────────────────────────────────────
M=$(nueva_madre)
for i in 1 2 3 4 5 6 7 8; do
  como_service "select public.registrar_solicitud_comparativa($M, 'A', 'unica', 1, 'Persona $i', '31700000$i$i', null, null, 'c4-clave-000$i', 'ip-c4');" > "$TMP/c4_$i" &
done
wait
OKS=0; for i in 1 2 3 4 5 6 7 8; do grep -q '"id"' "$TMP/c4_$i" && OKS=$((OKS+1)); done
PEND=$($PSQL -c "select count(*) from public.cotizacion_comparativa_solicitudes where cotizacion_id = $M and estado = 'pendiente';" | tail -1)
if [ "$OKS" = 3 ] && [ "$PEND" = 3 ]; then ok "C4 8 solicitudes simultáneas de la misma IP: exactamente 3 pasan (tope por IP/hora)"; else fallo "C4 (pasaron=$OKS pendientes=$PEND)"; fi

# ── C5 · 6 solicitudes simultáneas del MISMO contacto ────────────────────────
M=$(nueva_madre)
for i in 1 2 3 4 5 6; do
  como_service "select public.registrar_solicitud_comparativa($M, 'A', 'unica', 1, 'Misma Persona', '3180000000', null, null, 'c5-clave-000$i', 'ip-c5-$i');" > "$TMP/c5_$i" &
done
wait
PEND=$($PSQL -c "select count(*) from public.cotizacion_comparativa_solicitudes where cotizacion_id = $M and estado = 'pendiente';" | tail -1)
ERR=0; for i in 1 2 3 4 5 6; do grep -q 'ERROR' "$TMP/c5_$i" && ERR=$((ERR+1)); done
if [ "$PEND" = 1 ] && [ "$ERR" = 0 ]; then ok "C5 6 solicitudes simultáneas del mismo contacto: UNA pendiente y ningún error (se reconoce a la persona)"; else fallo "C5 (pendientes=$PEND errores=$ERR)"; fi

# ── C6 · tope de 50 pendientes por madre con 58 solicitudes a la vez ─────────
M=$(nueva_madre)
for i in $(seq 1 58); do
  n=$(printf '%03d' $i)
  como_service "select public.registrar_solicitud_comparativa($M, 'A', 'unica', 1, 'Lote $n', '3190000$n', null, null, 'c6-clave-$n', 'ip-c6-$n');" > "$TMP/c6_$i" &
  # tandas de 15 para no agotar conexiones
  if [ $((i % 15)) = 0 ]; then wait; fi
done
wait
PEND=$($PSQL -c "select count(*) from public.cotizacion_comparativa_solicitudes where cotizacion_id = $M and estado = 'pendiente';" | tail -1)
LIM=0; for i in $(seq 1 58); do grep -q 'LIMITE' "$TMP/c6_$i" && LIM=$((LIM+1)); done
if [ "$PEND" = 50 ] && [ "$LIM" = 8 ]; then ok "C6 58 solicitudes simultáneas: exactamente 50 pendientes y 8 limitadas (tope por madre exacto)"; else fallo "C6 (pendientes=$PEND limitadas=$LIM)"; fi
# la madre sigue eligible aunque esté al tope
R=$(recibo $M A 1600000)
H=$(como_auth $ADMIN "select public.elegir_opcion_comparativa_sesion('$R', 'c6-eleccion-1');")
if echo "$H" | grep -qE '^[0-9]+$'; then ok "C6b con 50 solicitudes pendientes la madre sigue pudiendo elegirse (nadie la monopoliza)"; else fallo "C6b ($H)"; fi

# ── C7 · dos confirmaciones de la MISMA solicitud ────────────────────────────
M=$(nueva_madre)
S=$(como_service "select (public.registrar_solicitud_comparativa($M, 'A', 'unica', 1, 'Ana Siete', '3201111111', null, null, 'c7-clave-0001', 'ip-c7') ->> 'id');")
como_auth $VENTA "select public.resolver_solicitud_comparativa($S, 'confirmar', null, 'c7-res-AAAA');" > "$TMP/c7a" &
como_auth $ADMIN "select public.resolver_solicitud_comparativa($S, 'confirmar', null, 'c7-res-BBBB');" > "$TMP/c7b" &
wait
A=$(cat "$TMP/c7a"); B=$(cat "$TMP/c7b")
if [ "$A" = "$B" ] && echo "$A" | grep -qE '^[0-9]+$' && [ "$(hijas_total $M)" = 1 ]; then ok "C7 dos confirmaciones de la misma solicitud: una sola hija ($A) para ambas"; else fallo "C7 (a=$A b=$B total=$(hijas_total $M))"; fi

# ── C8 · confirmaciones de solicitudes DISTINTAS a la vez ────────────────────
M=$(nueva_madre)
S1=$(como_service "select (public.registrar_solicitud_comparativa($M, 'A', 'unica', 1, 'Ana Ocho', '3202222221', null, null, 'c8-clave-0001', 'ip-c8a') ->> 'id');")
S2=$(como_service "select (public.registrar_solicitud_comparativa($M, 'B', 'unica', 1, 'Beto Ocho', '3202222222', null, null, 'c8-clave-0002', 'ip-c8b') ->> 'id');")
como_auth $VENTA "select public.resolver_solicitud_comparativa($S1, 'confirmar', null, 'c8-res-AAAA');" > "$TMP/c8a" &
como_auth $ADMIN "select public.resolver_solicitud_comparativa($S2, 'confirmar', null, 'c8-res-BBBB');" > "$TMP/c8b" &
wait
A=$(cat "$TMP/c8a"); B=$(cat "$TMP/c8b")
if [ "$(hijas_activas $M)" = 1 ] && [ "$(hijas_total $M)" = 1 ] && ! echo "$A$B" | grep -qi 'deadlock'; then ok "C8 confirmaciones de solicitudes distintas: UNA sola hija activa (a=$A | b=${B:0:60})"; else fallo "C8 (a=$A b=$B activas=$(hijas_activas $M))"; fi

# ── C8b · repetir C8 varias veces: nunca un deadlock ──────────────────────────
for ronda in 1 2 3 4 5 6 7 8; do
  M=$(nueva_madre)
  S1=$(como_service "select (public.registrar_solicitud_comparativa($M, 'A', 'unica', 1, 'Ana R$ronda', '32030000${ronda}1', null, null, 'c8r-clave-A$ronda', 'ip-c8r-a$ronda') ->> 'id');")
  S2=$(como_service "select (public.registrar_solicitud_comparativa($M, 'B', 'unica', 1, 'Beto R$ronda', '32030000${ronda}2', null, null, 'c8r-clave-B$ronda', 'ip-c8r-b$ronda') ->> 'id');")
  como_auth $VENTA "select public.resolver_solicitud_comparativa($S1, 'confirmar', null, 'c8r-res-A$ronda');" > "$TMP/c8ra" &
  como_auth $ADMIN "select public.resolver_solicitud_comparativa($S2, 'confirmar', null, 'c8r-res-B$ronda');" > "$TMP/c8rb" &
  wait
  if grep -qi 'deadlock' "$TMP/c8ra" "$TMP/c8rb" || [ "$(hijas_activas $M)" != 1 ]; then fallo "C8b ronda $ronda (deadlock o hijas activas=$(hijas_activas $M))"; fi
done
[ "$FALLOS" = 0 ] && ok "C8b 8 rondas de confirmaciones simultáneas distintas: sin deadlock y siempre UNA hija activa" || true

# ── C9 · elegir y descartar la madre a la vez ────────────────────────────────
for ronda in 1 2 3 4 5 6; do
  M=$(nueva_madre); R=$(recibo $M A 1600000)
  como_auth $ADMIN "select public.elegir_opcion_comparativa_sesion('$R', 'c9-clave-000$ronda');" > "$TMP/c9a" &
  como_auth $ADMIN "update public.cotizaciones set estado = 'descartada' where id = $M;" > "$TMP/c9b" &
  wait
  MAD=$($PSQL -c "select estado from public.cotizaciones where id = $M;" | tail -1)
  ACT=$(hijas_activas $M)
  # Invariante: una madre descartada NUNCA tiene hija activa.
  if [ "$MAD" = descartada ] && [ "$ACT" != 0 ]; then fallo "C9 ronda $ronda: madre descartada con hija activa"; continue; fi
done
[ "$FALLOS" = 0 ] && ok "C9 6 rondas de elegir vs descartar la madre: nunca una madre descartada con hija activa" || true

rm -rf "$TMP"
echo "---"
if [ "$FALLOS" = 0 ]; then echo "TODAS LAS CARRERAS OK"; else echo "FALLOS: $FALLOS"; exit 1; fi
