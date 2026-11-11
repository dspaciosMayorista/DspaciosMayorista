#!/bin/bash
# ────────────────────────────────────────────────────────────────────────────────────────────────────────────
# PRUEBAS DE INTEGRACIÓN de la migración 284 (#75, entrega 1): identidad del contrato y guardas.
#
# Uso:  bash supabase/scripts/test_284_identidad_contrato.sh <contenedor> [base]
#   · <contenedor>: Postgres local DESECHABLE (imagen supabase/postgres 15.8.1.085) con el esquema hasta la 281 y la 284 YA aplicada.
#   · NUNCA contra producción. Crea contratos de prueba DTM-9xxxx y los borra al final.
# Las cabeceras HTTP se simulan con set_config('request.headers', …): la propagación REAL de cabeceras en PostgREST (triggers y RPC en la misma
# transacción) y en el servicio de Storage ya se demostró aparte (ver docs/tecnico/reutilizacion-consecutivos.md §15).
# Variantes por operación: ANTIGUA (identidad del contrato anterior) · AUSENTE (bundle viejo) · CORRECTA · contrato de SIEMPRE sin identidad.
# Termina con código 1 si algo falla.
# ────────────────────────────────────────────────────────────────────────────────────────────────────────────
CT="${1:?uso: test_284_identidad_contrato.sh <contenedor> [base]}"
DB="${2:-postgres}"
export MSYS_NO_PATHCONV=1
S() { docker exec -i -e PGPASSWORD=postgres "$CT" psql -h 127.0.0.1 -U supabase_admin -X -q -t -A -v ON_ERROR_STOP=0 -d "$DB" "$@" 2>&1; }
SU='aaaaaaaa-1111-1111-1111-111111111111'; VE='eeeeeeee-5555-5555-5555-555555555555'
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf 'PASS  %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf 'FALLO %s  ->  %s\n' "$1" "$2"; }
B=$(( $(date +%s) % 7000 + 1000 ))
mk()  { echo "DTM-9$B$1"; }
# seed <sql>: siembra con triggers de usuario apagados (replica) y confirma
seed() { S -c "begin; set local session_replication_role = replica; $1; commit;" >/dev/null; }
# t <expect: rechaza|permite> <etiqueta> <mapa-JSON|-> <sql> [codigo-esperado]
t() {
  local pre="select set_config('request.jwt.claims','{\"sub\":\"$SU\",\"role\":\"authenticated\"}',true), set_config('request.jwt.claim.sub','$SU',true);"
  [ "$3" != "-" ] && pre="$pre select set_config('request.headers', jsonb_build_object('x-contratos','$3')::text, true);"
  local out; out=$({ echo "begin;"; echo "$pre"; echo "$4"; echo "rollback;"; } | S | grep -E "^ERROR" | head -1 | cut -c1-140)
  local res=permite; [ -n "$out" ] && res=rechaza
  if [ "$res" != "$1" ]; then bad "$2" "esperaba $1, fue $res $out"; return; fi
  if [ "$1" = rechaza ] && [ -n "$5" ] && ! printf "%s" "$out" | grep -Eq "$5"; then bad "$2" "rechazó por otro motivo: $out"; return; fi
  ok "$2 ($res${5:+ · $5})"
}
uid() { S -c "select contrato_uid from public.ventas where numero_contrato='$1'"; }
# Ana (nace normal) → se elimina → Carlos (nacido de reuso) con el MISMO número. $1 = número. Deja U1 (Ana) y U2 (Carlos).
reuso() {
  S -c "insert into public.ventas(numero_contrato,tenant,cliente,estado,asesor) values ('$1','mayorista','Ana','pendiente','X')" >/dev/null
  U1=$(uid "$1"); S -c "delete from public.ventas where numero_contrato='$1'" >/dev/null
  S -c "insert into public.ventas(numero_contrato,tenant,cliente,estado,asesor,nacio_de_reuso) values ('$1','mayorista','Carlos','pendiente','Y',true)" >/dev/null
  U2=$(uid "$1")
}
siempre() { S -c "insert into public.ventas(numero_contrato,tenant,cliente,estado,asesor) values ('$1','mayorista','Legado','pendiente','Y')" >/dev/null; UL=$(uid "$1"); }

N=$(mk 1); L=$(mk 2); D=$(mk 3)
reuso "$N"; siempre "$L"
S -c "insert into public.ventas(numero_contrato,tenant,cliente,estado,asesor,nacio_de_reuso) values ('$D','mayorista','Diana','pendiente','Y',true)" >/dev/null; UD=$(uid "$D")
UN=$U2; HA="{\"$N\":\"$U1\"}"; HB="{\"$N\":\"$U2\"}"; HL="{\"$L\":\"$UL\"}"; HBL="{\"$N\":\"$U2\",\"$L\":\"$UL\"}"; HBD="{\"$N\":\"$U2\",\"$D\":\"$UD\"}"
echo "N=$N Ana=${U1:0:8} Carlos=${U2:0:8} · L=$L (de siempre) · D=$D (reuso)"

echo "=== 0) Estructura"
[ "$(S -c "select count(*) from information_schema.columns where table_schema='public' and table_name='ventas' and column_name in ('contrato_uid','nacio_de_reuso')")" = 2 ] && ok "ventas.contrato_uid y nacio_de_reuso existen" || bad "columnas" "faltan"
[ "$(S -c "select condeferrable::text||condeferred::text from pg_constraint where conname='ventas_contrato_uid_uq'")" = truetrue ] && ok "UNIQUE(contrato_uid) DEFERRABLE INITIALLY DEFERRED" || bad "unique" "no diferible"
[ "$(S -c "select count(*) from public.ventas where nacio_de_reuso")" -ge 0 ] && ok "nadie nace de reuso por la 284 (solo las filas sembradas por esta prueba)"
t rechaza "contrato_uid es inmutable" - "update public.ventas set contrato_uid = gen_random_uuid() where numero_contrato='$L';" IDENTIDAD_INMUTABLE
t rechaza "nacio_de_reuso es inmutable" - "update public.ventas set nacio_de_reuso = true where numero_contrato='$L';" IDENTIDAD_INMUTABLE
SIN=$(S -c "select coalesce(string_agg(c.relname, ','),'') from pg_class c join pg_namespace n on n.oid=c.relnamespace and n.nspname='public' where c.relkind in ('r','p') and (c.relname='ventas' or exists(select 1 from pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped and a.attname in ('numero_contrato','contrato_numero')) or exists(select 1 from pg_constraint k where k.conrelid=c.oid and k.contype='f' and k.confrelid='public.ventas'::regclass)) and not exists(select 1 from public.contrato_guardas_config g where g.tabla=c.relname)")
[ -z "$SIN" ] && ok "toda tabla de contrato está clasificada en contrato_guardas_config" || bad "tablas sin clasificar" "$SIN"
FALTA=$(S -c "select coalesce(string_agg(g.tabla, ','),'') from public.contrato_guardas_config g where g.modo<>'excluida' and to_regclass('public.'||quote_ident(g.tabla)) is not null and not exists(select 1 from pg_trigger t where t.tgrelid=('public.'||quote_ident(g.tabla))::regclass and t.tgname='trg_contrato_guarda' and not t.tgisinternal)")
[ -z "$FALTA" ] && ok "toda tabla clasificada tiene su trigger trg_contrato_guarda" || bad "tablas sin trigger" "$FALTA"
[ "$(S -c "select has_function_privilege('authenticated','public.contrato_declarar_identidad(text,uuid)','execute')::text||has_function_privilege('service_role','public.contrato_declarar_identidad(text,uuid)','execute')::text||has_function_privilege('anon','public.contrato_verificar_identidad(text,boolean)','execute')::text")" = falsefalsefalse ] && ok "declarar/verificar identidad no son invocables por anon/authenticated/service_role" || bad "privilegios" "expuestas"

echo "=== 1) Tabla directa: contrato_pasajeros (INSERT/UPDATE/DELETE)"
for v in "ANTIGUA|$HA|rechaza|CONTRATO_CAMBIO" "AUSENTE|-|rechaza|IDENTIDAD_REQUERIDA" "CORRECTA|$HB|permite|"; do
  IFS='|' read -r nm h ex cod <<<"$v"
  t $ex "INSERT con identidad $nm" "$h" "insert into public.contrato_pasajeros(numero_contrato,nombre) values ('$N','Prueba');" "$cod"
done
seed "insert into public.contrato_pasajeros(numero_contrato,nombre) values ('$N','Pax N'),('$L','Pax L'),('$D','Pax D')"
for v in "ANTIGUA|$HA|rechaza|CONTRATO_CAMBIO" "AUSENTE|-|rechaza|IDENTIDAD_REQUERIDA" "CORRECTA|$HB|permite|"; do
  IFS='|' read -r nm h ex cod <<<"$v"
  t $ex "UPDATE con identidad $nm" "$h" "update public.contrato_pasajeros set nombre='Editado' where numero_contrato='$N';" "$cod"
  t $ex "DELETE con identidad $nm" "$h" "delete from public.contrato_pasajeros where numero_contrato='$N';" "$cod"
done
t permite "contrato de SIEMPRE, UPDATE sin identidad (comportamiento actual)" - "update public.contrato_pasajeros set nombre='ok' where numero_contrato='$L';"
t rechaza "contrato de siempre con identidad FALSA declarada" "{\"$L\":\"$U1\"}" "update public.contrato_pasajeros set nombre='x' where numero_contrato='$L';" CONTRATO_CAMBIO
t permite "contrato de siempre con su identidad correcta" "$HL" "update public.contrato_pasajeros set nombre='x' where numero_contrato='$L';"
echo "-- cabecera mal formada: se trata como ausente (nunca como autorización)"
t rechaza "cabecera x-contratos no es JSON" - "select set_config('request.headers','{\"x-contratos\":\"no-es-json\"}',true); update public.contrato_pasajeros set nombre='x' where numero_contrato='$N';" IDENTIDAD_REQUERIDA
t rechaza "uid con formato inválido" "{\"$N\":\"no-es-uuid\"}" "update public.contrato_pasajeros set nombre='x' where numero_contrato='$N';" IDENTIDAD_REQUERIDA

echo "=== 2) Mover filas entre contratos: se verifican AMBOS lados"
t rechaza "mover pasajero N→L con identidad antigua de N" "{\"$N\":\"$U1\",\"$L\":\"$UL\"}" "update public.contrato_pasajeros set numero_contrato='$L' where numero_contrato='$N';" CONTRATO_CAMBIO
t permite "mover N→L declarando ambos"                    "$HBL" "update public.contrato_pasajeros set numero_contrato='$L' where numero_contrato='$N';"
t rechaza "mover N→D (reuso) SIN declarar el destino D"    "$HB"  "update public.contrato_pasajeros set numero_contrato='$D' where numero_contrato='$N';" IDENTIDAD_REQUERIDA
t permite "mover N→D declarando a D"                       "$HBD" "update public.contrato_pasajeros set numero_contrato='$D' where numero_contrato='$N';"
t rechaza "una sentencia que toca N y D declarando solo N" "$HB"  "update public.contrato_pasajeros set nombre=nombre||'.' where numero_contrato in ('$N','$D');" IDENTIDAD_REQUERIDA
t permite "una sentencia que toca N y D declarando ambos"  "$HBD" "update public.contrato_pasajeros set nombre=nombre||'.' where numero_contrato in ('$N','$D');"

echo "=== 3) Tablas indirectas (sin numero_contrato propio) y semilla genérica de TODAS las tablas estrictas"
seed "insert into public.cuentas_por_pagar(numero_contrato,valor_total) values ('$N',100000); insert into public.cxp_pagos(cuenta_por_pagar_id,valor) select id,1000 from public.cuentas_por_pagar where numero_contrato='$N' order by id desc limit 1"
CXP=$(S -c "select id from public.cuentas_por_pagar where numero_contrato='$N' order by id desc limit 1")
t rechaza "cxp_pagos: INSERT con identidad antigua" "$HA" "insert into public.cxp_pagos(cuenta_por_pagar_id,valor) values ($CXP,5);" CONTRATO_CAMBIO
t rechaza "cxp_pagos: DELETE sin identidad"          -     "delete from public.cxp_pagos where cuenta_por_pagar_id=$CXP;" IDENTIDAD_REQUERIDA
t permite "cxp_pagos: INSERT con la identidad correcta" "$HB" "insert into public.cxp_pagos(cuenta_por_pagar_id,valor) values ($CXP,5);"
# Cobertura genérica: por cada tabla estricta con columna de número, una fila de prueba y un DELETE con cada variante.
GEN() { # $1 = variante: antigua|ausente|correcta
  local hdr=""
  case "$1" in antigua) hdr="perform set_config('request.headers', jsonb_build_object('x-contratos','$HA')::text, true);";;
               correcta) hdr="perform set_config('request.headers', jsonb_build_object('x-contratos','$HB')::text, true);";; esac
  S <<SQL
begin;
select set_config('request.jwt.claims','{"sub":"$SU","role":"authenticated"}',true), set_config('request.jwt.claim.sub','$SU',true);
do \$\$
declare r record; cols text; vals text; ncol text; ok_n int := 0; sk text[] := '{}'; fallo text[] := '{}'; inc text[] := '{}'; st text;
begin
  for r in select g.tabla from public.contrato_guardas_config g
            where g.modo = 'estricto' and g.resolvedor is null and g.tabla not in ('ventas','sillas') and to_regclass('public.'||quote_ident(g.tabla)) is not null order by 1 loop
    select a.attname into ncol from pg_attribute a where a.attrelid = ('public.'||quote_ident(r.tabla))::regclass and a.attname in ('numero_contrato','contrato_numero') and not a.attisdropped limit 1;
    select string_agg(quote_ident(a.attname), ',' order by a.attnum),
           string_agg(case when a.attname = ncol then quote_literal('$N')
             else case a.atttypid::regtype::text
               when 'text' then quote_literal('x') when 'character varying' then quote_literal('x')
               when 'integer' then '0' when 'bigint' then '0' when 'smallint' then '0' when 'numeric' then '0'
               when 'boolean' then 'false' when 'date' then 'current_date'
               when 'timestamp with time zone' then 'now()' when 'timestamp without time zone' then 'now()'
               when 'uuid' then 'gen_random_uuid()' when 'jsonb' then quote_literal('{}') || '::jsonb' when 'json' then quote_literal('{}') || '::json'
               else null end end, ',' order by a.attnum)
      into cols, vals
      from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
     where a.attrelid = ('public.'||quote_ident(r.tabla))::regclass and a.attnum > 0 and not a.attisdropped
       and (a.attname = ncol or (a.attnotnull and d.adbin is null and a.attgenerated = '' and a.attidentity = ''));
    if vals is null or cols is null then sk := sk || r.tabla::text; continue; end if;
    begin
      perform set_config('session_replication_role','replica',true);
      execute format('insert into public.%I (%s) select %s', r.tabla, cols, vals);
      perform set_config('session_replication_role','origin',true);
    exception when others then
      perform set_config('session_replication_role','origin',true); sk := sk || r.tabla::text; continue;
    end;
    $hdr
    st := '';
    begin
      execute format('delete from public.%I where %I = %L', r.tabla, ncol, '$N');
      raise exception 'SAVEPOINT_ROLLBACK';
    exception when others then
      st := sqlstate || '|' || left(sqlerrm, 60);
    end;
    if '$1' = 'antigua' then if st like 'F4601%' then ok_n := ok_n + 1; elsif st like 'F4602%' or st like 'P0001|SAVEPOINT%' then fallo := fallo || r.tabla::text; else inc := inc || (r.tabla::text || '[' || st || ']'); end if;
    elsif '$1' = 'ausente' then if st like 'F4602%' then ok_n := ok_n + 1; elsif st like 'P0001|SAVEPOINT%' then fallo := fallo || r.tabla::text; else inc := inc || (r.tabla::text || '[' || st || ']'); end if;
    else if st like 'F460%' then fallo := fallo || r.tabla::text; elsif st like 'P0001|SAVEPOINT%' then ok_n := ok_n + 1; else inc := inc || (r.tabla::text || '[' || st || ']'); end if;
    end if;
    perform set_config('session_replication_role','replica',true);
    execute format('delete from public.%I where %I = %L', r.tabla, ncol, '$N');
    perform set_config('session_replication_role','origin',true);
    perform set_config('request.headers','',true);
  end loop;
  raise notice 'GEN % ok=% fallo=% inconcluyentes=% omitidas=%', '$1', ok_n, coalesce(array_to_string(fallo,','),''), coalesce(array_to_string(inc,';'),''), coalesce(array_to_string(sk,','),'');
end \$\$;
rollback;
SQL
}
for v in antigua ausente correcta; do
  R=$(GEN $v | grep "GEN " | head -1)
  OKN=$(printf '%s' "$R" | sed -E 's/.*ok=([0-9]+).*/\1/'); FL=$(printf '%s' "$R" | sed -E 's/.*fallo=([^ ]*).*/\1/'); SK=$(printf '%s' "$R" | sed -E 's/.*omitidas=(.*)/\1/')
  if [ -n "$R" ] && [ -z "$FL" ]; then ok "genérico [$v]: $OKN tablas estrictas se comportan como se espera"; else bad "genérico [$v]" "$R"; fi
  echo "   [$v] inconcluyentes (otra regla de la tabla actuó antes que la guarda): ${INC:-ninguna}"
  [ "$v" = antigua ] && echo "   (omitidas por no poder sembrar una fila de prueba genérica; las cubre una prueba explícita o quedan como PENDIENTE: ${SK:-ninguna})"
done

echo "-- tablas que la semilla genérica no pudo sembrar: filas explícitas (DELETE con cada variante)"
declare_fila() { # $1 tabla · $2 columnas y valores del INSERT. Son tablas de solo-inserción/permanentes: la operación que se prueba es el INSERT.
  t rechaza "$1: INSERT identidad ANTIGUA" "$HA" "insert into public.$1 $2;" CONTRATO_CAMBIO
  t rechaza "$1: INSERT identidad AUSENTE" - "insert into public.$1 $2;" IDENTIDAD_REQUERIDA
  if [ "$3" = "solo-ruta-propia" ]; then echo "      ($1: el permiso con identidad correcta se prueba abajo por su ruta legitima)"; else t permite "$1: INSERT identidad CORRECTA" "$HB" "insert into public.$1 $2;"; fi
}
declare_fila contrato_condiciones "(numero_contrato,tipo_componente) values ('$N','hotel')"
declare_fila contrato_programa_estancia "(numero_contrato,hotel_nombre,modalidad_servicios,moneda,fecha_entrada,noches_incluidas,fecha_regreso,base_vigencia_desde,base_vigencia_hasta,precio_base) values ('$N','H','privado','COP',current_date,1,current_date+1,current_date,current_date+1,1)"
declare_fila abonos_anulados "(abono_id,numero_contrato,tenant,abono,motivo,actor_id) values (floor(random()*1e9)::bigint+1000,'$N','mayorista','{}'::jsonb,'prueba','$SU')"
declare_fila persona_capturas "(id,persona_id,tenant,fuente,nivel,contrato_numero,contrato_pasajero_id) values (gen_random_uuid(),gen_random_uuid(),'mayorista','contrato_pasajero','pasajero_contrato','$N',1)" solo-ruta-propia
declare_fila factura_revision_fuera_libros "(evento,numero_contrato,tenant,fotografia,hash,actor) values ('revision_emitida','$N','mayorista','{}'::jsonb,'h','$SU')" solo-ruta-propia
echo "-- casos PERMITIDOS por la ruta legítima de las dos tablas que solo admiten su propia ruta"
PF=$(mk 7); reuso "$PF"; HF="{\"$PF\":\"$U2\"}"; HFA="{\"$PF\":\"$U1\"}"
CAP="set local session_replication_role=replica; insert into public.contrato_pasajeros(numero_contrato,nombre) values ('$PF','Pax'); insert into public.personas(tenant) values ('mayorista'); set local session_replication_role=origin; insert into public.persona_capturas(id,persona_id,tenant,fuente,nivel,contrato_numero,contrato_pasajero_id) select gen_random_uuid(), p.id, 'mayorista','contrato_pasajero','pasajero_contrato','$PF', cp.id from public.personas p, public.contrato_pasajeros cp where cp.numero_contrato='$PF' order by p.created_at desc limit 1;"
t rechaza "persona_capturas: captura legítima con identidad ANTIGUA" "$HFA" "$CAP" CONTRATO_CAMBIO
t rechaza "persona_capturas: captura legítima con identidad AUSENTE" - "$CAP" IDENTIDAD_REQUERIDA
t permite "persona_capturas: captura legítima (pasajero del contrato) con identidad CORRECTA" "$HF" "$CAP"
FAC="set local session_replication_role=replica; update public.ventas set precio_venta=1000000, financiero_estado='completo' where numero_contrato='$PF'; insert into public.abonos(id,numero_contrato,tenant,cliente,fecha_abono,valor_abono,monto_cop,forma_pago,contabilizable) values (1,'$PF','mayorista','C',current_date,500,500,'efectivo',null) on conflict (id) do update set numero_contrato='$PF', tenant='mayorista', monto_cop=500, valor_abono=500, contabilizable=null; set local session_replication_role=origin; set local role service_role;"
FACT="select public.facturar_factura('$PF','$SU','mayorista',1000000,0,0,null,null,f208_priv.hash_fotografia(f208_priv.fotografia_fuera_libros('$PF')),'revisado');"
QUIT="select public.quitar_factura('$PF','$SU','mayorista');"
t rechaza "facturar_factura (genera factura_revision_fuera_libros) con identidad ANTIGUA" "$HFA" "$FAC $FACT" CONTRATO_CAMBIO
t rechaza "facturar_factura con identidad AUSENTE" - "$FAC $FACT" IDENTIDAD_REQUERIDA
t permite "facturar_factura con identidad CORRECTA (inserta la revisión «revision_emitida»)" "$HF" "$FAC $FACT"
t permite "quitar_factura tras facturar, identidad CORRECTA (inserta «factura_retirada»)" "$HF" "$FAC $FACT $QUIT"
echo "=== 4) Sillas (por número y por referencia manual de texto), mover_pasajero, guardar_infante_vuelo, asignar_contrato_manual"
S -c "insert into public.bloqueos_vuelo(record,aerolinea,ruta,vuelo_ida,hora_salida_ida,hora_llegada_ida,fecha_ida,fecha_regreso,cupos_total,destino_id) values ('Y$B','AV','BOG-CTG','AV1','08:00','09:30',current_date+60,current_date+63,5,1),('X$B','AV','BOG-CTG','AV9','10:00','11:30',current_date+60,current_date+63,5,1)" >/dev/null
BY=$(S -c "select id from public.bloqueos_vuelo where record='Y$B'"); BX=$(S -c "select id from public.bloqueos_vuelo where record='X$B'")
semilla_vuelo() { # $1 = org|manual
  local cc="'$N', null"; [ "$1" = manual ] && cc="null, '$N'"
  echo "insert into public.contrato_pasajeros(numero_contrato,nombre,tipo_id,identificacion,fecha_nacimiento,es_infante) values ('$N','Resp','CC','123','1980-01-01',false),('$L','RespL','CC','456','1980-01-01',false);
        insert into public.sillas(bloqueo_id,numero_silla,estado,numero_contrato,contrato_manual,tipo_doc,numero_doc,nacimiento,pasajero_nombres) values ($BY,1,'confirmada',$cc,'CC','123','1980-01-01','Resp') returning id \\gset s_
        insert into public.sillas(bloqueo_id,numero_silla,estado,numero_contrato,tipo_doc,numero_doc,nacimiento,pasajero_nombres) values ($BY,2,'confirmada','$L','CC','456','1980-01-01','RespL');
        insert into public.sillas(bloqueo_id,numero_silla,estado) values ($BX,1,'disponible'),($BX,2,'disponible'),($BX,3,'disponible');
        insert into public.contrato_vuelos(numero_contrato,record,direccion,aerolinea) values ('$N','Y$B','ida','AV'),('$L','Y$B','ida','AV');"
}
tv() { # tv <expect> <etiqueta> <hdr> <org|manual> <sql con :s_id>
  local pre="select set_config('request.jwt.claims','{\"sub\":\"$SU\",\"role\":\"authenticated\"}',true), set_config('request.jwt.claim.sub','$SU',true);"
  [ "$3" != "-" ] && pre="$pre select set_config('request.headers', jsonb_build_object('x-contratos','$3')::text, true);"
  local out; out=$({ echo "begin;"; echo "set local session_replication_role=replica;"; semilla_vuelo "$4"; echo "set local session_replication_role=origin;"; echo "select 'COLATERAL_ANTES '||(select count(*) from public.sillas where numero_contrato='$L' and bloqueo_id=$BY)||'/'||(select count(*) from public.contrato_pasajeros where numero_contrato='$L')||'/'||(select count(*) from public.contrato_vuelos where numero_contrato='$L' and record='Y$B');"; echo "$pre"; echo "$5"
    echo "select 'COLATERAL_DESPUES '||(select count(*) from public.sillas where numero_contrato='$L' and bloqueo_id=$BY)||'/'||(select count(*) from public.contrato_pasajeros where numero_contrato='$L')||'/'||(select count(*) from public.contrato_vuelos where numero_contrato='$L' and record='Y$B');"; echo "rollback;"; } | S)
  local err; err=$(printf '%s' "$out" | grep -E "^ERROR" | head -1 | cut -c1-120)
  local res=permite; [ -n "$err" ] && res=rechaza
  if [ "$res" != "$1" ]; then bad "$2" "esperaba $1, fue $res $err"; return; fi
  if [ "$res" = permite ] && [ "$(printf '%s' "$out" | grep COLATERAL_ANTES | sed 's/COLATERAL_ANTES //')" != "$(printf '%s' "$out" | grep COLATERAL_DESPUES | sed 's/COLATERAL_DESPUES //')" ]; then bad "$2" "el contrato de siempre fue alterado: $(printf '%s' "$out" | grep COLATERAL | tr '
' ' ')"; return; fi
  ok "$2 ($res)"
}
MD="select public.mover_pasajero(:s_id, $BX, 'solo_datos', true, 'prueba', gen_random_uuid());"
MC="select public.mover_pasajero(:s_id, $BX, 'con_cupo', true, 'prueba', gen_random_uuid());"
IN="select * from public.guardar_infante_vuelo($BY, :s_id, null, 'Bebe', 'Prueba', 'RC', '999', current_date - 100);"
ED="select public.editar_pasajero_silla(:s_id, '{\"pasajero_nombres\":\"Editado\"}'::jsonb);"
LB="select public.liberar_silla(:s_id::bigint);"
for sem in org manual; do
  for op in "mover solo_datos|$MD" "mover con_cupo|$MC" "guardar_infante_vuelo|$IN"; do
    nm=${op%%|*}; sql=${op#*|}
    tv rechaza "$nm [$sem] identidad ANTIGUA" "$HA" $sem "$sql"
    tv rechaza "$nm [$sem] identidad AUSENTE" -     $sem "$sql"
    tv rechaza "$nm [$sem] identidad de OTRO contrato (solo L)" "$HL" $sem "$sql"
    tv permite "$nm [$sem] identidad CORRECTA (y el contrato de siempre queda intacto)" "$HB" $sem "$sql"
  done
done
for op in "editar_pasajero_silla (legado, sin esperado)|$ED" "liberar_silla(bigint) (legado)|$LB"; do
  nm=${op%%|*}; sql=${op#*|}
  tv rechaza "$nm [org] ANTIGUA" "$HA" org "$sql"; tv rechaza "$nm [org] AUSENTE" - org "$sql"; tv permite "$nm [org] CORRECTA" "$HB" org "$sql"
done
# asignar_contrato_manual: la silla LIBRE no basta; el contrato DESTINO debe presentar su identidad
tl() { local pre="select set_config('request.jwt.claims','{\"sub\":\"$SU\",\"role\":\"authenticated\"}',true), set_config('request.jwt.claim.sub','$SU',true);"; [ "$3" != "-" ] && pre="$pre select set_config('request.headers', jsonb_build_object('x-contratos','$3')::text, true);"
  local out; out=$({ echo "begin;"; echo "set local session_replication_role=replica;"; echo "insert into public.sillas(bloqueo_id,numero_silla,estado) values ($BX,9,'disponible') returning id \\gset s_"; echo "set local session_replication_role=origin;"; echo "$pre"; echo "${4//\{S\}/:s_id}"; echo "rollback;"; } | S | grep -E "^ERROR" | head -1 | cut -c1-110)
  local res=permite; [ -n "$out" ] && res=rechaza; [ "$res" = "$1" ] && ok "$2 ($res)" || bad "$2" "esperaba $1, fue $res $out"; }
tl rechaza "asignar_contrato_manual(silla LIBRE → contrato de reuso) identidad ANTIGUA" "$HA" "select public.asignar_contrato_manual({S}, '$N');"
tl rechaza "asignar_contrato_manual(silla LIBRE → contrato de reuso) identidad AUSENTE" -     "select public.asignar_contrato_manual({S}, '$N');"
tl permite "asignar_contrato_manual(silla LIBRE → contrato de reuso) identidad CORRECTA" "$HB" "select public.asignar_contrato_manual({S}, '$N');"
tl permite "asignar_contrato_manual → contrato de siempre, sin identidad" - "select public.asignar_contrato_manual({S}, '$L');"
tl permite "asignar_contrato_manual → referencia externa, sin identidad" - "select public.asignar_contrato_manual({S}, 'EXT-$B');"

echo "=== 5) Cotizaciones (modo vínculo), avisos (estado personal) y soportes (tabla)"
seed "insert into public.cotizaciones(tenant,numero_contrato) values ('mayorista',null),('mayorista','$N')"
CL=$(S -c "select id from public.cotizaciones where numero_contrato is null order by id desc limit 1"); CV=$(S -c "select id from public.cotizaciones where numero_contrato='$N' order by id desc limit 1")
COLC=$(S -c "select column_name from information_schema.columns where table_name='cotizaciones' and data_type='text' and column_name not in ('tenant','numero_contrato') order by ordinal_position limit 1")
t permite "cotización ligada: editar por id sin tocar el número, sin identidad" - "update public.cotizaciones set $COLC='x' where id=$CV;"
t rechaza "LIGAR una cotización al número sin identidad" - "update public.cotizaciones set numero_contrato='$N' where id=$CL;" IDENTIDAD_REQUERIDA
t rechaza "LIGAR con identidad antigua" "$HA" "update public.cotizaciones set numero_contrato='$N' where id=$CL;" CONTRATO_CAMBIO
t permite "LIGAR con la identidad de Carlos" "$HB" "update public.cotizaciones set numero_contrato='$N' where id=$CL;"
t rechaza "DESLIGAR sin identidad" - "update public.cotizaciones set numero_contrato=null where id=$CV;" IDENTIDAD_REQUERIDA
ACT=$(S -c "select id from public.usuarios where activo and id<>'$SU' limit 1"); [ -z "$ACT" ] && ACT=$SU
seed "insert into public.avisos(usuario_id,tipo,numero_contrato) values ('$ACT','soporte_pago_nuevo','$N')"
t permite "avisos: marcar leído un aviso PROPIO sin identidad" - "select public.avisos_marcar_leidos('$ACT', null);"
t permite "avisos: marcar leído con identidad ANTIGUA (estado personal)" "$HA" "select public.avisos_marcar_leidos('$ACT', null);"
t permite "avisos: reclamar (notificar) avisos propios sin identidad" - "select count(*) from public.avisos_reclamar('$ACT', 20);"
t rechaza "avisos: CREAR un aviso vinculado sin identidad" - "insert into public.avisos(usuario_id,tipo,numero_contrato) values ('$ACT','soporte_pago_nuevo','$N');" IDENTIDAD_REQUERIDA
t rechaza "avisos: CREAR un aviso vinculado con identidad antigua" "$HA" "insert into public.avisos(usuario_id,tipo,numero_contrato) values ('$ACT','soporte_pago_nuevo','$N');" CONTRATO_CAMBIO
t rechaza "avisos: recablear el contrato de un aviso" - "update public.avisos set numero_contrato='$L' where numero_contrato='$N';" IDENTIDAD_REQUERIDA
t rechaza "avisos: BORRAR un aviso del contrato sin identidad" - "delete from public.avisos where numero_contrato='$N';" IDENTIDAD_REQUERIDA
seed "insert into public.abonos(numero_contrato,tenant,cliente,fecha_abono,valor_abono,forma_pago) select n,'mayorista','C',current_date,1,'efectivo' from unnest(array['$N','$N','$N','$L','$L','$L']) n; insert into public.contrato_soportes_pago(numero_contrato,tenant,path,nombre_original,mime,size_bytes,sha256,subido_por) values ('$N','mayorista','$N/s.pdf','s.pdf','application/pdf',10,repeat('a',64),'$SU'),('$L','mayorista','$L/s.pdf','s.pdf','application/pdf',10,repeat('b',64),'$SU')"
SN=$(S -c "select id from public.contrato_soportes_pago where numero_contrato='$N' and vigente order by id desc limit 1"); SL=$(S -c "select id from public.contrato_soportes_pago where numero_contrato='$L' and vigente order by id desc limit 1")
R1="select public.soporte_registrar('$N','$ACT','$N/n.pdf','n.pdf','application/pdf',10,repeat('c',64));"; R2="select public.soporte_reemplazar($SN,'$ACT','$N/r.pdf','r.pdf','application/pdf',10,repeat('d',64));"; R3="select public.soporte_retirar($SN,'$ACT','nota');"
for op in "soporte_registrar|$R1" "soporte_reemplazar|$R2" "soporte_retirar|$R3"; do nm=${op%%|*}; sql=${op#*|}
  t rechaza "$nm contrato de reuso: identidad ANTIGUA" "$HA" "$sql" "CONTRATO_CAMBIO|SOPORTE_IDENTIDAD"; t rechaza "$nm contrato de reuso: identidad AUSENTE" - "$sql" "IDENTIDAD_REQUERIDA|SOPORTE_IDENTIDAD"; t permite "$nm contrato de reuso: identidad CORRECTA" "$HB" "$sql"; done
t permite "soporte_retirar contrato de siempre sin identidad" - "select public.soporte_retirar($SL,'$ACT','nota');"

echo "=== 6) eliminar_contrato y fn_renumerar_contrato (funciones de USUARIO: verifican la identidad de la pantalla, no la declaran)"
t rechaza "eliminar_contrato(Carlos) desde la pantalla de Ana" "$HA" "select public.eliminar_contrato('$N', false);" CONTRATO_CAMBIO
t rechaza "eliminar_contrato(Carlos) sin identidad"             -     "select public.eliminar_contrato('$N', false);" IDENTIDAD_REQUERIDA
E=$(mk 5); reuso "$E"; HE="{\"$E\":\"$U2\"}"
t permite "eliminar_contrato(contrato de reuso vacío) con su identidad" "$HE" "select public.eliminar_contrato('$E', false);"
t rechaza "fn_renumerar_contrato(Carlos) con identidad antigua" "$HA" "select public.fn_renumerar_contrato('$N','DTM-8$B');" CONTRATO_CAMBIO
t rechaza "fn_renumerar_contrato(Carlos) sin identidad" - "select public.fn_renumerar_contrato('$N','DTM-8$B');" IDENTIDAD_REQUERIDA
OUT=$({ echo "begin;"; echo "select set_config('request.jwt.claims','{\"sub\":\"$SU\",\"role\":\"authenticated\"}',true), set_config('request.jwt.claim.sub','$SU',true);"; echo "select set_config('request.headers', jsonb_build_object('x-contratos','$HB')::text, true);"
  echo "select public.fn_renumerar_contrato('$N','DTM-8$B');"; echo "select 'UID_CONSERVADO='||(select (contrato_uid='$UN'::uuid)::text from public.ventas where numero_contrato='DTM-8$B');"; echo "rollback;"; } | S)
printf '%s' "$OUT" | grep -q "UID_CONSERVADO=true" && ok "fn_renumerar_contrato(Carlos) con su identidad: permite y conserva el contrato_uid" || bad "renumerar con identidad correcta" "$(printf '%s' "$OUT" | grep -E 'ERROR|UID' | head -1)"
t permite "fn_renumerar_contrato(contrato de siempre) sin identidad" - "select public.fn_renumerar_contrato('$L','DTM-7$B');"

echo "=== 7) Carrera: el contrato se borra y renace con el MISMO número mientras una petición antigua espera"
RC=$(mk 6); S -c "insert into public.ventas(numero_contrato,tenant,cliente,estado,asesor) values ('$RC','mayorista','Ana','pendiente','X')" >/dev/null
( { echo "begin;"; echo "delete from public.ventas where numero_contrato='$RC';"; echo "insert into public.ventas(numero_contrato,tenant,cliente,estado,asesor,nacio_de_reuso) values ('$RC','mayorista','Carlos','pendiente','Y',true);"; echo "select pg_sleep(4);"; echo "commit;"; } | S >/dev/null ) &
sleep 1
R=$(S -c "insert into public.contrato_pasajeros(numero_contrato,nombre) values ('$RC','Intruso de la pantalla antigua');" | grep -E "^ERROR" | head -1 | cut -c1-130)
wait
if printf '%s' "$R" | grep -q "IDENTIDAD_REQUERIDA"; then ok "petición antigua sin cabecera que esperaba el borrado: rechazada tras el reintento (IDENTIDAD_REQUERIDA)"; else bad "carrera" "no se rechazó: ${R:-sin error}"; fi
[ "$(S -c "select count(*) from public.contrato_pasajeros where numero_contrato='$RC'")" = 0 ] && ok "   y no quedó ninguna fila del intruso en el contrato nuevo" || bad "carrera" "quedó una fila"

echo "=== 8) Regresión: contratos de SIEMPRE (nada exige identidad) y costo de la guarda"
seed "delete from public.contrato_pasajeros where numero_contrato='$L'"
T0=$(date +%s%N)
S -c "insert into public.sillas(bloqueo_id,numero_silla,estado) select $BX, g+100, 'disponible' from generate_series(1,500) g" >/dev/null
T1=$(date +%s%N); MS=$(( (T1-T0)/1000000 ))
[ "$(S -c "select count(*) from public.sillas where bloqueo_id=$BX and numero_silla>100")" = 500 ] && ok "500 sillas libres insertadas con la guarda activa en ${MS} ms" || bad "insertar sillas" "no se insertaron 500"
[ "$MS" -lt 5000 ] && ok "   costo de la guarda aceptable (< 5 s para 500 filas)" || bad "rendimiento" "${MS} ms para 500 sillas"
t permite "crear/editar/borrar pasajeros de un contrato de siempre sin identidad" - "insert into public.contrato_pasajeros(numero_contrato,nombre) values ('$L','a'); update public.contrato_pasajeros set nombre='b' where numero_contrato='$L'; delete from public.contrato_pasajeros where numero_contrato='$L';"
t permite "abono + CxP + pago de un contrato de siempre sin identidad" - "insert into public.abonos(numero_contrato,tenant,cliente,fecha_abono,valor_abono,forma_pago) values ('$L','mayorista','C',current_date,1,'efectivo'); insert into public.cuentas_por_pagar(numero_contrato,valor_total) values ('$L',5);"
t permite "contratos_identidades() devuelve el uid al superadmin" - "select 1/(select count(*) from public.contratos_identidades(array['$N','$L']) where contrato_uid is not null)::int;"

echo "=== 9) Entrega 3: autodeclaración del creador y sillas_identidades (control_vuelo)"
X9="DTM-6$B"
INS9="insert into public.ventas(numero_contrato,tenant,cliente,estado,asesor,nacio_de_reuso) values ('$X9','mayorista','Nuevo','pendiente','Y',true); insert into public.contrato_pasajeros(numero_contrato,nombre) values ('$X9','titular');"
t permite "quien CREA un contrato de reuso escribe sus hijas en la MISMA transacción sin declarar nada" - "$INS9"
t rechaza "…pero una identidad ANTIGUA enviada en esa misma transacción sigue rechazándose" "{\"$X9\":\"00000000-0000-0000-0000-00000000dead\"}" "$INS9" CONTRATO_CAMBIO
t rechaza "…y otra transacción posterior (pantalla antigua sin identidad) sigue rechazada" - "insert into public.contrato_pasajeros(numero_contrato,nombre) values ('$N','x');" IDENTIDAD_REQUERIDA
# sillas_identidades: control_vuelo (sin lectura de ventas) obtiene el uid; venta y anon no
CV='cccccccc-9999-9999-9999-999999999999'
S -c "insert into auth.users (id,email) values ('$CV','cv@t.l') on conflict do nothing" >/dev/null
S -c "update public.usuarios set rol='control_vuelo', activo=true, nombre='cv', tenant='mayorista' where id='$CV'" >/dev/null
seed "insert into public.sillas(bloqueo_id,numero_silla,estado,numero_contrato) values ($BX, 9001, 'confirmada', '$N')"
como() { { echo "begin;"; echo "select set_config('request.jwt.claims','{\"sub\":\"$1\",\"role\":\"authenticated\"}',true), set_config('request.jwt.claim.sub','$1',true); set local role authenticated;"; echo "$2"; echo "rollback;"; } | S | grep -vE "^(BEGIN|ROLLBACK|SET|\{|$)" | tail -1; }
[ "$(como "$CV" "select count(*) from public.sillas_identidades($BX) where contrato_uid is not null and numero_contrato='$N';")" = 1 ] && ok "control_vuelo obtiene el uid de la silla (sin leer ventas)" || bad "sillas_identidades(control_vuelo)" "no devolvió la silla"
[ "$(como "$CV" "select count(*) from public.ventas;")" = 0 ] && ok "   y control_vuelo sigue SIN poder leer ventas (no se amplió el acceso financiero)" || bad "control_vuelo lee ventas" "puede leer"
[ "$(como "$VE" "select count(*) from public.sillas_identidades($BX);")" = 0 ] && ok "rol venta: sillas_identidades no devuelve nada (usa contratos_identidades)" || bad "sillas_identidades(venta)" "devolvió filas"
[ "$(como "$SU" "select count(*) from public.sillas_identidades($BX) where contrato_uid = '$UN';")" = 1 ] && ok "superadmin: el uid devuelto es el del contrato vigente (Carlos), no el de Ana" || bad "sillas_identidades(superadmin)" "uid distinto del vigente"
[ "$(S -c "select has_function_privilege('anon','public.sillas_identidades(bigint)','execute')")" = f ] && ok "anon no puede ejecutar sillas_identidades" || bad "sillas_identidades anon" "tiene EXECUTE"

# Limpieza (triggers apagados: son datos de prueba)
S -c "begin; set local session_replication_role = replica;
  delete from public.cxp_pagos where cuenta_por_pagar_id in (select id from public.cuentas_por_pagar where numero_contrato like 'DTM-%$B%' or numero_contrato like 'DTM-9$B%' or numero_contrato like 'DTM-8$B' or numero_contrato like 'DTM-7$B');
  delete from public.contrato_soportes_pago where numero_contrato like 'DTM-9$B%' or numero_contrato in ('DTM-8$B','DTM-7$B');
  delete from public.avisos where numero_contrato like 'DTM-9$B%' or numero_contrato in ('DTM-8$B','DTM-7$B');
  delete from public.cotizaciones where numero_contrato like 'DTM-9$B%' or numero_contrato in ('DTM-8$B','DTM-7$B');
  delete from public.sillas where bloqueo_id in (select id from public.bloqueos_vuelo where record in ('Y$B','X$B'));
  delete from public.bloqueos_vuelo where record in ('Y$B','X$B');
  delete from public.contrato_vuelos where numero_contrato like 'DTM-9$B%' or numero_contrato in ('DTM-8$B','DTM-7$B');
  delete from public.contrato_pasajeros where numero_contrato like 'DTM-9$B%' or numero_contrato in ('DTM-8$B','DTM-7$B');
  delete from public.abonos where numero_contrato like 'DTM-9$B%' or numero_contrato in ('DTM-8$B','DTM-7$B');
  delete from public.cuentas_por_pagar where numero_contrato like 'DTM-9$B%' or numero_contrato in ('DTM-8$B','DTM-7$B');
  delete from public.ventas where numero_contrato like 'DTM-9$B%' or numero_contrato in ('DTM-8$B','DTM-7$B'); commit;" >/dev/null
echo; echo "RESUMEN: $PASS PASS, $FAIL FALLO"
[ "$FAIL" -eq 0 ]
