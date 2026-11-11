#!/bin/sh
# #97 · concurrencia de la RPC 205 sobre UN contrato: 8 sesiones simultáneas → exactamente UNA comisión.
# Garantía distinta de "dos contratos por reintento": aquí es el MISMO contrato (FOR UPDATE + rechazo de duplicado).
# SOLO Docker local. Uso: sh test_97_carrera.sh <contenedor> <plantilla> <base_nueva ^t97c_[a-z0-9_]+$>
set -eu
CT="$1"; PLANTILLA="$2"; DB="$3"
printf '%s' "$DB" | grep -Eq '^t97c_[a-z0-9_]{1,30}$' || { echo "Base inválida" >&2; exit 2; }
export MSYS_NO_PATHCONV=1
PS="docker exec -i -e PGPASSWORD=postgres $CT psql -h 127.0.0.1 -U supabase_admin -X -q -t -A"
$PS -d template1 -c "create database $DB template $PLANTILLA" >/dev/null
trap '$PS -d template1 -c "drop database if exists $DB" >/dev/null 2>&1 || true' EXIT
$PS -d "$DB" >/dev/null <<'SQL'
insert into auth.users (id,email) values ('00000000-0000-0000-0000-000000097101','t97c@x.test');
insert into public.usuarios (id,email,nombre,rol,activo,tenant) values ('00000000-0000-0000-0000-000000097101','t97c@x.test','T97C','venta',true,'mayorista')
  on conflict (id) do update set rol='venta', activo=true, tenant='mayorista';
insert into public.aliados (id,nombre,tipo,pct_comision,nit) values (970101,'T97C Agencia','agencia',0.10,'900970101');
insert into public.ventas (numero_contrato,cliente,tenant,asesor,precio_venta,impuesto,estado,financiero_estado,tipo_asesor,aliado_id,canal,modo_compra,comision_b2b,comision_estado)
 values ('DTM-9801','C','mayorista','T97C',1000000,200000,'activo','pendiente','agencia',970101,'B2B','comisionable',80000,'pendiente');
SQL
OUT="$(mktemp -d)"
for i in 1 2 3 4 5 6 7 8; do
  ( $PS -d "$DB" -c "select set_config('request.jwt.claims','{\"sub\":\"00000000-0000-0000-0000-000000097101\",\"role\":\"authenticated\"}',false); set role authenticated; select public.registrar_comision_b2b_reserva('DTM-9801',970101)" > "$OUT/$i.txt" 2>&1 || true ) &
done
wait
ok=0; dup=0
for f in "$OUT"/*.txt; do
  if grep -q "ya tiene comisión B2B" "$f"; then dup=$((dup+1)); elif grep -Eq '^[0-9]+$' "$f" || tail -1 "$f" | grep -Eq '^[0-9]+$'; then ok=$((ok+1)); fi
done
filas="$($PS -d "$DB" -c "select count(*) from public.aliados_b2b where numero_contrato='DTM-9801'")"
echo "exitosas=$ok duplicadas_rechazadas=$dup filas=$filas"
[ "$ok" = 1 ] && [ "$dup" = 7 ] && [ "$filas" = 1 ] && echo "OK carrera: una sola comisión" || { echo "FALLA carrera"; cat "$OUT"/*.txt | head -20; exit 1; }
rm -rf "$OUT"
