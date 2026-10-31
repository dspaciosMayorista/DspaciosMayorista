#!/bin/sh
# Pruebas de la 263 (reemplazo ATÓMICO de precios por trayecto) en un Postgres local desechable. Nunca la base compartida.
# Uso (desde dspacios-travel/):  sh supabase/scripts/test_263_reemplazar_precios.sh <contenedor>
# Esquema mínimo: stubs de las tablas que toca + 255 + 262 + 263 reales. Cada comprobación compara la huella de las filas ANTES y DESPUÉS de un fallo.
set -u
CT="${1:-}"; export MSYS_NO_PATHCONV=1
printf '%s' "$CT" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$' || { echo "Uso: test_263_reemplazar_precios.sh <contenedor>" >&2; exit 2; }
AQUI="$(cd "$(dirname "$0")" && pwd)"; MIGS="$AQUI/../migrations"; DB=t263
FALLAS=0; OKS=0
SUPER() { docker exec -i -e PGPASSWORD=postgres "$CT" psql -h 127.0.0.1 -U supabase_admin -X -q "$@"; }
P()  { docker exec -i -e PGPASSWORD=postgres "$CT" psql -h 127.0.0.1 -U supabase_admin -d "$DB" -v ON_ERROR_STOP=1 -X -q "$@"; }
PA() { docker exec -i -e PGPASSWORD=postgres "$CT" psql -h 127.0.0.1 -U supabase_admin -d "$DB" -X -t -A "$@" </dev/null; }
PN() { docker exec -i -e PGPASSWORD=postgres "$CT" psql -h 127.0.0.1 -U supabase_admin -d "$DB" -X -q "$@" 2>&1 </dev/null; }
ok()  { OKS=$((OKS+1)); echo "  ok    $1"; }
bad() { FALLAS=$((FALLAS+1)); echo "  FALLA $1"; }
igual() { [ "$2" = "$3" ] && ok "$1" || bad "$1 (esperado '$2', obtenido '$3')"; }
HUELLA() { PA -c "select coalesce(md5(string_agg(servicio_temporada_id||'|'||alcance||'|'||coalesce(pax_desde::text,'-')||'|'||coalesce(pax_hasta::text,'-')||'|'||precio::text, ',' order by id)), 'vacio') from public.servicio_precio_alcance where servicio_temporada_id = $1"; }
N() { PA -c "select count(*) from public.servicio_precio_alcance where servicio_temporada_id = $1"; }
# Llama a la RPC como authenticated con el rol de negocio simulado ($3) y devuelve la salida (error incluido).
RPC() { PN -c "set role authenticated" -c "set test.rol = '$3'" -c "select public.reemplazar_precios_alcance($1, '$2'::jsonb)"; }

echo "== esquema mínimo =="
SUPER -d template1 -c "drop database if exists $DB" -c "create database $DB" >/dev/null
P <<'SQL'
create or replace function public.mi_rol() returns text language sql stable as $$ select coalesce(nullif(current_setting('test.rol', true), ''), 'superadmin') $$;
alter default privileges for role supabase_admin in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges for role supabase_admin in schema public grant all on sequences to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
create table public.proveedores (id bigserial primary key, nombre text);
create table public.destinos (id bigserial primary key, nombre text);
create table public.servicios_adicionales (id bigserial primary key, nombre text not null, categoria text, alcance text, precio_persona numeric, proveedor_id bigint, destino_id bigint);
create table public.servicio_temporadas (id bigserial primary key, servicio_id bigint not null references public.servicios_adicionales(id) on delete cascade, nombre text not null, fecha_inicio date, fecha_fin date);
create table public.servicio_tarifa_pax (id bigserial primary key, servicio_id bigint not null, pax_desde int, pax_hasta int, precio numeric, temporada text);
create table public.armado_servicios (paquete_id bigint, servicio_id bigint);
create table public.contrato_servicios (id bigserial primary key, numero_contrato text not null, tipo text not null default 'otro', descripcion text not null, proveedor text, costo numeric default 0, orden integer default 0);
insert into public.servicios_adicionales (nombre) values ('Traslado aeropuerto');
insert into public.servicio_temporadas (servicio_id, nombre, fecha_inicio, fecha_fin) values (1, 'GENERAL', null, null), (1, 'ALTA', '2030-01-01', '2030-03-31'), (1, 'BAJA', '2030-04-01', '2030-06-30');
SQL
for m in 20260601000255_servicio_suplementos_franja 20260601000262_servicio_tipo_alcance_rangos_suplemento 20260601000263_reemplazar_precios_alcance; do
  if P < "$MIGS/$m.sql" >/dev/null 2>/tmp/m263.err; then echo "  aplicada $m"; else echo "  FALLA aplicando $m: $(tail -2 /tmp/m263.err)"; exit 1; fi
done
# vigencias: 1 = GENERAL, 2 = ALTA, 3 = BAJA
BUENA='[{"alcance":"trayecto","precio":45000},{"alcance":"ida_regreso","precio":80000},{"alcance":"trayecto","pax_desde":5,"pax_hasta":12,"precio":60000}]'

echo "== 1. guardado correcto =="
S=$(RPC 2 "$BUENA" operaciones); echo "$S" | grep -q "3" && ok "devuelve 3 filas" || bad "guardado inicial: $S"
H0=$(HUELLA 2); igual "3 filas persistidas" 3 "$(N 2)"
igual "ida y regreso guarda SU precio (80000, no 2 x 45000)" 80000 "$(PA -c "select precio::int from public.servicio_precio_alcance where servicio_temporada_id=2 and alcance='ida_regreso'")"

echo "== 2. fallo INTERMEDIO (3ª fila inválida: la 1ª y 2ª ya se habrían insertado) =="
MAL='[{"alcance":"trayecto","precio":1},{"alcance":"ida_regreso","precio":2},{"alcance":"trayecto","precio":-5}]'
S=$(RPC 2 "$MAL" operaciones); echo "$S" | grep -qi "error" && ok "rechazado" || bad "no rechazó: $S"
igual "configuración anterior íntegra (huella)" "$H0" "$(HUELLA 2)"; igual "sigue habiendo 3 filas" 3 "$(N 2)"

echo "== 3. alcance ajeno / nulo / rango incompleto / dos precios por persona / rangos cruzados =="
while IFS= read -r caso; do
  S=$(RPC 2 "$caso" operaciones); echo "$S" | grep -qi "error" && ok "rechazado: $caso" || bad "no rechazó $caso: $S"
  igual "  íntegra tras ese caso" "$H0" "$(HUELLA 2)"
done <<'CASOS'
[{"alcance":"mitad","precio":1}]
[{"precio":1}]
[{"alcance":"trayecto","pax_desde":3,"precio":1}]
[{"alcance":"trayecto","precio":1},{"alcance":"trayecto","precio":2}]
[{"alcance":"trayecto","pax_desde":1,"pax_hasta":4,"precio":1},{"alcance":"trayecto","pax_desde":4,"pax_hasta":8,"precio":2}]
CASOS

echo "== 4. no es lista / vigencia nula / inexistente =="
S=$(PN -c "set role authenticated" -c "select public.reemplazar_precios_alcance(2, '{\"alcance\":\"trayecto\"}'::jsonb)"); echo "$S" | grep -qi "error" && ok "objeto en vez de lista rechazado" || bad "objeto: $S"
S=$(PN -c "set role authenticated" -c "select public.reemplazar_precios_alcance(NULL, '[]'::jsonb)"); echo "$S" | grep -qi "error" && ok "vigencia nula rechazada" || bad "nula: $S"
S=$(PN -c "set role authenticated" -c "select public.reemplazar_precios_alcance(999, '[]'::jsonb)"); echo "$S" | grep -qi "no encontrada" && ok "vigencia inexistente rechazada" || bad "inexistente: $S"
igual "íntegra tras argumentos inválidos" "$H0" "$(HUELLA 2)"

echo "== 5. GENERAL es histórico y no vendible =="
S=$(RPC 1 "$BUENA" operaciones); echo "$S" | grep -qi "histórica" && ok "GENERAL rechazada con su mensaje" || bad "GENERAL: $S"
igual "GENERAL sin precios por trayecto" 0 "$(N 1)"

echo "== 6. rol sin permiso (venta): ni el DELETE se conserva =="
S=$(RPC 2 "$BUENA" venta); echo "$S" | grep -qi "error" && ok "venta rechazada por RLS" || bad "venta pudo escribir: $S"
igual "íntegra tras rechazo de RLS" "$H0" "$(HUELLA 2)"
S=$(PN -c "set role anon" -c "select public.reemplazar_precios_alcance(2, '[]'::jsonb)"); echo "$S" | grep -qi "permission denied" && ok "anon sin EXECUTE" || bad "anon: $S"
igual "íntegra tras anon" "$H0" "$(HUELLA 2)"

echo "== 7. repetición: mismo payload dos veces = mismo estado, sin duplicados =="
RPC 2 "$BUENA" operaciones >/dev/null; RPC 2 "$BUENA" operaciones >/dev/null
igual "huella idéntica tras repetir" "$H0" "$(HUELLA 2)"; igual "sin duplicados" 3 "$(N 2)"

echo "== 8. reemplazo válido cambia TODO; otras vigencias no se tocan =="
RPC 3 '[{"alcance":"trayecto","precio":7000}]' gerencia >/dev/null; H3=$(HUELLA 3)
RPC 2 '[{"alcance":"trayecto","precio":50000},{"alcance":"ida_regreso","precio":90000}]' administracion >/dev/null
igual "ALTA ahora tiene 2 filas" 2 "$(N 2)"; igual "BAJA intacta" "$H3" "$(HUELLA 3)"
H2=$(HUELLA 2)

echo "== 9. lista vacía borra la configuración (acción explícita) =="
RPC 3 '[]' operaciones >/dev/null; igual "BAJA vacía" 0 "$(N 3)"; igual "ALTA intacta" "$H2" "$(HUELLA 2)"

echo "== 10. concurrencia: dos reemplazos simultáneos de la MISMA vigencia dejan UNA configuración completa =="
A='[{"alcance":"trayecto","precio":111},{"alcance":"ida_regreso","precio":222}]'
B='[{"alcance":"trayecto","precio":333},{"alcance":"ida_regreso","precio":444},{"alcance":"trayecto","pax_desde":2,"pax_hasta":3,"precio":555}]'
( RPC 2 "$A" operaciones >/dev/null ) & ( RPC 2 "$B" operaciones >/dev/null ) & wait
CNT=$(N 2); PRE=$(PA -c "select string_agg(precio::int::text, ',' order by precio) from public.servicio_precio_alcance where servicio_temporada_id=2")
if [ "$PRE" = "111,222" ] || [ "$PRE" = "333,444,555" ]; then ok "resultado coherente: $PRE ($CNT filas)"; else bad "mezcla de configuraciones: $PRE"; fi


echo "== 11. control negativo: el enfoque anterior (borrar y luego insertar, sin transacción) SÍ perdía datos =="
RPC 3 '[{"alcance":"trayecto","precio":1234}]' operaciones >/dev/null; HC=$(HUELLA 3)
PN -c "delete from public.servicio_precio_alcance where servicio_temporada_id = 3" >/dev/null
PN -c "insert into public.servicio_precio_alcance (servicio_temporada_id, alcance, precio) values (3, 'trayecto', -1)" >/dev/null
[ "$(N 3)" = "0" ] && ok "control: sin transacción la vigencia quedó VACÍA tras el fallo (lo que la RPC evita)" || bad "el control no reprodujo la pérdida"
echo
echo "Resumen 263: $OKS correctas, $FALLAS fallas"
[ "$FALLAS" -eq 0 ]
