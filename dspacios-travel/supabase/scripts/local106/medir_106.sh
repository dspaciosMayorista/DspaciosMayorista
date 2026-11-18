#!/bin/sh
# MEDICIÓN de fn_gestion_contratos (#106) sobre la base de volumen (volumen_106.sql). SOLO LOCAL. Corre como superadmin autenticado (rol authenticated + JWT).
# Cada escenario se ejecuta 5 veces en una sola sesión; se imprime la mediana y el máximo de «Time:» de psql, en ms.
# Uso: sh medir_106.sh <contenedor> <base>. Requiere el usuario 11111111-… como superadmin en esa base (el script lo crea).
CT="${1:-pg304}"; DB="${2:-g106_vol}"
export MSYS_NO_PATHCONV=1
PS="docker exec -i -e PGPASSWORD=postgres $CT psql -h 127.0.0.1 -U supabase_admin -d $DB -X -q -At -v ON_ERROR_STOP=1"
$PS >/dev/null <<'SQL'
set session_replication_role = replica;
insert into auth.users (id, email) values ('11111111-1111-1111-1111-111111111111','sa@t.test') on conflict do nothing;
insert into public.usuarios (id, email, nombre, rol, tenant, activo) values ('11111111-1111-1111-1111-111111111111','sa@t.test','SA','superadmin','mayorista',true) on conflict (id) do update set rol='superadmin', activo=true;
SQL
run() { # $1 etiqueta, $2 filtros jsonb, $3 orden, $4 offset
  t=$($PS <<SQL | sed -n 's/^Time: \([0-9.]*\) ms.*/\1/p' | sort -n
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false) \gset
select set_config('request.jwt.claims','{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}',false) \gset
set role authenticated;
set statement_timeout = '120s';
\o /dev/null
\timing on
select public.fn_gestion_contratos('$2'::jsonb,'$3',25,$4);
select public.fn_gestion_contratos('$2'::jsonb,'$3',25,$4);
select public.fn_gestion_contratos('$2'::jsonb,'$3',25,$4);
select public.fn_gestion_contratos('$2'::jsonb,'$3',25,$4);
select public.fn_gestion_contratos('$2'::jsonb,'$3',25,$4);
SQL
)
  med=$(echo "$t" | sed -n 3p); max=$(echo "$t" | tail -1)
  printf '%-56s mediana %9s ms · máx %9s ms\n' "$1" "$med" "$max"
}
run "A sin filtros, página 1" '{}' venta_desc 0
run "B sin filtros, página 400 (offset 9975)" '{}' venta_desc 9975
run "C agencia=minorista" '{"tenant":"minorista"}' venta_desc 0
run "D saldo=con_saldo, orden saldo_desc" '{"saldo":"con_saldo"}' saldo_desc 0
run "E voucher_entrega=pendiente" '{"voucher_entrega":"pendiente"}' venta_desc 0
run "F comision=pendiente" '{"comision":"pendiente"}' venta_desc 0
run "G factura_envio=pendiente" '{"factura_envio":"pendiente"}' venta_desc 0
run "H compra 2025-06 + salida>=2026-01, orden salida" '{"venta_desde":"2025-06-01","venta_hasta":"2025-06-30","salida_desde":"2026-01-01"}' salida_asc 0
run "I numero contiene 0123" '{"numero":"0123"}' numero_asc 0
run "J cliente contiene 'Cliente 19'" '{"cliente":"Cliente 19"}' venta_desc 0
run "K minorista+con_saldo+voucher con+COP" '{"tenant":"minorista","saldo":"con_saldo","voucher":"con","moneda_cobro":"COP"}' venta_desc 0
