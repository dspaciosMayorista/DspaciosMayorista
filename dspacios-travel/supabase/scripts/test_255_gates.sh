#!/bin/sh
# ────────────────────────────────────────────────────────
# GATES SQL DE LA 255 EN UN POSTGRES LOCAL DESECHABLE (nunca la base compartida).
# Orden: auditoría de servicios sin vigencia → preflight → migración 255 → postcheck → test_255_franjas.sql →
#        solapes CONCURRENTES (2 sesiones) → rollback → estado tras el rollback.
# Uso (desde dspacios-travel/):  sh supabase/scripts/test_255_gates.sh <contenedor> [base]
#   contenedor  contenedor desechable con el esquema HASTA la 254 ya preparado (preparar_esquema_local.sh, con 3er argumento plantilla255).
#   base        base de la que se clona (por defecto plantilla255).
# ────────────────────────────────────────────────────────
set -u
CT="${1:-}"; PLANT="${2:-plantilla255}"
export MSYS_NO_PATHCONV=1
printf '%s' "$CT" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$' || { echo "Uso: test_255_gates.sh <contenedor> [base]" >&2; exit 2; }
printf '%s' "$PLANT" | grep -Eq '^[a-z0-9_]+$' || { echo "base inválida" >&2; exit 2; }
AQUI="$(cd "$(dirname "$0")" && pwd)"; MIG="$AQUI/../migrations/20260601000255_servicio_suplementos_franja.sql"
DB=gate255
P() { docker exec -i -e PGPASSWORD=postgres "$CT" psql -h 127.0.0.1 -U supabase_admin -d "$DB" -v ON_ERROR_STOP=1 -X -q "$@"; }
PA() { docker exec -i -e PGPASSWORD=postgres "$CT" psql -h 127.0.0.1 -U supabase_admin -d "$DB" -X -t -A "$@"; }
PASO() { printf '\n══ %s\n' "$1"; }
FALLAS=0
fallo() { echo "  >> FALLA: $1"; FALLAS=$((FALLAS+1)); }

docker exec -e PGPASSWORD=postgres "$CT" psql -h 127.0.0.1 -U supabase_admin -d template1 -X -q -c "drop database if exists $DB" -c "create database $DB template $PLANT" || { echo "no se pudo clonar $PLANT"; exit 3; }

PASO "0a. migración 259 (ya aplicada en producción; el preflight de la 255 la exige)"
P < "$AQUI/../migrations/20260601000259_publicador_tarifario_limite_acotado.sql" >/dev/null 2>&1 && echo "  259 aplicada" || fallo "la 259 falló o no está en el árbol (integrar origin/main antes de correr este gate)"

PASO "0. auditoría de servicios sin vigencia (solo lectura; base local)"
P < "$AQUI/auditoria_255_servicios_sin_vigencia.sql" | head -30

PASO "1. preflight"
P < "$AQUI/preflight_255_servicio_suplementos_franja.sql" | tee /tmp/pf255.txt
grep -q "BLOQUEA" /tmp/pf255.txt && fallo "el preflight bloquea"

PASO "2. migración 255 (una transacción)"
P < "$MIG" && echo "  aplicada" || fallo "la migración falló"

PASO "3. postcheck"
P < "$AQUI/postcheck_255_servicio_suplementos_franja.sql" | tee /tmp/pc255.txt
grep -Eq "FALLA|BLOQUEA" /tmp/pc255.txt && fallo "el postcheck reporta FALLA"

PASO "4. test_255_franjas.sql"
P < "$AQUI/test_255_franjas.sql" | tee /tmp/t255.txt
grep -q "FALLA" /tmp/t255.txt && fallo "test_255_franjas.sql reporta FALLA"

PASO "5. solapes concurrentes (dos sesiones sobre la MISMA vigencia)"
P <<'SQL'
insert into public.servicios_adicionales (nombre) values ('__conc255__');
insert into public.servicio_temporadas (servicio_id, nombre, fecha_inicio, fecha_fin)
  select id, 'C1', '2026-01-01', '2026-12-31' from public.servicios_adicionales where nombre = '__conc255__';
SQL
VIG=$(PA -c "select t.id from public.servicio_temporadas t join public.servicios_adicionales s on s.id=t.servicio_id where s.nombre='__conc255__' and t.nombre='C1'")
ins() { echo "insert into public.servicio_suplementos_franja (servicio_temporada_id, hora_desde, hora_hasta, tramo, tipo, valor, cobro) values ($VIG, '$1', '$2', '$3', 'monto', 10000, 'grupo');"; }

# 5a. A (retiene 4 s) y B solapan: B debe ESPERAR el bloqueo y luego fallar con 23P01. Sin la serialización ambas entrarían.
( { echo "begin;"; ins 08:00 12:00 llegada; echo "select pg_sleep(4);"; echo "commit;"; } | P > /tmp/cA.txt 2>&1 ) &
sleep 1
T0=$(date +%s)
{ echo "begin;"; ins 10:00 14:00 llegada; echo "commit;"; } | P > /tmp/cB.txt 2>&1; RB=$?
T1=$(date +%s); wait
ESPERA=$((T1-T0))
N=$(PA -c "select count(*) from public.servicio_suplementos_franja where servicio_temporada_id=$VIG")
echo "  A: $(tr '\n' ' ' </tmp/cA.txt | cut -c1-80)| B (rc=$RB, esperó ${ESPERA}s): $(tr '\n' ' ' </tmp/cB.txt | cut -c1-200)"
[ "$RB" -ne 0 ] && grep -q "se solapa" /tmp/cB.txt && echo "  OK 5a: B rechazada por solape (23P01)" || fallo "5a: B no fue rechazada por solape"
[ "$ESPERA" -ge 2 ] && echo "  OK 5a: B esperó el bloqueo de A (${ESPERA}s) → la comprobación está serializada" || fallo "5a: B no esperó (${ESPERA}s): no hay serialización"
[ "$N" = "1" ] && echo "  OK 5a: queda 1 sola franja" || fallo "5a: quedaron $N franjas (esperado 1)"

# 5b. A y B NO solapan (tramos distintos, mismo horario): ambas deben entrar.
( { echo "begin;"; ins 20:00 23:00 llegada; echo "select pg_sleep(3);"; echo "commit;"; } | P > /tmp/cC.txt 2>&1 ) &
sleep 1
{ echo "begin;"; ins 20:00 23:00 salida; echo "commit;"; } | P > /tmp/cD.txt 2>&1; RD=$?
wait
N=$(PA -c "select count(*) from public.servicio_suplementos_franja where servicio_temporada_id=$VIG")
[ "$RD" -eq 0 ] && [ "$N" = "3" ] && echo "  OK 5b: tramos distintos no se bloquean entre sí (3 franjas)" || fallo "5b: rc=$RD franjas=$N (esperado 0 y 3)"

# 5c. 'ambos' contra una 'llegada' existente, concurrentes: la segunda debe fallar.
( { echo "begin;"; ins 05:00 07:00 ambos; echo "select pg_sleep(3);"; echo "commit;"; } | P > /tmp/cE.txt 2>&1 ) &
sleep 1
{ echo "begin;"; ins 06:00 06:30 salida; echo "commit;"; } | P > /tmp/cF.txt 2>&1; RF=$?
wait
[ "$RF" -ne 0 ] && grep -q "se solapa" /tmp/cF.txt && echo "  OK 5c: 'ambos' vs 'salida' concurrentes: segunda rechazada" || fallo "5c: la segunda no fue rechazada"

# 5d. 20 inserciones simultáneas del MISMO horario: exactamente 1 entra.
for i in $(seq 1 20); do ( { echo "begin;"; ins 15:00 16:00 llegada; echo "commit;"; } | P > /tmp/m$i.txt 2>&1 ) & done; wait
OK=0; for i in $(seq 1 20); do [ -z "$(grep -l 'ERROR' /tmp/m$i.txt)" ] && OK=$((OK+1)); done
N=$(PA -c "select count(*) from public.servicio_suplementos_franja where servicio_temporada_id=$VIG and hora_desde='15:00'")
[ "$OK" -eq 1 ] && [ "$N" = "1" ] && echo "  OK 5d: de 20 simultáneas entró exactamente 1" || fallo "5d: entraron $OK (filas $N), esperado 1"

PASO "6. rollback"
# 6a. Con franjas cargadas el rollback DEBE negarse (guarda contra perder datos).
if P < "$AQUI/rollback_255_servicio_suplementos_franja.sql" > /tmp/rb1.txt 2>&1; then fallo "6a: el rollback borró una tabla con datos"; else grep -q "ROLLBACK 255 ABORTADO" /tmp/rb1.txt && echo "  OK 6a: con datos el rollback se niega (guarda)" || fallo "6a: falló por otra razón: $(head -c 200 /tmp/rb1.txt)"; fi
[ "$(PA -c "select to_regclass('public.servicio_suplementos_franja') is not null")" = "t" ] && echo "  OK 6a: la tabla y sus datos siguen intactos tras el rechazo" || fallo "6a: la tabla desapareció"
# 6b. Datos de prueba fuera (base desechable) y rollback real.
P -c "delete from public.servicio_suplementos_franja" && P < "$AQUI/rollback_255_servicio_suplementos_franja.sql" && echo "  OK 6b: rollback ejecutado sin datos" || fallo "6b: el rollback falló sin datos"
PA -c "select 'tabla tras rollback: ' || coalesce(to_regclass('public.servicio_suplementos_franja')::text, 'NO EXISTE')"
PA -c "select 'funciones fn_franja_*/tg_*solape tras rollback: ' || count(*) from pg_proc where proname in ('fn_franja_minutos','fn_franja_contiene','tg_servicio_suplementos_franja_solape')"
[ "$(PA -c "select to_regclass('public.servicio_suplementos_franja') is null")" = "t" ] && echo "  OK: la tabla ya no existe" || fallo "la tabla sigue existiendo tras el rollback"
[ "$(PA -c "select count(*) from pg_proc where proname in ('fn_franja_minutos','fn_franja_contiene','tg_servicio_suplementos_franja_solape')")" = "0" ] && echo "  OK: sin funciones residuales" || fallo "quedaron funciones tras el rollback"

PASO "7. re-aplicación tras el rollback (idempotencia) y limpieza"
P < "$MIG" && echo "  OK: la 255 se vuelve a aplicar limpia" || fallo "no se pudo reaplicar la 255 tras el rollback"
docker exec -e PGPASSWORD=postgres "$CT" psql -h 127.0.0.1 -U supabase_admin -d template1 -X -q -c "drop database if exists $DB"

printf '\n══ RESULTADO: '; [ "$FALLAS" -eq 0 ] && echo "TODOS LOS GATES OK" || echo "$FALLAS FALLA(S)"
exit "$FALLAS"
