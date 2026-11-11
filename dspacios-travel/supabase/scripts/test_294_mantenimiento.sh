#!/bin/bash
# ──────────────────────────────────────────────────────────────────
# PRUEBAS de la migración 294 (mantenimiento) con PostgREST v16.4 y storage-api v1.84.19 REALES. SOLO Docker local y desechable; nunca remoto.
# Uso (desde dspacios-travel/):  bash supabase/scripts/test_294_mantenimiento.sh <contenedor_pg> <plantilla_hasta_287>
#   La plantilla solo se lee (base nueva por corrida). Para que storage-api conecte se fija una contraseña al rol supabase_storage_admin DEL CONTENEDOR
#   de pruebas. pg_cron no existe en la imagen local: se simula el esquema `cron` (misma firma de cron.alter_job) para probar la pausa/restauración.
# Grupos: 1 apagado intacto · 2 activo sin excepción · 3 operador autorizado vs otros · 4 el secreto no aparece en respuestas ni registros ·
#         5 Storage (subir/sobrescribir/borrar) · 6 filtro previo con mismo contexto/permisos/resultados antes, durante y después ·
#         7 fallos y recuperación de activar/desactivar (atomicidad, restauración exacta) · 8 solicitudes añadidas.
# ──────────────────────────────────────────────────────────────────
CT="${1:?contenedor}"; TPL="${2:?plantilla hasta 287}"
export MSYS_NO_PATHCONV=1
AQUI="$(cd "$(dirname "$0")" && pwd)"; MIG="$AQUI/../migrations/20260601000294_mantenimiento_escrituras.sql"
h() { od -An -N"$1" -tx1 /dev/urandom | tr -d ' \n'; }
TOK=$(h 6); DB="t294_$TOK"; ROL="t294_auth_$TOK"; CLAVE="c$TOK"; SECRETO="local-294-$(h 24)"; REST="pgrst294_$TOK"; STO="sto294_$TOK"; RED="red294_$TOK"; SPW="sto$(h 8)"
TMP="./.t294_$TOK"; mkdir -p "$TMP"; RESP="$TMP/respuestas.txt"; : > "$RESP"   # ruta RELATIVA: curl nativo de Windows no escribe en /tmp con MSYS_NO_PATHCONV
PS() { docker exec -i -e PGPASSWORD=postgres $CT psql -h 127.0.0.1 -U supabase_admin -X -q -t -A "$@" 2>&1; }
limpiar() { docker rm -f $REST $STO >/dev/null 2>&1; docker network disconnect $RED $CT >/dev/null 2>&1; docker network rm $RED >/dev/null 2>&1; PS -d postgres -c "drop database if exists $DB" >/dev/null; PS -d postgres -c "drop role if exists $ROL" >/dev/null; rm -rf "$TMP"; }
trap limpiar EXIT
PASS=0; FAIL=0; ok() { PASS=$((PASS+1)); echo "PASS  $1"; }; bad() { FAIL=$((FAIL+1)); echo "FALLO $1 -> $2"; }
igual() { [ "$1" = "$2" ] && echo IGUAL || echo "DISTINTO: [$1] vs [$2]"; }
expect() { if printf '%s' "$2" | tr '\n' ' ' | grep -Eq "$3"; then ok "$1"; else bad "$1" "$(printf '%s' "$2" | tr '\n' ' ' | cut -c1-300)"; fi; }
jwt() { node -e 'const c=require("crypto");const b=s=>Buffer.from(s).toString("base64url");const h=b(JSON.stringify({alg:"HS256",typ:"JWT"}));const p={role:process.argv[2],exp:Math.floor(Date.now()/1e3)+3600};if(process.argv[3])p.sub=process.argv[3];const q=b(JSON.stringify(p));console.log(h+"."+q+"."+c.createHmac("sha256",process.argv[1]).update(h+"."+q).digest("base64url"))' "$SECRETO" "$1" "${2:-}"; }
OP=00000000-0000-4000-8000-000000002941; OTRO=00000000-0000-4000-8000-000000002942; VEN=00000000-0000-4000-8000-000000002943
SR=$(jwt service_role); AN=$(jwt anon); J_OP=$(jwt authenticated $OP); J_OTRO=$(jwt authenticated $OTRO)
SEC=$(node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64url'))"); SEC_SHA=$(printf '%s' "$SEC" | sha256sum | cut -c1-64); SHA_PUB="e39224313f0a1b2c3d4e5f60718293a4b5c6d7e8"

# ── base, roles y servicios ───────────────────────────────────────
PS -d postgres -c "create database $DB template $TPL" >/dev/null
PS -d postgres -c "alter role supabase_storage_admin with password '$SPW'" >/dev/null
PS -d postgres -c "create role $ROL login noinherit password '$CLAVE'" -c "grant anon, authenticated, service_role to $ROL" >/dev/null
PS -d $DB -v ON_ERROR_STOP=1 >/dev/null <<SQL
insert into auth.users (id, email) values ('$OP','op294@x.test'), ('$OTRO','otro294@x.test'), ('$VEN','ven294@x.test') on conflict do nothing;
insert into public.usuarios (id, email, nombre, rol, activo, tenant) values ('$OP','op294@x.test','Operador','superadmin',true,'mayorista'), ('$OTRO','otro294@x.test','Otro super','superadmin',true,'mayorista'), ('$VEN','ven294@x.test','Asesor','venta',true,'mayorista')
  on conflict (id) do update set rol = excluded.rol, activo = true, tenant = excluded.tenant;
create table public.t_mant (id serial primary key, v text);
grant all on public.t_mant to anon, authenticated, service_role; grant usage on sequence public.t_mant_id_seq to anon, authenticated, service_role;
create function public.t_mant_escribe(p text) returns int language sql volatile as \$f\$ insert into public.t_mant(v) values (p) returning id \$f\$;
grant execute on function public.t_mant_escribe(text) to anon, authenticated, service_role;
-- tabla con RLS: el filtro previo «ve» filas solo según el usuario de la petición (prueba de que conserva su contexto y permisos)
create table public.t_privada (dueno uuid, v text); alter table public.t_privada enable row level security;
create policy t_priv_dueno on public.t_privada for select to authenticated using (dueno = auth.uid());
grant select on public.t_privada to anon, authenticated, service_role;
insert into public.t_privada values ('$OP','a'), ('$OP','b'), ('$OTRO','c');
-- FILTRO PREVIO (INVOKER, como lo tendría el proyecto): con «x-prueba-previo: informar» devuelve su contexto; con «rechazar», rechaza
create function public.filtro_previo() returns void language plpgsql as \$f\$
declare h json := nullif(current_setting('request.headers', true), '')::json;
begin
  if h ->> 'x-prueba-previo' = 'rechazar' then raise exception using errcode = 'PT403', message = 'filtro previo'; end if;
  if h ->> 'x-prueba-previo' = 'informar' then
    raise exception using errcode = 'PT409', message = 'ctx=' || current_user || '|' || coalesce(auth.uid()::text, '-') || '|' || current_setting('search_path') || '|' || (select count(*) from public.t_privada);
  end if;
end \$f\$;
grant execute on function public.filtro_previo() to anon, authenticated, service_role;
-- pg_cron SIMULADO (misma firma de cron.alter_job); un job inactivo de antes debe seguir inactivo
create schema if not exists cron; create table cron.job (jobid bigint primary key, jobname text, active boolean);
insert into cron.job values (1, 'tarifario_cola_correr', true), (2, 'tarifario_cola_purga', false), (3, 'otro_job', true);
create function cron.alter_job(job_id bigint, schedule text default null, command text default null, database text default null, username text default null, active boolean default null)
  returns void language sql as \$f\$ update cron.job set active = coalesce(alter_job.active, job.active) where jobid = job_id \$f\$;
SQL
PS -d $DB -c "alter role $ROL set pgrst.db_pre_request = 'public.filtro_previo'" >/dev/null   # filtro previo a nivel de ROL
docker network create $RED >/dev/null; docker network connect $RED $CT
docker run -d --name $STO --network $RED -p "127.0.0.1::5000" -e ANON_KEY="$AN" -e SERVICE_KEY="$SR" -e PGRST_JWT_SECRET="$SECRETO" -e AUTH_JWT_SECRET="$SECRETO" \
  -e DATABASE_URL="postgres://supabase_storage_admin:$SPW@$CT:5432/$DB" -e STORAGE_BACKEND=file -e FILE_STORAGE_BACKEND_PATH=/var/lib/storage -e STORAGE_FILE_BACKEND_PATH=/var/lib/storage \
  -e TENANT_ID=stub -e REGION=stub -e GLOBAL_S3_BUCKET=stub -e FILE_SIZE_LIMIT=52428800 -e ENABLE_IMAGE_TRANSFORMATION=false -e DB_INSTALL_ROLES=false public.ecr.aws/supabase/storage-api:v1.84.19 >/dev/null
docker run -d --name $REST --network $RED -p "127.0.0.1::3000" -e PGRST_DB_URI="postgres://$ROL:$CLAVE@$CT:5432/$DB" -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon -e PGRST_JWT_SECRET="$SECRETO" -e PGRST_DB_CONFIG=true public.ecr.aws/supabase/postgrest:v16.4 >/dev/null
US="http://127.0.0.1:$(docker port $STO 5000/tcp | head -1 | sed 's/.*://')"; UR="http://127.0.0.1:$(docker port $REST 3000/tcp | head -1 | sed 's/.*://')"
for i in $(seq 1 90); do curl -s -o "$TMP/s" -w '%{http_code}' "$US/status" 2>/dev/null | grep -q 200 && break; sleep 1; done
for i in $(seq 1 60); do docker logs $REST 2>&1 | grep -q "Schema cache loaded" && break; sleep 1; done
PS -d $DB -c "insert into storage.buckets (id, name, public) values ('pruebas','pruebas', false) on conflict do nothing;
  create policy p_pruebas_all on storage.objects for all to authenticated using (bucket_id = 'pruebas') with check (bucket_id = 'pruebas');" >/dev/null
reload() { PS -d $DB -c "notify pgrst, 'reload config'; notify pgrst, 'reload schema'" >/dev/null; sleep 2; }
reload

# r <método> <url> <token> <cabeceras separadas por ;> [cuerpo] → "HTTP|cuerpo" (cada respuesta se guarda para buscar el secreto)
r() { local args=(-s -D "$TMP/hd" -o "$TMP/b" -w '%{http_code}' -X "$1" "$2" -H "authorization: Bearer $3"); IFS=';' read -ra hs <<< "${4:-}"; for x in "${hs[@]}"; do [ -n "$x" ] && args+=(-H "$x"); done; [ -n "${5:-}" ] && args+=(--data-binary "$5"); local c; c=$(curl "${args[@]}"); cat "$TMP/hd" "$TMP/b" >> "$RESP" 2>/dev/null; printf '%s|%s' "$c" "$(cat "$TMP/b" 2>/dev/null)"; }
rest() { r "$1" "$UR$2" "$3" "content-type: application/json;prefer: return=minimal;${4:-}" "${5:-}"; }
sto() { r "$1" "$US/object/$2" "$3" "content-type: text/plain;${4:-}" "${5:-}"; }
X() { echo "x-dspacios-mantenimiento: $1;x-dspacios-operador: $2"; }
filas() { PS -d $DB -c "select count(*) from public.t_mant"; }
ajustes() { PS -d $DB -c "select coalesce(string_agg(d.setdatabase::text || ':' || s, ' ; ' order by d.setdatabase, s), '-') from pg_db_role_setting d, unnest(d.setconfig) s where d.setrole = '$ROL'::regrole"; }
cronj() { PS -d $DB -c "select string_agg(jobid || ':' || case when active then 't' else 'f' end, ',' order by jobid) from cron.job"; }
ctx() { rest POST /rpc/t_mant_escribe "$1" "x-prueba-previo: informar;${2:-}" '{"p":"ctx"}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const b=s.slice(s.indexOf("|")+1);try{process.stdout.write(JSON.parse(b).message.replace(/s+/g,"_"))}catch{process.stdout.write("SIN-CTX")}})'; }
casos() {   # el mismo lote, para comparar apagado antes y después de aplicar la 294
  echo "rpc-sr:$(rest POST /rpc/t_mant_escribe "$SR" '' '{"p":"a"}' | cut -c1-3) insert-au:$(rest POST /t_mant "$J_OP" '' '{"v":"b"}' | cut -c1-3) patch-an:$(rest PATCH '/t_mant?id=eq.1' "$AN" '' '{"v":"c"}' | cut -c1-3) get:$(rest GET '/t_mant?select=id&limit=1' "$J_OTRO" | cut -c1-3) previo:$(rest POST /rpc/t_mant_escribe "$SR" 'x-prueba-previo: rechazar' '{"p":"x"}' | cut -c1-3) ctx-op:$(ctx "$J_OP") ctx-otro:$(ctx "$J_OTRO")"
}

echo "== 1) APAGADO: aplicar la 294 no cambia nada (mismo lote antes y después; filtro previo intacto)"
ANTES=$(casos); expect "sube el objeto base de Storage" "$(sto POST pruebas/doc.txt "$J_OP" '' 'VERSION-1')" '^200'
AJ0=$(ajustes); CR0=$(cronj)
PRE="$AQUI/preflight_294_mantenimiento_escrituras.sql"; POST="$AQUI/postcheck_294_mantenimiento_escrituras.sql"
expect "preflight_294 antes de instalar → APLICAR (sin REVISAR)" "$(PS -d $DB -F'|' < "$PRE" | grep -E '^99|')" '|APLICAR$'
PS -d $DB -v ON_ERROR_STOP=1 < "$MIG" >/dev/null && ok "migración 294 aplicada" || bad "migración 294" "$(PS -d $DB -v ON_ERROR_STOP=1 < "$MIG" | tail -2)"
expect "postcheck_294 → CORRECTA (objetos, firmas, seguridad, permisos, trigger, apagado)" "$(PS -d $DB -F'|' < "$POST" | grep -E '|FALLA$|^99|' | tr '
' ' ')" '^99|.*CORRECTA $'
expect "preflight_294 después de instalar → NO APLICAR (ya aplicada)" "$(PS -d $DB -F'|' < "$PRE" | grep -E '^99|')" '|NO APLICAR$'
reload
DESPUES=$(casos)
expect "mismo resultado antes/después (incluido el contexto del filtro previo)" "$(igual "$DESPUES" "$ANTES")" '^IGUAL$'
echo "      lote: $DESPUES"
expect "la 294 no registra ningún filtro ni pausa jobs al aplicarse" "$(igual "$(ajustes)|$(cronj)" "$AJ0|$CR0")" '^IGUAL$'
expect "Storage sigue escribiendo con el mantenimiento apagado" "$(sto POST pruebas/libre.txt "$J_OP" '' 'L')|$(sto DELETE pruebas/libre.txt "$J_OP")" '^200.*\|200'
expect "la sonda responde 200" "$(rest POST /rpc/mantenimiento_sonda "$AN" '' '{}')" '^200'
expect "la configuración no es legible por la API (esquema no expuesto)" "$(r GET "$UR/config?select=clave_sha256" "$SR" 'accept-profile: mant_priv')" '^(4[0-9][0-9]|5[0-9][0-9])'

echo "== 7a) FALLOS al activar: nada cambia"
fallo_activar() { local et="$1" sqlx="$2" pat="$3"; local o; o=$(PS -d $DB -c "$sqlx"); expect "$et" "$o ## $(igual "$(ajustes)|$(cronj)|$(PS -d $DB -c "select activo from mant_priv.config")" "$AJ0|$CR0|f")" "$pat.* ## IGUAL$"; }
fallo_activar "sin operadores → rechazo" "select mant_priv.activar('{}'::uuid[], '$ROL')" 'al menos un operador'
fallo_activar "operador que no es superadmin/administración (venta) → rechazo" "select mant_priv.activar(array['$VEN']::uuid[], '$ROL')" 'no son usuarios activos'
fallo_activar "rol inexistente → rechazo" "select mant_priv.activar(array['$OP']::uuid[], 'no_existe_294')" 'no existe el rol'
PS -d $DB -c "alter role $ROL set pgrst.db_pre_request = 'public.no_existe_294'" >/dev/null
o=$(PS -d $DB -c "select mant_priv.activar(array['$OP']::uuid[], '$ROL')"); expect "filtro previo roto → se niega a activar y lo deja como estaba" "$o|$(ajustes)" 'no existe como función.*pgrst.db_pre_request=public.no_existe_294'
PS -d $DB -c "alter role $ROL set pgrst.db_pre_request = 'public.mantenimiento_pre_request'" >/dev/null
o=$(PS -d $DB -c "select mant_priv.activar(array['$OP']::uuid[], '$ROL')"); expect "el filtro ya es el de mantenimiento (activación sin desactivar) → no se encadena consigo mismo" "$o" 'no se encadena consigo mismo'
PS -d $DB -c "alter role $ROL set pgrst.db_pre_request = 'public.filtro_previo'" >/dev/null
PS -d $DB -c "create function mant_priv.t_falla() returns trigger language plpgsql as \$f\$ begin raise exception 'fallo inyectado'; end \$f\$; create trigger t_falla before update on mant_priv.config for each row execute function mant_priv.t_falla();" >/dev/null
fallo_activar "fallo a MITAD de activar (tras cambiar el rol y pausar jobs) → todo se revierte" "select mant_priv.activar(array['$OP']::uuid[], '$ROL')" 'fallo inyectado'
PS -d $DB -c "drop trigger t_falla on mant_priv.config" >/dev/null

echo "== activar (previo a nivel de ROL) y cortar lo en curso"
expect "activar: nivel rol, previo guardado, 1 job pausado (el inactivo no se toca)" "$(PS -d $DB -c "select mant_priv.activar(array['$OP']::uuid[], '$ROL')")|$(cronj)" '"nivel": "rol".*"previo_rol": "public.filtro_previo".*\|1:f,2:f,3:t$'
reload
expect "el filtro registrado es el de mantenimiento (a nivel de rol)" "$(ajustes)" '^0:pgrst.db_pre_request=public.mantenimiento_pre_request$'
expect "cortar_en_curso responde (0 transacciones anteriores abiertas)" "$(PS -d $DB -c "select mant_priv.cortar_en_curso()")" '^[0-9]+$'
o=$(PS -d $DB -c "select mant_priv.activar(array['$OP']::uuid[], '$ROL')"); expect "activar dos veces → rechazo y la primera sigue" "$o|$(PS -d $DB -c "select activo from mant_priv.config")" 'ya está ACTIVO.*\|t$'

N0=$(filas)
echo "== 2) ACTIVO sin excepción habilitada (sin hash): nadie escribe, ni siquiera con el secreto"
expect "secreto + operador antes de habilitar la excepción → 503" "$(rest POST /rpc/t_mant_escribe "$SR" "$(X "$SEC" $OP)" '{"p":"x"}')" '^503'
SENUELO=$(node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64url'))")   # nunca se escribe el secreto real en SQL: Postgres registra la sentencia que falla
expect "habilitar_excepcion rechaza un secreto (no un hash) — probado con un SEÑUELO" "$(PS -d $DB -c "select mant_priv.habilitar_excepcion('$SENUELO')")" 'nunca el secreto'
PS -d $DB -c "select mant_priv.habilitar_excepcion('$SEC_SHA')" >/dev/null
echo "== 2) ACTIVO con excepción: código viejo, sin cabecera, SHA público, secreto incorrecto"
expect "código viejo (service_role, sin cabecera) → 503" "$(rest POST /rpc/t_mant_escribe "$SR" '' '{"p":"x"}')" '^503'
expect "INSERT directo (authenticated) → 503" "$(rest POST /t_mant "$J_OP" '' '{"v":"x"}')" '^503'
expect "PATCH / DELETE → 503" "$(rest PATCH '/t_mant?id=eq.1' "$SR" '' '{"v":"x"}' | cut -c1-3)/$(rest DELETE '/t_mant?id=eq.1' "$SR" | cut -c1-3)" '^503/503$'
expect "SHA público como secreto → 503" "$(rest POST /rpc/t_mant_escribe "$SR" "$(X "$SHA_PUB" $OP)" '{"p":"x"}')" '^503'
expect "SHA público en una cabecera de despliegue → 503" "$(rest POST /rpc/t_mant_escribe "$SR" "x-dspacios-despliegue: $SHA_PUB;x-dspacios-operador: $OP" '{"p":"x"}')" '^503'
expect "secreto incorrecto → 503" "$(rest POST /rpc/t_mant_escribe "$SR" "$(X "$(h 32)" $OP)" '{"p":"x"}')" '^503'
expect "el hash usado como secreto → 503" "$(rest POST /rpc/t_mant_escribe "$SR" "$(X "$SEC_SHA" $OP)" '{"p":"x"}')" '^503'
expect "GET de lectura → 200 · la sonda (POST) → 503" "$(rest GET '/t_mant?select=id&limit=1' "$J_OTRO" | cut -c1-3)/$(rest POST /rpc/mantenimiento_sonda "$AN" '' '{}' | cut -c1-3)" '^200/503$'
expect "ninguna escritura entró" "$(filas)" "^$N0$"

echo "== 3) OPERADOR autorizado vs otros usuarios del código nuevo"
expect "operador (su JWT) + secreto + su id → escribe" "$(rest POST /rpc/t_mant_escribe "$J_OP" "$(X "$SEC" $OP)" '{"p":"op"}' | cut -c1-3)" '^200'
expect "service_role del servidor + secreto + operador verificado → escribe" "$(rest POST /rpc/t_mant_escribe "$SR" "$(X "$SEC" $OP)" '{"p":"op-sr"}' | cut -c1-3)" '^200'
expect "OTRO superadmin (su JWT) + secreto + su id → 503 (no está en la lista de la ventana)" "$(rest POST /rpc/t_mant_escribe "$J_OTRO" "$(X "$SEC" $OTRO)" '{"p":"x"}')" '^503'
expect "OTRO usuario con su JWT declarando el id del operador → 503 (no coincide con el JWT)" "$(rest POST /rpc/t_mant_escribe "$J_OTRO" "$(X "$SEC" $OP)" '{"p":"x"}')" '^503'
expect "service_role + secreto + id de OTRO → 503" "$(rest POST /rpc/t_mant_escribe "$SR" "$(X "$SEC" $OTRO)" '{"p":"x"}')" '^503'
expect "service_role + secreto sin operador → 503" "$(rest POST /rpc/t_mant_escribe "$SR" "x-dspacios-mantenimiento: $SEC" '{"p":"x"}')" '^503'
expect "anon + secreto + operador → 503 (anon nunca)" "$(rest POST /rpc/t_mant_escribe "$AN" "$(X "$SEC" $OP)" '{"p":"x"}')" '^503'
expect "la excepción no da permisos: el operador sigue viendo solo lo que su RLS le deja (t_privada)" "$(rest GET '/t_privada?select=v&order=v' "$J_OP" "$(X "$SEC" $OP)" | tr -d ' 
')" '^200|[{"v":"a"},{"v":"b"}]$'
expect "exactamente 2 escrituras (las del operador)" "$(filas)" "^$((N0+2))$"

echo "== 6) filtro PREVIO durante la ventana: mismo contexto, permisos y resultados"
expect "el previo sigue rechazando su caso, ANTES que el mantenimiento (aunque traiga la excepción)" "$(rest POST /rpc/t_mant_escribe "$J_OP" "x-prueba-previo: rechazar;$(X "$SEC" $OP)" '{"p":"x"}')" '^4.*filtro previo'
expect "contexto del previo en la ventana == apagado (rol, usuario, search_path completo y filas visibles por RLS), operador y otro" "$(igual "ctx-op:$(ctx "$J_OP") ctx-otro:$(ctx "$J_OTRO")" "ctx-op:${ANTES#*ctx-op:}")" '^IGUAL$'

echo "== 5) STORAGE con el mantenimiento activo"
for quien in J_OP J_OTRO SR; do tk=${!quien}
  expect "$quien sin excepción: subir → rechazado" "$(sto POST pruebas/nuevo-$quien.txt "$tk" '' 'NUEVO' | cut -c1-3)" '^(4|5)[0-9][0-9]'
  expect "$quien sin excepción: sobrescribir (upsert) → rechazado" "$(sto POST pruebas/doc.txt "$tk" 'x-upsert: true' 'VERSION-2' | cut -c1-3)" '^(4|5)[0-9][0-9]'
  expect "$quien sin excepción: reemplazar (PUT) → rechazado" "$(sto PUT pruebas/doc.txt "$tk" '' 'VERSION-3' | cut -c1-3)" '^(4|5)[0-9][0-9]'
  expect "$quien sin excepción: borrar → rechazado" "$(sto DELETE pruebas/doc.txt "$tk" | cut -c1-3)" '^(4|5)[0-9][0-9]'
done
expect "OTRO superadmin con secreto + su id: subir → rechazado" "$(sto POST pruebas/otro.txt "$J_OTRO" "$(X "$SEC" $OTRO)" 'X' | cut -c1-3)" '^(4|5)[0-9][0-9]'
expect "el objeto sigue con su contenido ORIGINAL y no hay objetos nuevos" "$(r GET "$US/object/authenticated/pruebas/doc.txt" "$SR")|$(PS -d $DB -c "select count(*) from storage.objects where bucket_id='pruebas'")" '^200\|VERSION-1\|1$'
F_DISCO=$(docker exec $STO sh -c "find /var/lib/storage -type f | wc -l"); expect "en el disco del backend solo está el archivo original (1)" "$F_DISCO" '^1$'
expect "operador (service_role del servidor) con la excepción: sube, sobrescribe y borra su archivo de validación" "$(sto POST pruebas/val.txt "$SR" "$(X "$SEC" $OP)" 'V1' | cut -c1-3)/$(sto POST pruebas/val.txt "$SR" "x-upsert: true;$(X "$SEC" $OP)" 'V2' | cut -c1-3)/$(sto DELETE pruebas/val.txt "$SR" "$(X "$SEC" $OP)" | cut -c1-3)" '^200/200/200$'


echo "== 3b) el operador PIERDE la excepción si se le desactiva o se le retira el rol DESPUÉS de activar (PostgREST y Storage)"
tres() { echo "jwt:$(rest POST /rpc/t_mant_escribe "$J_OP" "$(X "$SEC" $OP)" '{"p":"x"}' | cut -c1-3) sr:$(rest POST /rpc/t_mant_escribe "$SR" "$(X "$SEC" $OP)" '{"p":"x"}' | cut -c1-3) storage:$(sto POST pruebas/op-$1.txt "$SR" "$(X "$SEC" $OP)" 'X' | cut -c1-3)"; }
N3=$(filas)
expect "control: operador autorizado y activo → escribe por PostgREST (JWT y service_role) y por Storage" "$(tres control)" '^jwt:200 sr:200 storage:200$'
sto DELETE pruebas/op-control.txt "$SR" "$(X "$SEC" $OP)" >/dev/null
PS -d $DB -c "update public.usuarios set activo = false where id = '$OP'" >/dev/null
expect "DESACTIVADO después de activar → 503 en PostgREST (JWT y service_role) y rechazo en Storage" "$(tres desactivado)" '^jwt:503 sr:503 storage:(4|5)[0-9][0-9]$'
PS -d $DB -c "update public.usuarios set activo = true, rol = 'venta' where id = '$OP'" >/dev/null
expect "ROL RETIRADO (pasa a venta) después de activar → 503 en PostgREST y rechazo en Storage" "$(tres sin_rol)" '^jwt:503 sr:503 storage:(4|5)[0-9][0-9]$'
PS -d $DB -c "update public.usuarios set rol = 'administracion' where id = '$OP'" >/dev/null
expect "rol administracion (permitido) → vuelve a tener la excepción" "$(tres admin)" '^jwt:200 sr:200 storage:200$'
sto DELETE pruebas/op-admin.txt "$SR" "$(X "$SEC" $OP)" >/dev/null
PS -d $DB -c "update public.usuarios set rol = 'superadmin' where id = '$OP'" >/dev/null
expect "solo entraron las escrituras de los casos permitidos (control y administracion)" "$(filas)|$(PS -d $DB -c "select count(*) from storage.objects where bucket_id = 'pruebas' and name like 'op-%'")" "^$((N3+4))\|0$"

echo "== 7b) FALLO al desactivar → sigue activo y coherente; luego desactiva y restaura EXACTO"
PS -d $DB -c "create trigger t_falla before update on mant_priv.config for each row execute function mant_priv.t_falla();" >/dev/null
o=$(PS -d $DB -c "select mant_priv.desactivar()"); expect "fallo inyectado al desactivar: sigue activo, filtro y jobs sin tocar" "$o|$(PS -d $DB -c "select activo from mant_priv.config")|$(ajustes)|$(cronj)" 'fallo inyectado.*\|t\|0:pgrst.db_pre_request=public.mantenimiento_pre_request\|1:f,2:f,3:t$'
PS -d $DB -c "drop trigger t_falla on mant_priv.config; drop function mant_priv.t_falla();" >/dev/null
expect "desactivar: restaura el filtro previo y reactiva SOLO el job que pausó" "$(PS -d $DB -c "select mant_priv.desactivar()") ## $(igual "$(ajustes)|$(cronj)" "$AJ0|$CR0")" '"activo": false.* ## IGUAL$'
reload
expect "desactivar dos veces → no cambia nada" "$(PS -d $DB -c "select mant_priv.desactivar()") ## $(igual "$(ajustes)" "$AJ0")" 'ya estaba desactivado.* ## IGUAL$'
expect "la configuración queda limpia (sin hash ni operadores)" "$(PS -d $DB -c "select activo||'|'||coalesce(clave_sha256,'-')||'|'||cardinality(operadores) from mant_priv.config")" '^false\|-\|0$'
expect "6) DESPUÉS: el mismo lote que con el mantenimiento apagado" "$(igual "$(casos)" "$ANTES")" '^IGUAL$'

echo "== 7c) previo a nivel de BASE (alter role … in database): se reemplaza donde rige y se restaura EXACTO"
PS -d $DB -c "alter role $ROL reset pgrst.db_pre_request; alter role $ROL in database $DB set pgrst.db_pre_request = 'public.filtro_previo'" >/dev/null
AJB=$(ajustes)
expect "activar con previo de base: nivel base" "$(PS -d $DB -c "select mant_priv.activar(array['$OP']::uuid[], '$ROL')")" '"nivel": "base".*"previo_base": "public.filtro_previo"'
expect "registrado a nivel de base (el de rol sigue ausente)" "$(ajustes)" "pgrst.db_pre_request=public.mantenimiento_pre_request$"
PS -d $DB -c "select mant_priv.desactivar()" >/dev/null
expect "restauración exacta de los dos niveles" "$(igual "$(ajustes)" "$AJB")" '^IGUAL$'
PS -d $DB -c "alter role $ROL in database $DB reset pgrst.db_pre_request; alter role $ROL set pgrst.db_pre_request = 'public.filtro_previo'" >/dev/null
echo "== 7d) sin filtro previo: activar y desactivar deja el rol SIN filtro (reset)"
PS -d $DB -c "alter role $ROL reset pgrst.db_pre_request" >/dev/null
PS -d $DB -c "select mant_priv.activar(array['$OP']::uuid[], '$ROL')" >/dev/null; PS -d $DB -c "select mant_priv.desactivar()" >/dev/null
expect "sin filtro previo → sin filtro después" "$(ajustes)" '^-$'

echo "== 4) el secreto no aparece en respuestas ni registros"
expect "ninguna respuesta HTTP (cabeceras ni cuerpo) contiene el secreto" "$(grep -c -- "$SEC" "$RESP")" '^0$'
expect "registros de PostgREST sin el secreto" "$(docker logs $REST 2>&1 | grep -c -- "$SEC")" '^0$'
expect "registros de storage-api sin el secreto" "$(docker logs $STO 2>&1 | grep -c -- "$SEC")" '^0$'
expect "registros de Postgres (desde el inicio de la prueba) sin el secreto" "$(docker logs --since 30m $CT 2>&1 | grep -c -- "$SEC")" '^0$'
expect "la base no guarda el secreto (solo el hash) ni lo registra la auditoría" "$(PS -d $DB -c "select count(*) from mant_priv.config where clave_sha256 = '$SEC'")|$(PS -d $DB -c "select count(*) from public.auditoria where (coalesce(antes::text,'') || coalesce(despues::text,'')) like '%$SEC%'")" '^0\|0$'

echo "== 8) costo: con el mantenimiento apagado el filtro no está registrado (0 consultas extra por petición en PostgREST); en Storage, 1 lectura de una fila por escritura"
expect "apagado: ningún pgrst.db_pre_request de mantenimiento registrado" "$(ajustes | grep -c mantenimiento)" '^0$'
echo; echo "RESULTADO 294: $PASS pasan, $FAIL fallan"
[ "$FAIL" -eq 0 ]
