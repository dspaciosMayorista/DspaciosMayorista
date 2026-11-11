#!/bin/bash
# ────────────────────────────────────────────────────────────────────────────────────────────────────────────
# PRUEBA CON SERVICIOS REALES de las migraciones FINALES 284 + 285 (#75, entrega 2): PostgREST v16.4 y storage-api v1.84.19 sobre la base,
# con las políticas y funciones reales (nada de prototipos). Demuestra que la cabecera HTTP `x-contratos`:
#   · llega a los triggers y funciones de la MISMA transacción de la escritura (PostgREST);
#   · llega a las políticas de `storage.objects` en subir, descargar, listar, enlace firmado, reemplazar (PUT) y borrar (Storage);
#   · también obliga a service_role (no hay excepción por rol) y a superadmin.
#
# Uso: bash supabase/scripts/test_285_postgrest_storage.sh <contenedor-postgres> <base-origen-con-284-y-285> [puerto-rest=3075] [puerto-storage=3077]
#   · Crea la base temporal «http285» COMO COPIA de <base-origen> (sin tocarla) y dos contenedores desechables (pgrst285, stor285) que borra al final.
#   · Requiere las imágenes locales public.ecr.aws/supabase/postgrest:v16.4 y public.ecr.aws/supabase/storage-api:v1.84.19, y node (para firmar JWT).
# ────────────────────────────────────────────────────────────────────────────────────────────────────────────
CT="${1:?uso: test_285_postgrest_storage.sh <contenedor> <base-origen> [puerto-rest] [puerto-storage]}"; SRC="${2:?falta la base origen}"
PR="${3:-3075}"; PS="${4:-3077}"
export MSYS_NO_PATHCONV=1
HERE="$(cd "$(dirname "$0")" && pwd)"
W="$(mktemp -d)"; cd "$W"
SECRET="super-secret-jwt-token-with-at-least-32-characters-long"
S()  { docker exec -i -e PGPASSWORD=postgres "$CT" psql -h 127.0.0.1 -U supabase_admin -X -q -t -A -v ON_ERROR_STOP=0 -d "$1" "${@:2}" 2>&1; }
DB=http285
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf 'PASS  %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf 'FALLO %s  ->  %s\n' "$1" "$2"; }
limpiar() { docker rm -f pgrst285 stor285 >/dev/null 2>&1; S template1 -c "select pg_terminate_backend(pid) from pg_stat_activity where datname='$DB'" >/dev/null; S template1 -c "drop database if exists $DB" >/dev/null; rm -rf "$W"; }
trap limpiar EXIT
cat > jwt.js <<'JS'
const crypto = require("crypto");
const secret = process.env.SECRET;
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const tok = (p) => { const h = b64({ alg: "HS256", typ: "JWT" }), q = b64({ ...p, exp: Math.floor(Date.now() / 1000) + 3600 });
  return h + "." + q + "." + crypto.createHmac("sha256", secret).update(h + "." + q).digest("base64url"); };
const SU = "aaaaaaaa-1111-1111-1111-111111111111";
const CV = "cccccccc-9999-9999-9999-999999999999";
const m = { cv: { role: "authenticated", sub: CV }, anon: { role: "anon" }, su: { role: "authenticated", sub: SU }, svc: { role: "service_role" } };
process.stdout.write(tok(m[process.argv[2]]));
JS
T_CV=$(SECRET="$SECRET" node jwt.js cv); T_SU=$(SECRET="$SECRET" node jwt.js su); T_SVC=$(SECRET="$SECRET" node jwt.js svc); T_ANON=$(SECRET="$SECRET" node jwt.js anon)

echo "== preparación: base temporal $DB (copia de $SRC) y servicios reales"
S template1 -c "select pg_terminate_backend(pid) from pg_stat_activity where datname in ('$SRC','$DB') and pid<>pg_backend_pid()" >/dev/null
S template1 -c "drop database if exists $DB" -c "create database $DB template $SRC" | head -2
S $DB -c "create or replace function auth.uid() returns uuid language sql stable as \$f\$ select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid \$f\$" \
      -c "alter role authenticator with login password 'postgres'" >/dev/null
S $DB -c "insert into storage.buckets(id,name,public) values ('contratos','contratos',false) on conflict do nothing" >/dev/null
docker rm -f pgrst285 stor285 >/dev/null 2>&1
docker run -d --name pgrst285 --link "$CT":pg -p "$PR":3000 -e PGRST_DB_URI="postgres://authenticator:postgres@pg:5432/$DB" -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon -e PGRST_JWT_SECRET="$SECRET" public.ecr.aws/supabase/postgrest:v16.4 >/dev/null
docker run -d --name stor285 --link "$CT":pg --link pgrst285:rest -p "$PS":5000 -e ANON_KEY="$T_ANON" -e SERVICE_KEY="$T_SVC" -e POSTGREST_URL=http://rest:3000 -e PGRST_JWT_SECRET="$SECRET" -e AUTH_JWT_SECRET="$SECRET" \
  -e DATABASE_URL="postgres://supabase_admin:postgres@pg:5432/$DB" -e STORAGE_BACKEND=file -e FILE_STORAGE_BACKEND_PATH=/var/lib/storage -e TENANT_ID=stub -e REGION=stub -e GLOBAL_S3_BUCKET=stub -e ENABLE_IMAGE_TRANSFORMATION=false \
  public.ecr.aws/supabase/storage-api:v1.84.19 >/dev/null
for i in $(seq 1 40); do
  a=$(curl.exe -s -o ./.x -w "%{http_code}" "http://localhost:$PR/" -H "Authorization: Bearer $T_ANON"); b=$(curl.exe -s -o ./.x -w "%{http_code}" "http://localhost:$PS/status" 2>/dev/null)
  [ "$a" = 200 ] && [ "$b" = 200 ] && break; sleep 2
done
[ "$a" = 200 ] && ok "PostgREST v16.4 arriba sobre la base con 284+285" || { bad "PostgREST" "no arrancó (HTTP $a)"; docker logs pgrst285 2>&1 | tail -5; }
[ "$b" = 200 ] && ok "storage-api v1.84.19 arriba" || { bad "Storage" "no arrancó (HTTP $b)"; docker logs stor285 2>&1 | tail -5; }

R="http://localhost:$PR"; ST="http://localhost:$PS"
B=$(( $(date +%s) % 7000 + 1000 )); N="DTM-9${B}1"; L="DTM-9${B}2"; D="DTM-9${B}3"
uid() { S $DB -c "select contrato_uid from public.ventas where numero_contrato='$1'"; }
S $DB -c "insert into public.ventas(numero_contrato,tenant,cliente,estado,asesor) values ('$N','mayorista','Ana','pendiente','X')" >/dev/null; U1=$(uid $N)
S $DB -c "delete from public.ventas where numero_contrato='$N'" >/dev/null
S $DB -c "insert into public.ventas(numero_contrato,tenant,cliente,estado,asesor,nacio_de_reuso) values ('$N','mayorista','Carlos','pendiente','Y',true),('$L','mayorista','Legado','pendiente','Y',false)" >/dev/null
S $DB -c "insert into public.ventas(numero_contrato,tenant,cliente,estado,asesor,nacio_de_reuso) values ('$D','mayorista','Diana','pendiente','Y',true)" >/dev/null
U2=$(uid $N); UL=$(uid $L); UD=$(uid $D)
echo "N=$N Ana=${U1:0:8} Carlos=${U2:0:8} · L=$L (de siempre)"
HA="{\"$N\":\"$U1\"}"; HB="{\"$N\":\"$U2\"}"; HL="{\"$L\":\"$UL\"}"

# rest <etiqueta> <esperado-http|rango> <código-SQLSTATE-o-texto-esperado|-> <método> <ruta> <token> <mapa|-> [cuerpo-json]
rest() {
  local h=(-H "Authorization: Bearer $6" -H "Content-Type: application/json" -H "Prefer: return=minimal"); [ "$7" != "-" ] && h+=(-H "x-contratos: $7")
  local c; if [ -n "$8" ]; then c=$(curl.exe -s -o ./.r -w "%{http_code}" -X "$4" "$R$5" "${h[@]}" -d "$8"); else c=$(curl.exe -s -o ./.r -w "%{http_code}" -X "$4" "$R$5" "${h[@]}"); fi
  local body; body=$(head -c 220 ./.r | tr '\n' ' ')
  if printf '%s' "$c" | grep -Eq "^$2$" && { [ "$3" = "-" ] || printf '%s' "$body" | grep -q "$3"; }; then ok "$1 → HTTP $c${3:+ $( [ "$3" = - ] || echo "($3)")}"; else bad "$1" "HTTP $c · $body"; fi
}
echo "=== A) PostgREST: la cabecera llega a los triggers (escrituras directas por la API REST)"
rest "POST contrato_pasajeros con identidad ANTIGUA (superadmin)" 400 F4601 POST "/contrato_pasajeros" "$T_SU" "$HA" "{\"numero_contrato\":\"$N\",\"nombre\":\"Intruso\"}"
rest "POST contrato_pasajeros SIN identidad (bundle viejo)" 400 F4602 POST "/contrato_pasajeros" "$T_SU" - "{\"numero_contrato\":\"$N\",\"nombre\":\"Intruso\"}"
rest "POST contrato_pasajeros con la identidad CORRECTA" 201 - POST "/contrato_pasajeros" "$T_SU" "$HB" "{\"numero_contrato\":\"$N\",\"nombre\":\"Legitimo\"}"
rest "service_role TAMPOCO está exento: POST con identidad antigua" 400 F4601 POST "/contrato_pasajeros" "$T_SVC" "$HA" "{\"numero_contrato\":\"$N\",\"nombre\":\"Intruso\"}"
rest "service_role sin identidad sobre un contrato de reuso" 400 F4602 POST "/contrato_pasajeros" "$T_SVC" - "{\"numero_contrato\":\"$N\",\"nombre\":\"Intruso\"}"
rest "PATCH del contrato (ventas) desde la pantalla antigua" 400 F4601 PATCH "/ventas?numero_contrato=eq.$N" "$T_SU" "$HA" "{\"observaciones\":\"x\"}"
rest "PATCH del contrato con la identidad correcta" 204 - PATCH "/ventas?numero_contrato=eq.$N" "$T_SU" "$HB" "{\"observaciones\":\"x\"}"
rest "contrato de SIEMPRE sin identidad (comportamiento actual)" 204 - PATCH "/ventas?numero_contrato=eq.$L" "$T_SU" - "{\"observaciones\":\"x\"}"
rest "DELETE de pasajeros del contrato de reuso con identidad antigua" 400 F4601 DELETE "/contrato_pasajeros?numero_contrato=eq.$N" "$T_SU" "$HA"
rest "PATCH que mueve una fila de N a un contrato DE SIEMPRE declarando solo N (el destino no exige identidad)" 204 - PATCH "/contrato_pasajeros?numero_contrato=eq.$N" "$T_SU" "$HB" "{\"numero_contrato\":\"$L\"}"
rest "PATCH que mueve una fila entre contratos hacia un destino de REUSO sin declarar el destino" 400 F4602 PATCH "/contrato_pasajeros?numero_contrato=eq.$L" "$T_SU" "$HB" "{\"numero_contrato\":\"$D\"}"
rest "…el mismo movimiento declarando ORIGEN y DESTINO" 204 - PATCH "/contrato_pasajeros?numero_contrato=eq.$L" "$T_SU" "{\"$N\":\"$U2\",\"$L\":\"$UL\",\"$D\":\"$UD\"}" "{\"numero_contrato\":\"$D\"}"
rest "RPC eliminar_contrato desde la pantalla antigua" 400 F4601 POST "/rpc/eliminar_contrato" "$T_SU" "$HA" "{\"p_numero\":\"$N\",\"p_reusar\":false}"
rest "RPC eliminar_contrato sin identidad" 400 F4602 POST "/rpc/eliminar_contrato" "$T_SU" - "{\"p_numero\":\"$N\",\"p_reusar\":false}"
rest "RPC soporte_verificar_identidad (precomprobación, service_role) identidad antigua" 400 F4521 POST "/rpc/soporte_verificar_identidad" "$T_SVC" "$HA" "{\"p_numero\":\"$N\"}"
rest "RPC soporte_verificar_identidad sin identidad" 400 F4521 POST "/rpc/soporte_verificar_identidad" "$T_SVC" - "{\"p_numero\":\"$N\"}"
rest "RPC soporte_verificar_identidad con la correcta" '20[0-9]' - POST "/rpc/soporte_verificar_identidad" "$T_SVC" "$HB" "{\"p_numero\":\"$N\"}"
rest "RPC soporte_verificar_identidad NO es invocable por authenticated" '40[13]' - POST "/rpc/soporte_verificar_identidad" "$T_SU" "$HB" "{\"p_numero\":\"$N\"}"
rest "RPC contratos_identidades (pantalla de superadmin) devuelve el uid" 200 "$U2" POST "/rpc/contratos_identidades" "$T_SU" - "{\"p_numeros\":[\"$N\"]}"

echo "=== A2) control_vuelo REAL por PostgREST: obtiene el uid de las sillas sin leer ventas, y su escritura exige esa identidad"
CVID='cccccccc-9999-9999-9999-999999999999'
S $DB -c "insert into auth.users (id,email) values ('$CVID','cv@t.l') on conflict do nothing" >/dev/null
S $DB -c "update public.usuarios set rol='control_vuelo', activo=true, nombre='cv', tenant='mayorista' where id='$CVID'" >/dev/null
S $DB -c "insert into public.bloqueos_vuelo(record,aerolinea,ruta,vuelo_ida,hora_salida_ida,hora_llegada_ida,fecha_ida,fecha_regreso,cupos_total,destino_id) values ('CV$B','AV','BOG-CTG','AV1','08:00','09:30',current_date+60,current_date+63,5,1)" >/dev/null
BCV=$(S $DB -c "select id from public.bloqueos_vuelo where record='CV$B'")
S $DB -c "begin; set local session_replication_role = replica; insert into public.sillas(bloqueo_id,numero_silla,estado,numero_contrato) values ($BCV,1,'confirmada','$N'); commit;" >/dev/null   # siembra: la guarda exigiría identidad
SID=$(S $DB -c "select id from public.sillas where bloqueo_id=$BCV and numero_silla=1")
rest "control_vuelo: RPC sillas_identidades devuelve el uid vigente de su silla" 200 "$U2" POST "/rpc/sillas_identidades" "$T_CV" - "{\"p_bloqueo\":$BCV}"
rest "control_vuelo: SIN argumento (listado global) también responde" 200 "$U2" POST "/rpc/sillas_identidades" "$T_CV" - "{}"
rest "control_vuelo sigue SIN leer ventas (lista vacía, no se amplió el acceso financiero)" 200 '^\[\]' GET "/ventas?select=numero_contrato,precio_venta&numero_contrato=eq.$N" "$T_CV" -
rest "anon NO puede ejecutar sillas_identidades" '40[13]' - POST "/rpc/sillas_identidades" "$T_ANON" - "{\"p_bloqueo\":$BCV}"
rest "control_vuelo: RPC editar_pasajero_silla con la identidad CORRECTA (la que obtuvo)" '20[0-9]' - POST "/rpc/editar_pasajero_silla" "$T_CV" "$HB" "{\"p_silla_id\":$SID,\"p_datos\":{\"hotel\":\"H\"}}"
rest "control_vuelo desde una pantalla ANTIGUA (uid del contrato eliminado)" 400 F4601 POST "/rpc/editar_pasajero_silla" "$T_CV" "$HA" "{\"p_silla_id\":$SID,\"p_datos\":{\"hotel\":\"H2\"}}"
rest "control_vuelo SIN identidad (bundle viejo) sobre un contrato de reuso" 400 F4602 POST "/rpc/editar_pasajero_silla" "$T_CV" - "{\"p_silla_id\":$SID,\"p_datos\":{\"hotel\":\"H3\"}}"

echo "=== B) Storage real (políticas FINALES de la 285 sobre storage.objects)"
printf 'contenido de Carlos' > ./.carlos.txt; printf 'intruso de la pantalla antigua' > ./.intruso.txt
op() { # op <etiqueta> <método> <ruta> <token> <mapa|-> <carlos|intruso|json|-> <permitido|denegado> [cuerpo]
  local h=(-H "Authorization: Bearer $4"); [ "$5" != "-" ] && h+=(-H "x-contratos: $5")
  local c
  case "$6" in
    carlos) c=$(curl.exe -s -o ./.s -w "%{http_code}" -X "$2" "$ST$3" "${h[@]}" -H "Content-Type: text/plain" --data-binary @./.carlos.txt);;
    intruso) c=$(curl.exe -s -o ./.s -w "%{http_code}" -X "$2" "$ST$3" "${h[@]}" -H "Content-Type: text/plain" --data-binary @./.intruso.txt);;
    json) c=$(curl.exe -s -o ./.s -w "%{http_code}" -X "$2" "$ST$3" "${h[@]}" -H "Content-Type: application/json" -d "$8");;
    *) c=$(curl.exe -s -o ./.s -w "%{http_code}" -X "$2" "$ST$3" "${h[@]}");;
  esac
  local cuerpo; cuerpo=$(head -c 90 ./.s | tr '\n' ' ')
  local res=denegado; [ "$c" = 200 ] && res=permitido; [ "$6" = json ] && [ "$cuerpo" = "[]" ] && res="denegado"
  if [ "$res" = "$7" ]; then ok "$1 → $res (HTTP $c)"; else bad "$1" "esperaba $7, fue $res (HTTP $c) $cuerpo"; fi
}
SEG="$U2"
op "B sube carlos-1 (identidad de Carlos)" POST "/object/contratos/$N/$SEG/carlos-1.txt" "$T_SU" "$HB" carlos permitido
op "B sube carlos-2" POST "/object/contratos/$N/$SEG/carlos-2.txt" "$T_SU" "$HB" carlos permitido
op "B sube carlos-3" POST "/object/contratos/$N/$SEG/carlos-3.txt" "$T_SU" "$HB" carlos permitido
echo "-- la pantalla ANTIGUA de Ana (superadmin, con el uid del contrato anterior) intenta lo mismo sobre el contrato nuevo:"
op "A sube un archivo al prefijo del número" POST "/object/contratos/$N/intruso.txt" "$T_SU" "$HA" intruso denegado
op "A lista la carpeta de Carlos" POST "/object/list/contratos" "$T_SU" "$HA" json denegado "{\"prefix\":\"$N/$SEG\"}"
op "A descarga carlos-1" GET "/object/authenticated/contratos/$N/$SEG/carlos-1.txt" "$T_SU" "$HA" - denegado
op "A pide un enlace firmado de carlos-1" POST "/object/sign/contratos/$N/$SEG/carlos-1.txt" "$T_SU" "$HA" json denegado '{"expiresIn":120}'
op "A reemplaza carlos-2 (PUT)" PUT "/object/contratos/$N/$SEG/carlos-2.txt" "$T_SU" "$HA" intruso denegado
op "A borra carlos-3" DELETE "/object/contratos/$N/$SEG/carlos-3.txt" "$T_SU" "$HA" - denegado
echo "-- bundle viejo: SIN identidad (superadmin):"
op "sin identidad sube al prefijo" POST "/object/contratos/$N/intruso2.txt" "$T_SU" - intruso denegado
op "sin identidad descarga carlos-1" GET "/object/authenticated/contratos/$N/$SEG/carlos-1.txt" "$T_SU" - - denegado
echo "-- el contenido de Carlos sigue intacto (lectura con SU identidad):"
for f in carlos-1 carlos-2 carlos-3; do
  c=$(curl.exe -s "$ST/object/authenticated/contratos/$N/$SEG/$f.txt" -H "Authorization: Bearer $T_SU" -H "x-contratos: $HB")
  [ "$c" = "contenido de Carlos" ] && ok "$f.txt sigue con el contenido de Carlos (no lo pisó la pantalla antigua)" || bad "$f.txt" "contenido: $c"
done
[ "$(S $DB -c "select count(*) from storage.objects where bucket_id='contratos' and name like '$N/%intruso%'")" = 0 ] && ok "no quedó ningún archivo intruso en el contrato nuevo" || bad "intrusos" "hay objetos intrusos"
echo "-- la pantalla legítima de Carlos sigue funcionando:"
op "B lista su carpeta" POST "/object/list/contratos" "$T_SU" "$HB" json permitido "{\"prefix\":\"$N/$SEG\"}"
op "B descarga carlos-1" GET "/object/authenticated/contratos/$N/$SEG/carlos-1.txt" "$T_SU" "$HB" - permitido
op "B pide enlace firmado" POST "/object/sign/contratos/$N/$SEG/carlos-1.txt" "$T_SU" "$HB" json permitido '{"expiresIn":120}'
op "B reemplaza carlos-2" PUT "/object/contratos/$N/$SEG/carlos-2.txt" "$T_SU" "$HB" carlos permitido
op "B borra carlos-3" DELETE "/object/contratos/$N/$SEG/carlos-3.txt" "$T_SU" "$HB" - permitido
echo "-- un contrato de siempre (no nacido de reuso) sigue como hoy, sin identidad:"
op "contrato de siempre: subir sin identidad" POST "/object/contratos/$L/legado-1.txt" "$T_SU" - carlos permitido
op "contrato de siempre: descargar sin identidad" GET "/object/authenticated/contratos/$L/legado-1.txt" "$T_SU" - - permitido
op "contrato de siempre con identidad FALSA" GET "/object/authenticated/contratos/$L/legado-1.txt" "$T_SU" "{\"$L\":\"$U1\"}" - denegado
echo; echo "RESUMEN: $PASS PASS, $FAIL FALLO"
[ "$FAIL" -eq 0 ]
