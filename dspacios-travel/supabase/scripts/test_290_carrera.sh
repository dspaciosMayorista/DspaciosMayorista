#!/bin/bash
# ──────────────────────────────────────────────────────────────────
# PRUEBAS de la 290 con DOS SESIONES REALES + preflight sobre un duplicado histórico + rollback/reaplicación.
# Uso:  bash supabase/scripts/test_290_carrera.sh <contenedor> <base_desechable_con_290> [ciclo=false|true]
#   La base se MODIFICA (datos confirmados): usar una copia desechable. NUNCA contra producción.
# Orden: C1-C3 carreras (con la 290) → siembra de un duplicado histórico → rollback (estado 205) → preflight (debe pedir revisión) → reaplicar 290.
# ──────────────────────────────────────────────────────────────────
CT="${1:?uso: test_290_carrera.sh <contenedor> <base> [ciclo]}"; DB="${2:?falta la base}"; CICLO="${3:-false}"
export MSYS_NO_PATHCONV=1
AQUI="$(cd "$(dirname "$0")" && pwd)"
S() { docker exec -i -e PGPASSWORD=postgres "$CT" psql -h 127.0.0.1 -U supabase_admin -X -q -t -A -v ON_ERROR_STOP=0 -d "$DB" "$@" 2>&1; }
Q() { S -c "$1"; }
PASS=0; FAIL=0
expect() { if printf '%s' "$2" | grep -Eq "$3"; then PASS=$((PASS+1)); echo "PASS  $1"; else FAIL=$((FAIL+1)); echo "FALLO $1  ->  esperaba /$3/, obtuve: $(printf '%s' "$2" | tr '\n' ' ' | cut -c1-220)"; fi; }
VE='00000000-0000-0000-0000-000000290101'; AD='00000000-0000-0000-0000-000000290102'; SU='00000000-0000-0000-0000-000000290103'
# como <uuid> <sql>: sesión con RLS real (rol authenticated + claims, igual que el arnés de #75)
como() { printf "select set_config('request.jwt.claims','{\"sub\":\"%s\",\"role\":\"authenticated\"}',false), set_config('request.jwt.claim.sub','%s',false);\nset role authenticated;\n%s\n" "$1" "$1" "$2" | S | grep -v '^{' | grep -v '^SET$'; }
B=$(( $(date +%s) % 800 + 100 ))

Q "update p97_priv.ciclo set activo = $CICLO" >/dev/null
Q "insert into auth.users (id, email) values ('$VE','c290v@x.test'),('$AD','c290a@x.test'),('$SU','c290s@x.test') on conflict do nothing" >/dev/null
Q "insert into public.usuarios (id, email, nombre, rol, activo, tenant) values ('$VE','c290v@x.test','C290 Asesor','venta',true,'mayorista'),
     ('$AD','c290a@x.test','C290 Admin','administracion',true,'mayorista'),('$SU','c290s@x.test','C290 Super','superadmin',true,'mayorista')
     on conflict (id) do update set nombre = excluded.nombre, rol = excluded.rol, activo = excluded.activo, tenant = excluded.tenant" >/dev/null
Q "insert into public.aliados (id, nombre, tipo, pct_comision, nit) values (290101,'C290 Agencia','agencia',0.10,'900290101') on conflict (id) do nothing" >/dev/null
expect "S0 usuarios de prueba con rol" "$(Q "select count(*) from public.usuarios where id in ('$VE','$AD','$SU') and activo")" "^3$"
mk() { Q "insert into public.ventas (numero_contrato, cliente, tenant, asesor, precio_venta, impuesto, estado, financiero_estado, tipo_asesor, aliado_id, canal, modo_compra, comision_b2b, comision_estado)
          values ('$1','C','mayorista','C290 Asesor',1000000,200000,'confirmado','${2:-pendiente}','agencia',290101,'B2B','comisionable',80000,'pendiente')" >/dev/null; }
filas() { Q "select count(*) from public.aliados_b2b where numero_contrato = '$1'"; }
MANUAL="'C290 Agencia', '900290101', 'agencia', 290101, 0.10, 0, 0, false, 0"

# C1 · automático (reserva, retiene el candado 3 s) contra manual interno del mismo aliado
N1="DTM-29${B}1"; mk "$N1"
( como "$VE" "begin; select public.registrar_comision_b2b_reserva('$N1', 290101); select pg_sleep(3); commit;" > /dev/null ) &
sleep 1
R1=$(como "$AD" "select public.registrar_comision_b2b_manual('$N1', $MANUAL);")
wait
expect "C1 carrera automático→manual: la manual espera el candado y se rechaza" "$R1" "COMISION_DUPLICADA"
expect "C1 una sola obligación" "$(filas "$N1")" "^1$"

# C2 · manual contra manual (administración y superadmin, simultáneas) — la primera retiene 3 s
N2="DTM-29${B}2"; mk "$N2" completo
( como "$AD" "begin; select public.registrar_comision_b2b_manual('$N2', $MANUAL); select pg_sleep(3); commit;" > /dev/null ) &
sleep 1
R2=$(como "$SU" "select public.registrar_comision_b2b_manual('$N2', $MANUAL);")
wait
expect "C2 carrera manual↔manual: la segunda se rechaza" "$R2" "COMISION_DUPLICADA"
expect "C2 una sola obligación" "$(filas "$N2")" "^1$"

# C3 · inserción DIRECTA (service-role, sin RPC) en carrera con la reserva
N3="DTM-29${B}3"; mk "$N3"
( como "$VE" "begin; select public.registrar_comision_b2b_reserva('$N3', 290101); select pg_sleep(3); commit;" > /dev/null ) &
sleep 1
R3=$(printf "set role service_role;\ninsert into public.aliados_b2b (numero_contrato, tenant, aliado, tipo_aliado, aliado_id, precio_venta, base_comision, pct_comision, estado) values ('%s','mayorista','C290 Agencia','agencia',290101,1000000,800000,0.1,'pendiente');\n" "$N3" | S)
wait
expect "C3 carrera reserva↔inserción directa: el trigger la rechaza" "$R3" "COMISION_DUPLICADA"
expect "C3 una sola obligación" "$(filas "$N3")" "^1$"

# E1 · EDICIÓN que introduce ordinaria (retiene el candado 3 s) contra ALTA manual del mismo aliado
N5="DTM-29${B}5"; mk "$N5" completo
Z5=$(como "$AD" "select public.registrar_comision_b2b_manual('$N5', 'C290 Agencia', '900290101', 'agencia', 290101, 0, 0, 0, false, 0);")
( printf "begin;\nupdate public.aliados_b2b set pct_comision = 0.10 where id = %s;\nselect pg_sleep(3);\ncommit;\n" "$Z5" | S > /dev/null ) &
sleep 1
R5=$(como "$AD" "select public.registrar_comision_b2b_manual('$N5', $MANUAL);")
wait
expect "E1 carrera edición→alta: la alta espera el candado y se rechaza" "$R5" "COMISION_DUPLICADA"
expect "E1 una sola ordinaria del aliado" "$(Q "select count(*) from public.aliados_b2b where numero_contrato = '$N5' and pct_comision > 0")" "^1$"

# E2 · ALTA manual (retiene el candado 3 s) contra EDICIÓN de una fila sin concepto que intenta volverse ordinaria
N6="DTM-29${B}6"; mk "$N6" completo
Z6=$(como "$AD" "select public.registrar_comision_b2b_manual('$N6', 'C290 Agencia', '900290101', 'agencia', 290101, 0, 0, 0, false, 0);")
( como "$AD" "begin; select public.registrar_comision_b2b_manual('$N6', $MANUAL); select pg_sleep(3); commit;" > /dev/null ) &
sleep 1
R6=$(printf "update public.aliados_b2b set pct_comision = 0.10 where id = %s;\n" "$Z6" | S)
wait
expect "E2 carrera alta→edición: la edición espera y se rechaza" "$R6" "COMISION_DUPLICADA"
expect "E2 una sola ordinaria del aliado" "$(Q "select count(*) from public.aliados_b2b where numero_contrato = '$N6' and pct_comision > 0")" "^1$"

# H · duplicado HISTÓRICO confirmado (anterior a la 290: se siembra sin el trigger)
N4="DTM-29${B}4"; mk "$N4" completo
Q "alter table public.aliados_b2b disable trigger trg_aliados_b2b_sin_duplicado_aliado;
   insert into public.aliados_b2b (numero_contrato, tenant, aliado, tipo_aliado, aliado_id, precio_venta, base_comision, pct_comision, estado)
     values ('$N4','mayorista','C290 Agencia','agencia',290101,1000000,800000,0.1,'pendiente'), ('$N4','mayorista','C290 Agencia','agencia',290101,1000000,800000,0.1,'pendiente');
   alter table public.aliados_b2b enable trigger trg_aliados_b2b_sin_duplicado_aliado;" >/dev/null
expect "H1 el duplicado histórico existe (2 filas)" "$(filas "$N4")" "^2$"

# R · rollback: vuelve EXACTAMENTE a la 205 (huella normalizada) y no toca filas
RB=$(S -v ON_ERROR_STOP=1 < "$AQUI/rollback_290_comision_manual.sql")
expect "R1 rollback sin errores" "$(printf '%s' "$RB" | grep -c ERROR)" "^0$"
expect "R2 cuerpo restaurado = 205 (md5 sin CR)" "$(Q "select md5(replace(prosrc, chr(13), '')) from pg_proc where proname = 'registrar_comision_b2b_manual'")" "^dc89361bdfd6fb12a822b2e093174d28$"
expect "R3 sin trigger tras el rollback" "$(Q "select count(*) from pg_trigger where tgname = 'trg_aliados_b2b_sin_duplicado_aliado'")" "^0$"
expect "R4 las filas registradas siguen (C1, C2, C3, histórico)" "$(filas "$N1")|$(filas "$N2")|$(filas "$N3")|$(filas "$N4")" "^1\|1\|1\|2$"

# P · preflight en el estado 205: detecta el duplicado histórico, pide revisión humana y no lo toca
PF=$(S -F'|' < "$AQUI/preflight_290_comision_manual.sql")
expect "P1 preflight: la función es la de la 205" "$(printf '%s' "$PF" | grep '^2|')" "\|205\|205\|OK$"
expect "P2 preflight: lista el duplicado histórico (contrato/aliado → 2 filas)" "$(printf '%s' "$PF" | grep '^11|')" "$N4/290101 → 2"
expect "P3 preflight: el veredicto pide revisión humana (no 'listo', no 'falla')" "$(printf '%s' "$PF" | grep '^99|')" "REVISAR ANTES DE APLICAR"
expect "P4 el duplicado histórico sigue intacto" "$(filas "$N4")" "^2$"
expect "P5 sin la 290 (estado 205) la edición de E1 habría pasado: la regla es de la 290" "$(Q "select count(*) from pg_trigger where tgname = 'trg_aliados_b2b_sin_duplicado_aliado'")" "^0$"

# A · reaplicar la 290 sobre el estado 205: postcheck CORRECTA y la regla vuelve a regir
S -v ON_ERROR_STOP=1 < "$AQUI/../migrations/20260601000290_comision_manual_pendiente_y_duplicado.sql" >/dev/null
expect "A1 reaplicada la 290: postcheck CORRECTA" "$(S -F'|' < "$AQUI/postcheck_290_comision_manual.sql" | grep '^99|')" "CORRECTA"
expect "A2 tras reaplicar, una manual del mismo aliado sigue rechazada" "$(como "$AD" "select public.registrar_comision_b2b_manual('$N2', $MANUAL);")" "COMISION_DUPLICADA"

echo "── 290 carrera (ciclo=$CICLO): PASS=$PASS FALLO=$FAIL"
[ "$FAIL" -eq 0 ]
