#!/bin/sh
# ───────────────────────────────────────────────────────────────────────────
# PRUEBA LOCAL · migración 202 — CARRERA REAL al tomar un lead sin responsable.
#
# Dos conexiones de Postgres simultáneas. La sesión B (venta B) toma un lead sin
# responsable y deja la escritura ABIERTA (8 s, sin confirmar); la sesión A
# (venta A) intenta tomar ese mismo lead mientras tanto. Se comprueba que:
#   · A ESPERA el bloqueo de fila (> 1 s),
#   · A después RECHAZA con el mensaje de "ya tiene responsable",
#   · el lead queda con el dueño de B,
#   · hay UNA sola actividad de reasignación (nada duplicado).
# Además: edición concurrente (C4), dos cambios de etapa a la vez (C5) y la
# identidad documental bajo carrera (C6: mismo tipo+número → uno gana y el otro
# espera el índice y se rechaza; C7: mismo número con otro tipo y mismo teléfono
# → los dos entran sin esperarse).
#
# Base DESECHABLE en el contenedor de PostgreSQL local; se borra al final, pase
# o falle. NUNCA una base remota ni la de Supabase.
#
# Uso (desde dspacios-travel/):
#   sh supabase/scripts/pruebas/test_202_carreras.sh [contenedor]
# ───────────────────────────────────────────────────────────────────────────
set -eu
CT="${1:-supabase_db_sbqvrckukbjzhtzqpyzg}"
DB="carreras_202_$(date +%s)"
AQUI="$(cd "$(dirname "$0")" && pwd)"
MIG="$AQUI/../../migrations"
PSQL="psql -h 127.0.0.1 -U postgres -X -q -t -A -v ON_ERROR_STOP=1"
TMP="$(mktemp -d)"
FALLOS=0

limpiar() {
  docker exec -e PGPASSWORD=postgres "$CT" $PSQL -d postgres -c "drop database if exists $DB" >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
trap limpiar EXIT

sql() { docker exec -i -e PGPASSWORD=postgres "$CT" $PSQL -d "$DB" -f -; }

# Sesión como un usuario, con el MISMO JWT que deja PostgREST. El claim va a
# nivel de SESIÓN (`false`): en autocommit cada sentencia es su propia
# transacción, y un `set_config(..., true)` se perdería al terminar la anterior.
# Por eso el `begin;`/`commit;` de la sesión B sí es necesario: ahí el claim
# tiene que sobrevivir a varias sentencias.
como() { # $1 = uid
  printf '%s\n' \
    "select set_config('request.jwt.claims', '{\"sub\":\"$1\",\"role\":\"authenticated\"}', false);" \
    "set role authenticated;"
}

# ── Base desechable + cadena 1→201 + 203 + 202 ──────────────────────────────
docker exec -e PGPASSWORD=postgres "$CT" $PSQL -d postgres -c "create database $DB" >/dev/null
cat > "$TMP/andamiaje.sql" <<'SQL'
create schema if not exists auth;
create schema if not exists storage;
create schema if not exists extensions;
create or replace function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claims', true)::json->>'sub','')::uuid $$;
create or replace function auth.role() returns text language sql stable as
  $$ select nullif(current_setting('request.jwt.claims', true)::json->>'role','') $$;
create table if not exists auth.users (id uuid primary key default gen_random_uuid(), email text unique, raw_user_meta_data jsonb);
create table if not exists storage.buckets (id text primary key, name text, public boolean default false);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id),
  name text, owner uuid, created_at timestamptz default now(), updated_at timestamptz default now(),
  last_accessed_at timestamptz default now(), metadata jsonb
);
alter table storage.objects enable row level security;
grant usage on schema auth, storage, public to anon, authenticated, service_role;
grant all on all tables in schema storage to anon, authenticated, service_role;
SQL
sql < "$TMP/andamiaje.sql" >/dev/null

# `docker exec` no ve el disco del host: los archivos van por stdin con `-f -`.
# El reintento absorbe un reinicio del Postgres local por falta de memoria, que
# no es un fallo de la migración.
aplicar() { # $1 = ruta, $2 = "1" para forzar transacción única
  intentos=0
  while [ "$intentos" -lt 6 ]; do
    intentos=$((intentos + 1))
    if [ -n "${2:-}" ]; then
      docker exec -i -e PGPASSWORD=postgres "$CT" $PSQL --single-transaction -d "$DB" -f - < "$1" >/dev/null 2>"$TMP/mig.err"
    else
      docker exec -i -e PGPASSWORD=postgres "$CT" $PSQL -d "$DB" -f - < "$1" >/dev/null 2>"$TMP/mig.err"
    fi
    [ $? -eq 0 ] && return 0
    if grep -q 'recovery mode\|not accepting connections\|because of crash' "$TMP/mig.err"; then
      echo "   (Postgres local reiniciando; reintento $intentos/6)"
      sleep 20
      continue
    fi
    return 1
  done
  return 1
}

for f in "$MIG"/*.sql; do
  aplicar "$f" 1 || aplicar "$f" || { echo "FALLO al aplicar $(basename "$f")"; cat "$TMP/mig.err"; exit 1; }
done
aplicar "$MIG/20260601000202_crm_leads.sql" 1 || { echo "FALLO al aplicar la 202"; cat "$TMP/mig.err"; exit 1; }

# ── Usuarios: los dos asesores que compiten, y el equipo de cada agencia ─────
# Los de gerencia/administracion hacen falta para C0 (tomar valida rol Y tenant).
sql >/dev/null <<'SQL'
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000c201', 'super-may@local.test'),
  ('00000000-0000-0000-0000-00000000c202', 'ger-may@local.test'),
  ('00000000-0000-0000-0000-00000000c203', 'ger-min@local.test'),
  ('00000000-0000-0000-0000-00000000c205', 'adm-min@local.test'),
  ('00000000-0000-0000-0000-00000000c206', 'venta-a-may@local.test'),
  ('00000000-0000-0000-0000-00000000c207', 'venta-b-may@local.test');
update public.usuarios set rol = 'superadmin',    tenant = 'mayorista', activo = true, nombre = 'Super'  where id = '00000000-0000-0000-0000-00000000c201';
update public.usuarios set rol = 'gerencia',      tenant = 'mayorista', activo = true, nombre = 'G May'  where id = '00000000-0000-0000-0000-00000000c202';
update public.usuarios set rol = 'gerencia',      tenant = 'minorista', activo = true, nombre = 'G Min'  where id = '00000000-0000-0000-0000-00000000c203';
update public.usuarios set rol = 'administracion', tenant = 'minorista', activo = true, nombre = 'A Min'  where id = '00000000-0000-0000-0000-00000000c205';
update public.usuarios set rol = 'venta',         tenant = 'mayorista', activo = true, nombre = 'Venta A' where id = '00000000-0000-0000-0000-00000000c206';
update public.usuarios set rol = 'venta',         tenant = 'mayorista', activo = true, nombre = 'Venta B' where id = '00000000-0000-0000-0000-00000000c207';
insert into public.crm_leads (tenant, canal, nombre, telefono) values
  ('mayorista', 'whatsapp', 'Lead disputado', '3009990009'),
  ('mayorista', 'whatsapp', 'Lead en carrera', '3009990010');
SQL

ID_DISPUTADO="$(sql <<'SQL' 2>/dev/null
select id from public.crm_leads where nombre = 'Lead disputado';
SQL
)"
ID_DISPUTADO="$(printf '%s' "$ID_DISPUTADO" | tail -1)"
ID_CARRERA="$(sql <<'SQL' 2>/dev/null
select id from public.crm_leads where nombre = 'Lead en carrera';
SQL
)"
ID_CARRERA="$(printf '%s' "$ID_CARRERA" | tail -1)"

verificar() { # $1 = nombre, $2 = consulta que debe devolver t
  r="$(sql <<SQL 2>&1 | tail -1
$2
SQL
)"
  if [ "$r" = "t" ]; then echo "OK    $1"; else echo "FALLO $1: $r"; FALLOS=$((FALLOS + 1)); fi
}

# ── C0 · Tomar valida rol y tenant, tambien bajo concurrencia ──────────────
# `crm_lead_tomar` exige que el actor sea responsable valido del tenant del lead.
# Sin eso, superadmin y gerencia transversales se quedaban con leads de la otra
# agencia. Se comprueba en las dos agencias y con los roles que sí pueden.
#
# Los leads se crean con DML directo (no por RPC) porque `crm_lead_crear` exige
# sesion y este script corre sus fixtures como superusuario.
sql >/dev/null <<'SQL'
insert into public.crm_leads (tenant, canal, nombre) values
  ('mayorista', 'otro', 'Lead toma superadmin'),
  ('mayorista', 'otro', 'Lead toma equipo'),
  ('minorista', 'otro', 'Lead toma minorista');
SQL
lead_id() { # $1 = nombre
  sql <<SQL | tail -1
select id from public.crm_leads where nombre = '$1';
SQL
}
ID_TOMA_SUP="$(lead_id 'Lead toma superadmin')"
ID_TOMA_MAY="$(lead_id 'Lead toma equipo')"
ID_TOMA_MIN="$(lead_id 'Lead toma minorista')"
case "$ID_TOMA_SUP$ID_TOMA_MAY$ID_TOMA_MIN" in
  ''|*[!0-9]*) echo "FALLO no se pudieron crear los leads de C0: $ID_TOMA_SUP / $ID_TOMA_MAY / $ID_TOMA_MIN"; exit 1 ;;
esac

# superadmin: su rol no esta en la lista comercial, asi que no toma NINGUNA.
# Dos llamadas separadas porque `ON_ERROR_STOP` corta la sesion en el primer error.
rechaza_toma() { # $1 = uid, $2 = lead -> imprime OK o el error
  RES="$({ como "$1"
    echo "select public.crm_lead_tomar($2);"
  } | sql 2>&1 | tail -2)"
  if printf '%s' "$RES" | grep -qi 'ya tiene responsable o no te corresponde'; then
    echo "OK"
  else
    echo "no: $RES"
  fi
}
if [ "$(rechaza_toma 00000000-0000-0000-0000-00000000c201 "$ID_TOMA_SUP")" = "OK" ] \
   && [ "$(rechaza_toma 00000000-0000-0000-0000-00000000c201 "$ID_TOMA_MAY")" = "OK" ]; then
  echo "OK    C0 superadmin no puede tomar, ni en su agencia ni en la otra"
else
  echo "FALLO C0 superadmin: $(rechaza_toma 00000000-0000-0000-0000-00000000c201 "$ID_TOMA_MAY")"; FALLOS=$((FALLOS + 1))
fi
verificar "C0 superadmin no quedo como responsable de ninguno" \
  "select (select count(*) = 2 from public.crm_leads where id in ($ID_TOMA_SUP, $ID_TOMA_MAY) and responsable_id is null)"

# gerencia mayorista contra un lead de minorista: la tiene a la vista (alcada
# transversal) pero no puede tomarlo.
if [ "$(rechaza_toma 00000000-0000-0000-0000-00000000c202 "$ID_TOMA_MIN")" = "OK" ]; then
  echo "OK    C0 gerencia no puede tomar un lead de la otra agencia"
else
  echo "FALLO C0 gerencia: $(rechaza_toma 00000000-0000-0000-0000-00000000c202 "$ID_TOMA_MIN")"; FALLOS=$((FALLOS + 1))
fi
verificar "C0 el lead de minorista sigue sin responsable" \
  "select exists (select 1 from public.crm_leads where id = $ID_TOMA_MIN and responsable_id is null)"

# Y sí pueden cuando su rol y su tenant son válidos: gerencia, administracion y
# venta, cada uno en su agencia.
{ como 00000000-0000-0000-0000-00000000c202
  echo "select public.crm_lead_tomar($ID_TOMA_MAY);"
} | sql >/dev/null
verificar "C0 gerencia toma un lead sin responsable de SU agencia" \
  "select exists (select 1 from public.crm_leads where id = $ID_TOMA_MAY and responsable_id = '00000000-0000-0000-0000-00000000c202')"

# El mismo lead de minorista, ahora tomado por su propio equipo minorista.
{ como 00000000-0000-0000-0000-00000000c205
  echo "select public.crm_lead_tomar($ID_TOMA_MIN);"
} | sql >/dev/null
verificar "C0 administracion toma un lead sin responsable de SU agencia" \
  "select exists (select 1 from public.crm_leads where id = $ID_TOMA_MIN and responsable_id = '00000000-0000-0000-0000-00000000c205')"

# ── C1 · Toma simple: gana el que llega primero, con una sola bitácora ───────
{ como 00000000-0000-0000-0000-00000000c206
  echo "select public.crm_lead_tomar($ID_DISPUTADO);"
} | sql >/dev/null
verificar "C1 el lead queda con venta A" \
  "select exists (select 1 from public.crm_leads where id = $ID_DISPUTADO and responsable_id = '00000000-0000-0000-0000-00000000c206')"
verificar "C1 una sola actividad de reasignacion (nada duplicado)" \
  "select (select count(*) from public.crm_lead_actividades where lead_id = $ID_DISPUTADO and tipo = 'reasignacion') = 1"

# ── C2 · Un segundo asesor NO puede robarlo ─────────────────────────────────
RES="$({ como 00000000-0000-0000-0000-00000000c207
  echo "select public.crm_lead_tomar($ID_DISPUTADO);"
} | sql 2>&1 | tail -3)"
if printf '%s' "$RES" | grep -qi 'ya tiene responsable\|no te corresponde'; then
  echo "OK    C2 venta B recibe rechazo al tomar un lead ya tomado"
else
  echo "FALLO C2: $RES"; FALLOS=$((FALLOS + 1))
fi
verificar "C2 el lead sigue con venta A" \
  "select exists (select 1 from public.crm_leads where id = $ID_DISPUTADO and responsable_id = '00000000-0000-0000-0000-00000000c206')"

# ── C3 · CARRERA REAL: B toma y NO confirma; A intenta tomar al mismo tiempo ─
# B entra, toma el lead y se queda dentro de la transacción con un pg_sleep de
# 8 s. A espera a que B esté efectivamente en ese sleep (para que el arranque
# lento de `docker exec` no falsee la medición) y entonces intenta tomar.
printf '%s\n' "begin;" \
  "select set_config('request.jwt.claims', '{\"sub\":\"00000000-0000-0000-0000-00000000c207\",\"role\":\"authenticated\"}', true);" \
  "set role authenticated;" \
  "select public.crm_lead_tomar($ID_CARRERA);" \
  "select pg_sleep(8);" "commit;" \
  | docker exec -i -e PGPASSWORD=postgres -e PGAPPNAME=sesion_b "$CT" $PSQL -d "$DB" -f - > "$TMP/b.out" 2>&1 &

# A espera a que B esté de verdad dentro del `pg_sleep` antes de llamar a la RPC,
# para que el arranque lento de `docker exec` no falsee la medición del bloqueo.
# Esa espera va como superusuario (`pg_stat_activity` no es legible por
# `authenticated`); el cambio de rol, a continuación y a nivel de sesión.
printf '%s\n' \
  "do \$\$ declare i int := 0; begin
     loop
       perform pg_stat_clear_snapshot();
       exit when exists (select 1 from pg_stat_activity
                          where application_name = 'sesion_b' and state = 'active' and query like '%pg_sleep(8)%');
       i := i + 1;
       if i > 1200 then raise exception 'la sesion B no llego a su pg_sleep'; end if;
       perform pg_sleep(0.05);
     end loop;
   end \$\$;" \
  "select set_config('request.jwt.claims', '{\"sub\":\"00000000-0000-0000-0000-00000000c206\",\"role\":\"authenticated\"}', false);" \
  "set role authenticated;" \
  "do \$\$ declare t0 timestamptz := clock_timestamp(); r jsonb; begin
     begin
       r := public.crm_lead_tomar($ID_CARRERA);
       raise notice 'RESULTADO escribio % s %', round(extract(epoch from clock_timestamp() - t0)::numeric, 1), r;
     exception when others then
       raise notice 'RESULTADO rechazo % s | %', round(extract(epoch from clock_timestamp() - t0)::numeric, 1), sqlerrm;
     end;
   end \$\$;" \
  | docker exec -i -e PGPASSWORD=postgres "$CT" $PSQL -d "$DB" -f - > "$TMP/a.out" 2>&1
wait

OUT="$(grep RESULTADO "$TMP/a.out" | sed 's/.*RESULTADO //')"
SEG="$(printf '%s' "$OUT" | sed -n 's/^rechazo \([0-9.]*\) s.*/\1/p')"
if printf '%s' "$OUT" | grep -q '^rechazo' && printf '%s' "$OUT" | grep -qi 'ya tiene responsable\|no te corresponde' \
   && [ -n "$SEG" ] && [ "$(awk "BEGIN{print ($SEG >= 1.0)}")" = "1" ]; then
  echo "OK    C3 venta A espero el bloqueo ${SEG} s y fue rechazada"
else
  echo "FALLO C3: $OUT"; FALLOS=$((FALLOS + 1))
fi
verificar "C3 el lead en carrera quedo con venta B" \
  "select exists (select 1 from public.crm_leads where id = $ID_CARRERA and responsable_id = '00000000-0000-0000-0000-00000000c207')"
verificar "C3 una sola actividad de reasignacion en el lead en carrera" \
  "select (select count(*) from public.crm_lead_actividades where lead_id = $ID_CARRERA and tipo = 'reasignacion') = 1"
verificar "C3 ninguno de los dos leads duplico su reasignacion" \
  "select not exists (select 1
                          from public.crm_lead_actividades a
                          join public.crm_lead_actividades b
                            on a.lead_id = b.lead_id and a.id <> b.id
                         where a.tipo = 'reasignacion' and b.tipo = 'reasignacion'
                           and a.lead_id in ($ID_DISPUTADO, $ID_CARRERA))"

# ── C4 · Edición concurrente: el bloqueo serializa y la bitácora no miente ───
# Un asesor toma L4 y lo deja bloqueado sin confirmar. El otro intenta editarlo
# en la misma fila: debe ESPERAR el bloqueo y, al continuar, ver el responsable
# nuevo. Si la comprobación de visibilidad corriera sobre una lectura previa sin
# candado, editaría un lead que ya no es suyo.
nuevo_lead() { # $1 = nombre, $2 = telefono
  sql <<SQL >/dev/null
insert into public.crm_leads (tenant, canal, nombre, telefono)
  values ('mayorista', 'whatsapp', '$1', '$2');
SQL
  sql <<SQL | tail -1
select id from public.crm_leads where nombre = '$1';
SQL
}

ID_EDIT="$(nuevo_lead 'Lead editado en carrera' '3009990011')"

printf '%s\n' "begin;" \
  "select set_config('request.jwt.claims', '{\"sub\":\"00000000-0000-0000-0000-00000000c206\",\"role\":\"authenticated\"}', true);" \
  "set role authenticated;" \
  "select public.crm_lead_tomar($ID_EDIT);" \
  "select pg_sleep(8);" "commit;" \
  | docker exec -i -e PGPASSWORD=postgres -e PGAPPNAME=sesion_b "$CT" $PSQL -d "$DB" -f - > "$TMP/b.out" 2>&1 &

# A (venta B) intenta cambiar la etapa de un lead que A (venta A) acaba de tomar.
printf '%s\n' \
  "do \$\$ declare i int := 0; begin
     loop
       perform pg_stat_clear_snapshot();
       exit when exists (select 1 from pg_stat_activity
                          where application_name = 'sesion_b' and state = 'active' and query like '%pg_sleep(8)%');
       i := i + 1;
       if i > 1200 then raise exception 'la sesion B no llego a su pg_sleep'; end if;
       perform pg_sleep(0.05);
     end loop;
   end \$\$;" \
  "select set_config('request.jwt.claims', '{\"sub\":\"00000000-0000-0000-0000-00000000c207\",\"role\":\"authenticated\"}', false);" \
  "set role authenticated;" \
  "do \$\$ declare t0 timestamptz := clock_timestamp(); r jsonb; begin
     begin
       r := public.crm_lead_cambiar_etapa($ID_EDIT, 'calificado');
       raise notice 'RESULTADO escribio % s %', round(extract(epoch from clock_timestamp() - t0)::numeric, 1), r;
     exception when others then
       raise notice 'RESULTADO rechazo % s | %', round(extract(epoch from clock_timestamp() - t0)::numeric, 1), sqlerrm;
     end;
   end \$\$;" \
  | docker exec -i -e PGPASSWORD=postgres "$CT" $PSQL -d "$DB" -f - > "$TMP/c.out" 2>&1
wait

OUT="$(grep RESULTADO "$TMP/c.out" | sed 's/.*RESULTADO //')"
SEG="$(printf '%s' "$OUT" | sed -n 's/^rechazo \([0-9.]*\) s.*/\1/p')"
if printf '%s' "$OUT" | grep -q '^rechazo' && printf '%s' "$OUT" | grep -qi 'no encontrado o sin permiso' \
   && [ -n "$SEG" ] && [ "$(awk "BEGIN{print ($SEG >= 1.0)}")" = "1" ]; then
  echo "OK    C4 editar un lead tomado por otro espero el bloqueo ${SEG} s y fue rechazada"
else
  echo "FALLO C4: $OUT"; FALLOS=$((FALLOS + 1))
fi
verificar "C4 el lead sigue con venta A y en su etapa original" \
  "select exists (select 1 from public.crm_leads
                    where id = $ID_EDIT
                      and responsable_id = '00000000-0000-0000-0000-00000000c206'
                      and etapa = 'nuevo')"
verificar "C4 el rechazo no dejo ninguna actividad de etapa" \
  "select not exists (select 1 from public.crm_lead_actividades
                       where lead_id = $ID_EDIT and tipo in ('cambio_etapa', 'cierre'))"

# ── C5 · Dos cambios de etapa a la vez: bitácora exacta, sin saltos inventados ─
# Dos sesiones del MISMO asesor (venta A) sobre el mismo lead desde 'nuevo'. La
# primera entra, cambia a 'en_contacto' y no confirma; la segunda arranca mientras
# la fila esta bloqueada y pide 'calificado'. Como `crm_lead_cambiar_etapa` bloquea
# con `for update` ANTES de leer, la segunda ve la etapa que escribio la primera:
# su bitacora debe decir 'en_contacto -> calificado'. Un 'antes' obsoleto
# ('nuevo -> calificado') seria una bitacora que miente sobre el recorrido real.
ID_ETAPA="$(nuevo_lead 'Lead con dos etapas' '3009990012')"

# y arranca durante el bloqueo de x: espera a ver a x dormida y entonces escribe.
# El `do` de espera corre como superusuario (pg_stat_activity no es legible por
# `authenticated`) y el cambio de rol, a continuación y a nivel de sesión.
printf '%s\n' \
  "do \$\$ declare i int := 0; begin
     loop
       perform pg_stat_clear_snapshot();
       exit when exists (select 1 from pg_stat_activity
                          where application_name = 'sesion_x' and state = 'active' and query like '%pg_sleep(6)%');
       i := i + 1;
       if i > 1200 then raise exception 'la sesion x no llego a su pg_sleep'; end if;
       perform pg_sleep(0.05);
     end loop;
   end \$\$;" \
  "select set_config('request.jwt.claims', '{\"sub\":\"00000000-0000-0000-0000-00000000c206\",\"role\":\"authenticated\"}', false);" \
  "set role authenticated;" \
  "do \$\$ declare r jsonb; begin
     begin
       r := public.crm_lead_cambiar_etapa($ID_ETAPA, 'calificado');
       raise notice 'RESULTADO y escribio %', r;
     exception when others then
       raise notice 'RESULTADO y rechazo %', sqlerrm;
     end;
   end \$\$;" \
  | docker exec -i -e PGPASSWORD=postgres -e PGAPPNAME=sesion_y "$CT" $PSQL -d "$DB" -f - > "$TMP/y.out" 2>&1 &

printf '%s\n' "begin;" \
  "select set_config('request.jwt.claims', '{\"sub\":\"00000000-0000-0000-0000-00000000c206\",\"role\":\"authenticated\"}', true);" \
  "set role authenticated;" \
  "select public.crm_lead_tomar($ID_ETAPA);" \
  "select public.crm_lead_cambiar_etapa($ID_ETAPA, 'en_contacto');" \
  "select pg_sleep(6);" "commit;" \
  | docker exec -i -e PGPASSWORD=postgres -e PGAPPNAME=sesion_x "$CT" $PSQL -d "$DB" -f - > "$TMP/x.out" 2>&1 &
wait

# Ambas escrituras deben haber pasado. La sesión x no usa el bloque `do` que
# imprime RESULTADO (su llamada va dentro de la transacción abierta), así que se
# comprueba por el propio `psql` de x: sin error y con la etapa ya escrita.
if grep -qi 'error' "$TMP/x.out"; then
  echo "FALLO C5: la sesion x dio error: $(tr '\n' ' ' < "$TMP/x.out")"; FALLOS=$((FALLOS + 1))
elif grep -q 'RESULTADO y escribio' "$TMP/y.out"; then
  echo "OK    C5 los dos cambios de etapa se aplicaron, serializados"
else
  echo "FALLO C5: la sesion y no escribio: $(tr '\n' ' ' < "$TMP/y.out")"; FALLOS=$((FALLOS + 1))
fi
verificar "C5 quedan exactamente dos actividades de cambio de etapa" \
  "select (select count(*) from public.crm_lead_actividades
            where lead_id = $ID_ETAPA and tipo = 'cambio_etapa') = 2"
# La cadena del "antes": la segunda debe decir 'en_contacto -> calificado', no
# 'nuevo -> calificado'. Un antes obsoleto seria una bitacora que miente.
verificar "C5 la bitacora encadena las etapas reales, sin antes obsoleto" \
  "select exists (select 1 from public.crm_lead_actividades
                   where lead_id = $ID_ETAPA and tipo = 'cambio_etapa'
                     and cuerpo = 'Etapa: en_contacto -> calificado.')"
verificar "C5 no hay ninguna actividad que salte desde 'nuevo' a 'calificado'" \
  "select not exists (select 1 from public.crm_lead_actividades
                       where lead_id = $ID_ETAPA and tipo = 'cambio_etapa'
                         and cuerpo = 'Etapa: nuevo -> calificado.')"
verificar "C5 la etapa final es la de la ultima escritura" \
  "select exists (select 1 from public.crm_leads
                   where id = $ID_ETAPA and etapa = 'calificado')"

# ── C6/C7 · Identidad documental bajo concurrencia ──────────────────────────
# La unicidad es (tenant, tipo, numero) y la impone el indice unico, no un
# chequeo previo: dos altas simultaneas del MISMO tipo+numero se serializan en el
# indice (la segunda espera a que la primera confirme y entonces choca), y dos
# altas del mismo numero con OTRO tipo no comparten clave, asi que ninguna espera
# a la otra. El telefono compartido tampoco las frena: no es unico.
#
# `alta_en_carrera` deja a venta B con un alta ABIERTA (8 s sin confirmar) y, en
# cuanto B esta dormida, intenta el alta de venta A. Imprime "escribio <s>" o
# "rechazo <s> | <mensaje>".
alta_en_carrera() { # $1 = jsonb de B, $2 = jsonb de A
  printf '%s\n' "begin;" \
    "select set_config('request.jwt.claims', '{\"sub\":\"00000000-0000-0000-0000-00000000c207\",\"role\":\"authenticated\"}', true);" \
    "set role authenticated;" \
    "select public.crm_lead_crear($1);" \
    "select pg_sleep(8);" "commit;" \
    | docker exec -i -e PGPASSWORD=postgres -e PGAPPNAME=sesion_b "$CT" $PSQL -d "$DB" -f - > "$TMP/b.out" 2>&1 &
  printf '%s\n' \
    "do \$\$ declare i int := 0; begin
       loop
         perform pg_stat_clear_snapshot();
         exit when exists (select 1 from pg_stat_activity
                            where application_name = 'sesion_b' and state = 'active' and query like '%pg_sleep(8)%');
         i := i + 1;
         if i > 1200 then raise exception 'la sesion B no llego a su pg_sleep'; end if;
         perform pg_sleep(0.05);
       end loop;
     end \$\$;" \
    "select set_config('request.jwt.claims', '{\"sub\":\"00000000-0000-0000-0000-00000000c206\",\"role\":\"authenticated\"}', false);" \
    "set role authenticated;" \
    "do \$\$ declare t0 timestamptz := clock_timestamp(); r jsonb; begin
       begin
         r := public.crm_lead_crear($2);
         raise notice 'RESULTADO escribio % s %', round(extract(epoch from clock_timestamp() - t0)::numeric, 1), r;
       exception when others then
         raise notice 'RESULTADO rechazo % s | %', round(extract(epoch from clock_timestamp() - t0)::numeric, 1), sqlerrm;
       end;
     end \$\$;" \
    | docker exec -i -e PGPASSWORD=postgres "$CT" $PSQL -d "$DB" -f - > "$TMP/a.out" 2>&1
  wait
  if grep -qi 'error' "$TMP/b.out"; then
    echo "B-ERROR $(tr '\n' ' ' < "$TMP/b.out")"
  else
    grep RESULTADO "$TMP/a.out" | sed 's/.*RESULTADO //'
  fi
}

# C6 · Mismo tenant + mismo tipo + mismo numero, a la vez: B gana; A espera el
# indice y se rechaza como duplicado. El numero va escrito distinto a proposito
# (puntos y tipo en minusculas): la normalizacion tambien corre bajo carrera.
OUT="$(alta_en_carrera \
  "jsonb_build_object('nombre', 'Carrera doc B', 'canal', 'otro', 'tipo_doc', 'CC', 'documento', '77665544')" \
  "jsonb_build_object('nombre', 'Carrera doc A', 'canal', 'otro', 'tipo_doc', 'cc', 'documento', '77.665.544')")"
SEG="$(printf '%s' "$OUT" | sed -n 's/^rechazo \([0-9.]*\) s.*/\1/p')"
if printf '%s' "$OUT" | grep -q '^rechazo' && printf '%s' "$OUT" | grep -q 'crm_lead_duplicado:' \
   && [ -n "$SEG" ] && [ "$(awk "BEGIN{print ($SEG >= 1.0)}")" = "1" ]; then
  echo "OK    C6 mismo tipo+numero a la vez: A espero el indice ${SEG} s y fue rechazada como duplicado"
else
  echo "FALLO C6: $OUT"; FALLOS=$((FALLOS + 1))
fi
verificar "C6 queda UN solo lead CC 77665544, el de B (nada fusionado)" \
  "select (select count(*) from public.crm_leads
            where tenant = 'mayorista' and tipo_doc = 'CC' and documento_norm = '77665544') = 1
      and exists (select 1 from public.crm_leads where nombre = 'Carrera doc B')
      and not exists (select 1 from public.crm_leads where nombre = 'Carrera doc A')"
verificar "C6 el rechazo no dejo actividad huerfana del alta de A" \
  "select (select count(*) from public.crm_lead_actividades a
             join public.crm_leads l on l.id = a.lead_id
            where l.documento_norm = '77665544') = 1"

# C7 · Mismo numero con OTRO tipo y mismo telefono, a la vez: son personas
# distintas; A entra sin esperar a B (no comparten clave unica).
OUT="$(alta_en_carrera \
  "jsonb_build_object('nombre', 'Carrera madre CC', 'canal', 'whatsapp', 'tipo_doc', 'CC', 'documento', '55443322', 'telefono', '3001112233')" \
  "jsonb_build_object('nombre', 'Carrera hija TI', 'canal', 'whatsapp', 'tipo_doc', 'TI', 'documento', '55443322', 'telefono', '300 111 2233')")"
SEG="$(printf '%s' "$OUT" | sed -n 's/^escribio \([0-9.]*\) s.*/\1/p')"
if printf '%s' "$OUT" | grep -q '^escribio' \
   && [ -n "$SEG" ] && [ "$(awk "BEGIN{print ($SEG < 1.0)}")" = "1" ]; then
  echo "OK    C7 mismo numero con otro tipo y mismo telefono a la vez: A entro en ${SEG} s, sin esperar a B"
else
  echo "FALLO C7: $OUT"; FALLOS=$((FALLOS + 1))
fi
verificar "C7 conviven CC y TI 55443322 con el mismo telefono" \
  "select (select count(*) from public.crm_leads
            where tenant = 'mayorista' and documento_norm = '55443322'
              and telefono_norm = '573001112233' and tipo_doc in ('CC', 'TI')) = 2"

if [ "$FALLOS" -eq 0 ]; then
  echo "TODAS LAS CARRERAS DE LA 202 PASARON"
else
  echo "$FALLOS FALLO(S)"; exit 1
fi