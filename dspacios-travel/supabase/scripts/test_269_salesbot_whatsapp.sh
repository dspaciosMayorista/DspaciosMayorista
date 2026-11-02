#!/usr/bin/env bash
# Prueba SQL LOCAL de la migración 269 (canal WhatsApp de SalesBot, #56) en un contenedor desechable. NUNCA contra Supabase real.
#   preflight → migración → postcheck → 5 casos negativos del postcheck → concurrencia SQL (sesiones paralelas reales) → rollback → re-aplicar.
# Requisitos: Docker e imagen public.ecr.aws/supabase/postgres:15.8.1.085 ya descargada. Se corre desde dspacios-travel/:
#   sh supabase/scripts/test_269_salesbot_whatsapp.sh
set -eu
export MSYS_NO_PATHCONV=1
PG=pg269sql
SQL="docker exec -i -e PGPASSWORD=postgres $PG psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -q"
MIG=supabase/migrations/20260601000269_salesbot_whatsapp.sql
limpiar() { docker rm -f "$PG" >/dev/null 2>&1 || true; rm -rf "${TMPD:-/nonexistent}"; }
trap limpiar EXIT
limpiar
TMPD=$(mktemp -d)

docker run -d --name "$PG" -e POSTGRES_PASSWORD=postgres public.ecr.aws/supabase/postgres:15.8.1.085 >/dev/null
# La imagen arranca, se reinicia una vez al terminar su init y recién ahí queda estable: se espera dos veces.
esperar() { for i in $(seq 1 90); do docker exec -e PGPASSWORD=postgres "$PG" psql -U supabase_admin -d postgres -qtAc "select 1" >/dev/null 2>&1 && return 0; sleep 2; done; echo "Postgres no arrancó"; exit 1; }
esperar; sleep 10; esperar
$SQL -c "create table public.usuarios (id uuid primary key);" # única dependencia externa de la 269 (FK atendido_por)

echo "== preflight (antes) =="; PRE=$($SQL -tA -F' | ' -f - < supabase/scripts/preflight_269_salesbot_whatsapp.sql); echo "$PRE"; echo "$PRE" | grep -q PREFLIGHT_OK
$SQL -f - < "$MIG"
echo "== postcheck (después) =="; POST=$($SQL -tA -F' | ' -f - < supabase/scripts/postcheck_269_salesbot_whatsapp.sql); echo "$POST" | tail -1; echo "$POST" | grep -q VERIFICACION_OK
echo "== preflight con la 269 ya aplicada (debe avisar) =="; $SQL -tA -f - < supabase/scripts/preflight_269_salesbot_whatsapp.sql | grep -q PREFLIGHT_REVISAR && echo "  avisa: ya existe"

neg() { # nombre, sql que rompe, sql que restaura
  $SQL -c "$2"
  if $SQL -tA -f - < supabase/scripts/postcheck_269_salesbot_whatsapp.sql | grep -q VERIFICACION_OK; then echo "FALLA: el postcheck no detectó «$1»"; exit 1; fi
  echo "  detectado: $1"; $SQL -c "$3"
}
neg "anon con SELECT" "grant select on public.salesbot_wa_traspasos to anon;" "revoke select on public.salesbot_wa_traspasos from anon;"
neg "authenticated con INSERT" "grant insert on public.salesbot_wa_sesiones to authenticated;" "revoke insert on public.salesbot_wa_sesiones from authenticated;"
neg "policy creada" "create policy p on public.salesbot_wa_mensajes for select using (true);" "drop policy p on public.salesbot_wa_mensajes;"
neg "service_role sin UPDATE" "revoke update on public.salesbot_wa_mensajes from service_role;" "grant update on public.salesbot_wa_mensajes to service_role;"
neg "RLS apagada" "alter table public.salesbot_wa_sesiones disable row level security;" "alter table public.salesbot_wa_sesiones enable row level security;"
$SQL -tA -f - < supabase/scripts/postcheck_269_salesbot_whatsapp.sql | grep -q VERIFICACION_OK

echo "== concurrencia SQL: sesiones psql paralelas (las mismas sentencias condicionales que usa el canal) =="
paralelo() { # n, plantilla con {i}; imprime cuántas sesiones devolvieron una fila
  n=$1; sql=$2; rm -f "$TMPD"/p.*
  for i in $(seq 1 "$n"); do ( $SQL -tA -c "${sql//\{i\}/$i}" > "$TMPD/p.$i" 2>&1 ) & done; wait
  cat "$TMPD"/p.* | grep -c . || true
}
$SQL -c "insert into public.salesbot_wa_sesiones (wa_id, estado, actualizada) values ('573000000001', '{}', 'epoch');"
GANA=$(paralelo 12 "update public.salesbot_wa_sesiones set lock_por = 'm{i}', lock_hasta = now() + interval '90 seconds' where wa_id = '573000000001' and (lock_hasta is null or lock_hasta <= now() or lock_por = 'm{i}') returning wa_id;")
[ "$GANA" = "1" ] || { echo "FALLA: $GANA sesiones tomaron el turno (debía ser 1)"; exit 1; }; echo "  12 sesiones piden el turno → gana 1"
DUENO=$($SQL -tA -c "select lock_por from public.salesbot_wa_sesiones where wa_id = '573000000001'")
rm -f "$TMPD"/p.*
for ts in 560 510 600 530 580 520 570 540 590 550; do ( $SQL -tA -c "update public.salesbot_wa_sesiones set ultimo_ts = $ts where wa_id = '573000000001' and lock_por = '$DUENO' and ultimo_ts <= $ts returning ultimo_ts;" > "$TMPD/p.$ts" 2>&1 ) & done; wait
FIN=$($SQL -tA -c "select ultimo_ts from public.salesbot_wa_sesiones where wa_id = '573000000001'")
[ "$FIN" = "600" ] || { echo "FALLA: ultimo_ts final $FIN (debía ser 600)"; exit 1; }; echo "  10 avances en desorden → ultimo_ts final = 600 (nunca hacia atrás)"
[ "$($SQL -tA -c "update public.salesbot_wa_sesiones set ultimo_ts = 1 where wa_id = '573000000001' and lock_por = 'otro' and ultimo_ts <= 1 returning 1;" | wc -l)" = "0" ] && echo "  quien no es dueño del turno no escribe"
UNO=$(paralelo 12 "insert into public.salesbot_wa_traspasos (mensaje_id, wa_id) values ('wamid.X', '573000000001') on conflict (mensaje_id) do nothing returning id;")
[ "$UNO" = "1" ] || { echo "FALLA: $UNO traspasos insertados (debía ser 1)"; exit 1; }; echo "  12 reintentos del mismo mensaje → 1 solo traspaso"
UNO=$(paralelo 12 "update public.salesbot_wa_traspasos set aviso_proximo = now() + interval '5 minutes', aviso_intentos = aviso_intentos + 1 where mensaje_id = 'wamid.X' and avisado_en is null and aviso_proximo is null returning id;")
[ "$UNO" = "1" ] || { echo "FALLA: $UNO reclamos del aviso (debía ser 1)"; exit 1; }; echo "  12 corridas del cron reclaman el mismo aviso → gana 1"

echo "== rollback y re-aplicación =="
$SQL -f - < supabase/scripts/rollback_269_salesbot_whatsapp.sql
[ "$($SQL -tA -c "select count(*) from pg_class where relname like 'salesbot_wa_%' and relkind = 'r'")" = "0" ]
$SQL -tA -f - < supabase/scripts/preflight_269_salesbot_whatsapp.sql | grep -q PREFLIGHT_OK
$SQL -f - < "$MIG"
$SQL -tA -f - < supabase/scripts/postcheck_269_salesbot_whatsapp.sql | grep -q VERIFICACION_OK
echo "TODO OK"
