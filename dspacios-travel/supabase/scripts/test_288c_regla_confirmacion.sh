#!/bin/bash
# ──────────────────────────────────────────────────────────────────
# PRUEBAS de la migración 288 — PARTE 3: UNA sola regla del mínimo para CONFIRMAR por pago (condición congelada; NETO aliado = total NETO; legacy 30 % solo históricos sin condiciones).
# Uso:  bash supabase/scripts/test_288c_regla_confirmacion.sh <contenedor> <base>
#   · <base>: Postgres local DESECHABLE con 281, 283, 284, 285, 287 y 288 aplicadas. NUNCA contra producción.
# Los casos usan contratos pendientes con condiciones congeladas (contrato_condiciones) y abonos por registrar_abono (como el servidor, service_role).
# Cubre COP, USD, moneda de cobro distinta de la del contrato, condición en USD con cobro en COP (TRM congelada), NETO aliado, legacy, "sin pagos no confirma", y que el
# mínimo para CONVERTIR una cotización (pagos previos ≥ monto exigido congelado) es OTRA condición, identificada.
# ──────────────────────────────────────────────────────────────────
CT="${1:?uso: test_288c_regla_confirmacion.sh <contenedor> <base>}"; DB="${2:?falta la base}"
export MSYS_NO_PATHCONV=1
S() { docker exec -i -e PGPASSWORD=postgres "$CT" psql -h 127.0.0.1 -U supabase_admin -X -q -t -A -v ON_ERROR_STOP=0 -d "$DB" "$@" 2>&1; }
SU='aaaaaaaa-1111-1111-1111-111111111111'
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf 'PASS  %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf 'FALLO %s  ->  %s\n' "$1" "$2"; }
expect() { if printf '%s' "$2" | grep -Eq "$3"; then ok "$1"; else bad "$1" "esperaba /$3/, obtuve: $(printf '%s' "$2" | tr '\n' ' ' | cut -c1-260)"; fi; }
Q() { S -c "$1"; }
QS() { { echo "set role service_role;"; echo "$1;"; echo "reset role;"; } | S | grep -vE '^SET$|^RESET$|^$'; }
B=$(( $(date +%s) % 800 + 100 ))
estado() { Q "select estado from public.ventas where numero_contrato='$1'"; }
# regla <numero> → "regla|minimo|moneda|trm"
regla() { Q "select g->>'regla'||'|'||(g->>'minimo')::numeric::bigint||'|'||(g->>'moneda')||'|'||coalesce((g->>'trm')::numeric::bigint::text,'') from (select p75_priv.estado_minimo('$1') g) q"; }
alcanza() { Q "select p75_priv.estado_minimo('$1')->>'alcanza'"; }
# mkc <numero> <moneda> <precio> [extras "col=val,..."]: pendiente con el registro financiero completo
mkc() { Q "insert into public.ventas(numero_contrato,tenant,cliente,estado,asesor,precio_venta,moneda,tipo_paquete,financiero_estado) values ('$1','mayorista','C $1','pendiente','A',$3,'$2','porcion','completo')" >/dev/null; if [ -n "$4" ]; then Q "update public.ventas set $4 where numero_contrato='$1'" >/dev/null; fi; }
# cond <numero> <exigido> <moneda> <trm>
cond() { Q "insert into public.contrato_condiciones(numero_contrato,tipo_componente,orden,valor_componente,condicion_pago_tipo,monto_exigido,restriccion_comercial,moneda,trm) values ('$1','hotel',0,1,'normal',$2,'normal','$3',$4)" >/dev/null; }
# abono <numero> <monto_cop> <trm>: registrar_abono como el servidor (confirma solo si la regla se cumple)
abono() { QS "select public.registrar_abono('$1','mayorista','$SU'::uuid,$2,$3,'efectivo','r',current_date,false,gen_random_uuid())"; }

echo "=== 1) Condición congelada ≠ 30 %: exigido 500.000 de 1.000.000 (COP)"
N1="DTM-9$B"; mkc "$N1" COP 1000000; cond "$N1" 500000 COP 1
expect "la regla es condicion_congelada con mínimo 500.000 (no el 30 %)" "$(regla $N1)" '^condicion_congelada\|500000\|COP'
abono "$N1" 400000 1 >/dev/null
expect "400.000 (más que el 30 %, menos que la condición): NO confirma" "$(estado $N1)|$(alcanza $N1)" '^pendiente\|false$'
R1=$(abono "$N1" 100000 1)
expect "completa 500.000: confirma en la misma operación del abono (regla condicion_congelada)" "$(estado $N1)|$R1" '^confirmado\|.*"confirmacion".*condicion_congelada'

echo "=== 2) USD: condición 300 USD (TRM 4000) y abonos en pesos a esa TRM"
N2="DTM-8$B"; mkc "$N2" USD 1000; cond "$N2" 300 USD 4000
expect "mínimo 300 USD, TRM 4000" "$(regla $N2)" '^condicion_congelada\|300\|USD\|4000$'
abono "$N2" 400000 4000 >/dev/null
expect "100 USD pagados: pendiente" "$(estado $N2)" '^pendiente$'
abono "$N2" 800000 4000 >/dev/null
expect "300 USD acumulados: confirma" "$(estado $N2)" '^confirmado$'

echo "=== 3) Moneda de COBRO distinta de la del contrato (contrato USD cobrado en COP: 1.000 USD = 4.000.000 COP a TRM 4000), condición en COP"
N3="DTM-7$B"
Q "insert into public.ventas(numero_contrato,tenant,cliente,estado,asesor,precio_venta,moneda,moneda_cobro,total_cobro,trm_cobro,tipo_paquete,financiero_estado) values ('$N3','mayorista','C','pendiente','A',1000,'USD','COP',4000000,4000,'porcion','completo')" >/dev/null
cond "$N3" 1200000 COP 1
expect "mínimo 1.200.000 COP (la moneda de la condición)" "$(regla $N3)" '^condicion_congelada\|1200000\|COP'
abono "$N3" 1000000 1 >/dev/null
expect "1.000.000 COP: pendiente" "$(estado $N3)" '^pendiente$'
abono "$N3" 200000 1 >/dev/null
expect "1.200.000 COP: confirma" "$(estado $N3)" '^confirmado$'

echo "=== 4) Condición en USD con cobro en COP: se convierte a la TRM CONGELADA de la condición"
N4="DTM-6$B"; mkc "$N4" COP 4000000; cond "$N4" 300 USD 4000
expect "mínimo 300 USD (TRM congelada 4000)" "$(regla $N4)" '^condicion_congelada\|300\|USD\|4000$'
abono "$N4" 1000000 1 >/dev/null
expect "1.000.000 COP = 250 USD < 300: pendiente" "$(estado $N4)" '^pendiente$'
abono "$N4" 200000 1 >/dev/null
expect "1.200.000 COP = 300 USD: confirma" "$(estado $N4)" '^confirmado$'

echo "=== 5) NETO aliado: el mínimo para confirmar es el TOTAL NETO exigible (aunque la condición congelada pida menos)"
N5="DTM-5$B"; mkc "$N5" COP 900000 "comision_estado='descontada', comision_b2b=100000"; cond "$N5" 300000 COP 1
expect "regla neto_total con mínimo = total NETO (900.000)" "$(regla $N5)" '^neto_total\|900000\|COP'
abono "$N5" 300000 1 >/dev/null
expect "pagar la condición (300.000) NO alcanza en NETO" "$(estado $N5)" '^pendiente$'
abono "$N5" 500000 1 >/dev/null
expect "800.000: aún pendiente" "$(estado $N5)" '^pendiente$'
abono "$N5" 100000 1 >/dev/null
expect "900.000 (total NETO): confirma" "$(estado $N5)" '^confirmado$'

echo "=== 6) Histórico SIN condiciones congeladas: único caso del 30 % (legacy), identificado"
N6="DTM-4$B"; mkc "$N6" COP 1000000
expect "regla legacy_pct (300.000)" "$(regla $N6)" '^legacy_pct\|300000\|COP'
abono "$N6" 200000 1 >/dev/null
expect "200.000: pendiente" "$(estado $N6)" '^pendiente$'
abono "$N6" 100000 1 >/dev/null
expect "300.000: confirma" "$(estado $N6)" '^confirmado$'
expect "un contrato CON condiciones o NETO jamás usa legacy_pct" "$(Q "select count(*) from public.ventas v where v.numero_contrato in ('$N1','$N2','$N3','$N4','$N5') and p75_priv.regla_confirmacion(v.numero_contrato)->>'regla' = 'legacy_pct'")" '^0$'

echo "=== 7) Sin pagos nunca confirma por pago (aunque la condición exija 0)"
N7="DTM-3$B"; mkc "$N7" COP 1000000; cond "$N7" 0 COP 1
expect "mínimo 0 pero pagado 0: alcanza = false" "$(alcanza $N7)" '^false$'
expect "confirmar_tras_conversion no confirma sin pagos" "$(QS "select public.confirmar_tras_conversion('$N7','$SU'::uuid)")|$(estado $N7)" '"confirmada": false.*\|pendiente$'
abono "$N7" 1000 1 >/dev/null
expect "cualquier pago positivo cumple una condición de 0 → confirma" "$(estado $N7)" '^confirmado$'

echo "=== 8) Mínimo para CONVERTIR ≠ mínimo para CONFIRMAR (identificados): en NETO el de convertir es la condición y el de confirmar el total"
N8="DTM-2$B"; mkc "$N8" COP 900000 "comision_estado='descontada', comision_b2b=100000"; cond "$N8" 300000 COP 1
Q "insert into public.abonos(numero_contrato,tenant,valor_abono,monto_cop,trm,fecha_abono,forma_pago) values ('$N8','mayorista',300000,300000,1,current_date,'efectivo')" >/dev/null
RC=$(QS "select public.confirmar_tras_conversion('$N8','$SU'::uuid)")
expect "con 300.000 (lo exigido para CONVERTIR) el contrato NETO queda PENDIENTE: confirmar exige el total" "$RC|$(estado $N8)" '"confirmada": false.*\|pendiente$'
expect "…y la respuesta identifica la regla vigente" "$RC" '"regla": "neto_total"'

echo "=== 9) Conversión REAL con pago previo en USD: el abono queda en USD (no en pesos), la TRM del pago se conserva y la regla compara en la moneda congelada"
CID=$((990000+RANDOM%9000))
OUT9=$(S <<SQL
begin;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-1111-1111-1111-111111111111","role":"authenticated"}', true), set_config('request.jwt.claim.sub','aaaaaaaa-1111-1111-1111-111111111111', true);
insert into public.cotizaciones (id, codigo, estado, tipo, modo, tenant, payload, precio_venta, moneda, cliente)
values ($CID, 'U$CID', 'abierta', 'manual', 'simple', 'mayorista',
  '{"cliente":{"nombres":"C","apellidos":"U","tipoDoc":"CC","numeroDoc":"1","nacimiento":"1990-01-01"},"tipoAsesor":"interno","destino":"MIAMI","fechaSalida":"2027-03-01","fechaRegreso":"2027-03-05"}'::jsonb, 1000, 'USD', 'C U');
insert into public.cotizacion_servicios (cotizacion_id, orden, tipo_servicio, nombre_servicio, proveedor, costo_neto, modo, pct_markup, ta, valor) values ($CID, 0, 'hotel', 'H', 'Hotel X', 600, 'mk', 20, 0, 750);
select 'PP|'||(public.registrar_pago_previo($CID, 300, 'USD', 4000, 'Efectivo', 'r', current_date, 'aaaaaaaa-1111-1111-1111-111111111111'::uuid, 'u9-$CID', '[{"orden":0,"tipo_componente":"hotel","valor_componente":1000,"condicion_pago_tipo":"normal","monto_exigido":300}]'::jsonb, 300, null))::text;
select 'CV|'||(public.convertir_cotizacion_a_contrato($CID, 'aaaaaaaa-1111-1111-1111-111111111111'::uuid))::text;
select 'AB|'||a.valor_abono::numeric(14,2)||'|'||a.monto_cop::numeric(14,0)||'|'||a.trm::numeric(10,0) from public.abonos a join public.ventas v using (numero_contrato) where v.cotizacion_id=$CID;
select 'ES|'||v.estado||'|'||(p75_priv.estado_minimo(v.numero_contrato))::text from public.ventas v where v.cotizacion_id=$CID;
rollback;
SQL
)
expect "el abono del pago previo queda en 300 USD (monto_cop 1.200.000, TRM 4000)" "$OUT9" 'AB\|300\.00\|1200000\|4000'
expect "300 USD = lo exigido congelado: la regla vigente es condicion_congelada en USD" "$OUT9" 'ES\|[a-z]+\|.*condicion_congelada.*300.*USD'

echo "=== 10) Regla monetaria: valor_abono SIEMPRE en la moneda de COBRO del contrato (no la del pago); monto_cop, TRM y asientos no cambian"
B10=$((RANDOM%9000+1000))
OUT10=$(S <<SQL
begin;
create temp table _r(k text, v text);
do \$t\$
declare
  c record; n text; cid bigint := 970000 + $B10 * 10; a bigint; i int := 0;
begin
  for c in select * from (values
    -- caso, moneda contrato, moneda_cobro, total_cobro, trm_cobro, moneda pago, monto pago (moneda), TRM, monto_cop
    ('A_cop_cop',    'COP', null,  null::numeric, null::numeric, 'COP', 1200000::numeric, 1::numeric,    1200000::numeric),
    ('B_usd_usd',    'USD', null,  null,          null,          'USD', 300,              4000,           1200000),
    ('C_usd_cobroCOP','USD','COP', 4000000,       4000,          'USD', 300,              4000,           1200000),
    ('D_cop_cobroUSD','COP','USD', 1000,          4000,          'COP', 1200000,          4000,           1200000),
    ('E_usd_pagoCOP','USD', null,  null,          null,          'COP', 1200000,          4000,           1200000)
  ) as t(caso, mon, mcobro, tcobro, trmc, pmon, pval, ptrm, pcop) loop
    i := i + 1; n := 'DTM-9' || $B10 || i; cid := cid + 1;
    insert into public.ventas(numero_contrato,tenant,cliente,estado,asesor,precio_venta,moneda,moneda_cobro,total_cobro,trm_cobro,tipo_paquete,financiero_estado)
      values (n,'mayorista','C','pendiente','A', case when c.mon='USD' then 1000 else 4000000 end, c.mon, c.mcobro, c.tcobro, c.trmc,'porcion','completo');
    insert into public.cotizaciones (id, codigo, estado, tipo, modo, tenant, payload, precio_venta, moneda, cliente) values (cid, 'M'||cid, 'abierta','manual','simple','mayorista','{}'::jsonb, 1, c.mon, 'C');
    -- abono tal como lo deja la base legada: valor_abono = pesos
    insert into public.abonos(numero_contrato,tenant,valor_abono,monto_cop,trm,fecha_abono,forma_pago) values (n,'mayorista',c.pcop,c.pcop,c.ptrm,current_date,'efectivo') returning id into a;
    insert into public.cotizacion_pagos_previos(cotizacion_id,tenant,monto_cop,monto_moneda,moneda,trm,forma_pago,registrado_por_id,abono_id)
      values (cid,'mayorista',c.pcop,c.pval,c.pmon,c.ptrm,'efectivo','aaaaaaaa-1111-1111-1111-111111111111',a);
    perform p75_priv.normalizar_abonos_previos(n);
    perform p75_priv.normalizar_abonos_previos(n);   -- idempotente
    insert into _r select c.caso, ab.valor_abono::numeric(16,2)||'|'||ab.monto_cop::numeric(16,0)||'|'||ab.trm::numeric(10,0)||'|'||(p75_priv.pagado_en(n, case when c.mcobro is not null and c.mcobro<>c.mon then c.mcobro else c.mon end, 4000))::numeric(16,2)
      from public.abonos ab where ab.id = a;
  end loop;
end \$t\$;
select 'R|'||k||'|'||v from _r order by k;
rollback;
SQL
)
expect "A) COP/COP: valor = pesos, intacto"                                  "$OUT10" 'R\|A_cop_cop\|1200000\.00\|1200000\|1\|1200000\.00'
expect "B) USD/USD: valor = 300 USD, monto_cop y TRM intactos"                "$OUT10" 'R\|B_usd_usd\|300\.00\|1200000\|4000\|300\.00'
expect "C) contrato USD cobrado en COP, pago en USD: valor en PESOS (cobro), no 300" "$OUT10" 'R\|C_usd_cobroCOP\|1200000\.00\|1200000\|4000\|1200000\.00'
expect "D) contrato COP cobrado en USD, pago en COP: valor = 300 USD (pesos / TRM)" "$OUT10" 'R\|D_cop_cobroUSD\|300\.00\|1200000\|4000\|300\.00'
expect "E) contrato USD, pago en COP: valor = 300 USD (pesos / TRM del abono)"  "$OUT10" 'R\|E_usd_pagoCOP\|300\.00\|1200000\|4000\|300\.00'

echo
echo "RESUMEN: $PASS PASS, $FAIL FALLO"
[ "$FAIL" = "0" ]
