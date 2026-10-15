#!/bin/sh
# ──────────────────────────────────────────────────────────────────
# CARRERAS · 208 facturación transaccional (20260601000208_facturacion_transaccional.sql)
# DOS SESIONES REALES con COMMIT real + observador. SOLO base LOCAL DESECHABLE
# en un contenedor Docker propio (nunca remoto, nunca Preview/Producción).
#
# Uso (desde dspacios-travel/):
#   sh supabase/scripts/test_208_carrera.sh <base_nueva> [contenedor] [plantilla]
#     base_nueva  ^t208_[a-z0-9_]{1,40}$ que NO exista: se crea desde la
#                 plantilla (001–205), se le aplican 206 + 208 y se BORRA al
#                 final (KEEP=1 la conserva). Si ya existe, no se toca.
#     contenedor  supabase/postgres local (por defecto pg206b_eb3bbf43).
#     plantilla   base con 001–205 (por defecto plantilla205). Solo se lee.
#
# Con la 208 ACTIVA:
#   Q1   facturar (cambia importes) ‖ quitar          → serializados por la venta; final coherente
#   Q1r  quitar ‖ facturar                            → serializados; final coherente (re-emitida)
#   Q2   marcar DIAN ‖ quitar                         → quitar F4434
#   Q2r  quitar ‖ marcar DIAN                         → marcar F4435
#   Q3   quitar ‖ quitar                              → el segundo F4438; UNA reversa
#   RACE-1  facturar ‖ facturar (mismos importes)     → una emitida, otra sin_cambios; 1 vigente; config
#   M1a  facturar (sostiene la venta) ‖ abono+posteo  → espera y acredita Clientes (130505)
#   M1b  borrar abono (sin confirmar) ‖ posteo        → F4405; ningún asiento huérfano
#   E1   DELETE abono sin asiento ‖ posteo → posteo F4405, 0 huérfanos   E2  posteo ‖ DELETE → DELETE F4415
#   E3   DELETE ‖ DELETE (abono con asiento) → F4415 ambos   E4  tras la retirada, F4415 sigue
#   LT   venta bloqueada 8 s ‖ facturar               → espera acotada: 55P03 (lock_timeout 5 s)
# Tras la RETIRADA PARCIAL (rollback_208, D-RET):
#   Q5   Guardar (vieja) con la venta tomada ‖ Quitar (vieja) → los dos F4440, sin interbloqueo, foto idéntica
#   Q5r  Quitar (vieja) con la fila tomada ‖ Guardar (vieja)  → los dos F4440, sin interbloqueo
#   Q6   Marcar DIAN (vieja) ‖ Quitar (vieja)          → marcar sí; quitar F4440/F4434; solo cambia dian
#   Q7   Quitar (vieja) ‖ Quitar (vieja)               → los dos F4440; foto idéntica
# ──────────────────────────────────────────────────────────────────
set -eu
DB="${1:-}"
CT="${2:-pg206b_eb3bbf43}"
PLANTILLA="${3:-plantilla205}"
export MSYS_NO_PATHCONV=1
nombre_ok() { printf '%s' "$1" | grep -Eq "$2"; }
nombre_ok "$DB" '^t208_[a-z0-9_]{1,40}$' || { echo "Base inválida: usa un nombre nuevo ^t208_[a-z0-9_]{1,40}\$." >&2; exit 2; }
nombre_ok "$CT" '^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$' || { echo "Contenedor inválido." >&2; exit 2; }
nombre_ok "$PLANTILLA" '^[a-z][a-z0-9_]{0,62}$' || { echo "Plantilla inválida." >&2; exit 2; }

AQUI="$(cd "$(dirname "$0")" && pwd)"
APP="$(cd "$AQUI/../.." && pwd)"
PSA="docker exec -i -e PGPASSWORD=postgres $CT psql -h 127.0.0.1 -U supabase_admin -X -q -v ON_ERROR_STOP=1"
PS="$PSA -d $DB -t -A"
SES="docker exec -i -e PGPASSWORD=postgres $CT psql -h 127.0.0.1 -U supabase_admin -d $DB -X -q -t -A -v VERBOSITY=verbose"
TMP="$(mktemp -d)"
MARCA="test_208_carrera $(od -An -N6 -tx1 /dev/urandom | tr -d ' \n')"
FALLOS=0
BASE_PROPIA=0
ok()    { echo "OK    $1"; }
fallo() { echo "FALLO $1"; FALLOS=$((FALLOS + 1)); }

limpiar() {
  st=$?
  if [ "$BASE_PROPIA" = 1 ] && [ "${KEEP:-}" != 1 ]; then
    m="$($PSA -d postgres -t -A -c "select shobj_description(oid, 'pg_database') from pg_database where datname = '$DB'" 2>/dev/null || true)"
    if [ "$m" = "$MARCA" ]; then
      for i in 1 2 3 4 5; do $PSA -d postgres -c "drop database $DB" >/dev/null 2>&1 && break; sleep 2; done
    else echo "AVISO: $DB no lleva la marca de esta corrida; no se borra." >&2; fi
  fi
  rm -rf "$TMP"
  exit "$st"
}
trap limpiar EXIT
trap 'exit 130' INT TERM

docker inspect -f '{{.State.Running}}' "$CT" 2>/dev/null | grep -qx true || { echo "El contenedor $CT no está corriendo." >&2; exit 2; }
[ "$($PSA -d postgres -t -A -c "select count(*) from pg_database where datname = '$PLANTILLA'")" = 1 ] || { echo "No existe la plantilla $PLANTILLA." >&2; exit 2; }
[ "$($PSA -d postgres -t -A -c "select count(*) from pg_database where datname = '$DB'")" = 0 ] || { echo "La base $DB ya existe: no se toca." >&2; exit 3; }
$PSA -d postgres -c "create database $DB template $PLANTILLA" >/dev/null || { echo "No se pudo crear $DB." >&2; exit 3; }
BASE_PROPIA=1
$PSA -d postgres -c "comment on database $DB is '$MARCA'" >/dev/null
$PSA -d "$DB" -1 < "$APP/supabase/migrations/20260601000206_contrato_manual_neto.sql" >/dev/null 2>&1
$PSA -d "$DB" -1 < "$APP/supabase/migrations/20260601000208_facturacion_transaccional.sql" >/dev/null
echo "Base $DB: plantilla + 206 + 208 aplicadas."

ADM=00000000-0000-0000-0000-000000208301
GER=00000000-0000-0000-0000-000000208302
$PS >/dev/null <<SQL
insert into auth.users (id, email) values ('$ADM', 'c208-adm@x.test'), ('$GER', 'c208-ger@x.test');
insert into public.usuarios (id, email, nombre, rol, activo, tenant) values
  ('$ADM', 'c208-adm@x.test', 'C208 Adm', 'administracion', true, 'mayorista'),
  ('$GER', 'c208-ger@x.test', 'C208 Ger', 'gerencia', true, 'mayorista')
on conflict (id) do update set rol = excluded.rol, activo = true, tenant = 'mayorista';
insert into public.ventas (numero_contrato, cliente, tenant, precio_venta, estado, financiero_estado)
select 'DTM-2083' || lpad(i::text, 2, '0'), 'C', 'mayorista', 1800000, 'activo', 'completo' from generate_series(1, 20) i;
insert into public.cuentas_por_pagar (numero_contrato, proveedor, tipo_proveedor, servicio, valor_total, tenant, clasificacion)
select numero_contrato, 'Hotel', 'hotel', 'Alojamiento', 1500000, 'mayorista', 'irt' from public.ventas where numero_contrato like 'DTM-2083%';
SQL

srv() { echo "set role service_role; select set_config('request.jwt.claims', '{\"role\":\"service_role\"}', false);"; }
aut() { echo "select set_config('request.jwt.claims', '{\"sub\":\"$1\",\"role\":\"authenticated\"}', false); set role authenticated;"; }
fact() { echo "select public.facturar_factura('$1', '$ADM', 'mayorista', 1800000, 1500000, ${2:-0});"; }
quitar() { echo "select public.quitar_factura('$1', '$ADM', 'mayorista');"; }
dian() { echo "select public.marcar_dian_factura('$1', '$ADM', 'mayorista', true);"; }
foto() {
  $PS -c "select 'cfg=' || coalesce((select ingreso_exento::numeric(15,0) || '/dian=' || dian_emitida from public.contrato_facturacion where numero_contrato = '$1'), 'no')
    || ' vig=' || ((select count(*) from public.asientos_contables where referencia = 'facturacion:$1' and origen = 'facturacion')
                 - (select count(*) from public.asientos_contables where referencia = 'facturacion:$1' and origen = 'facturacion_reversion'))
    || ' fact=' || (select count(*) from public.asientos_contables where referencia = 'facturacion:$1' and origen = 'facturacion')
    || ' rev=' || (select count(*) from public.asientos_contables where referencia = 'facturacion:$1' and origen = 'facturacion_reversion')
    || ' vacios=' || (select count(*) from public.asientos_contables a where a.referencia = 'facturacion:$1'
                       and not exists (select 1 from public.asiento_lineas l where l.asiento_id = a.id))"
}
coherente() { # config existe ⇔ hay exactamente una vigente; nunca encabezados vacíos
  f="$(foto "$1")"
  case "$f" in
    cfg=no\ vig=0\ *vacios=0|cfg=[0-9]*\ vig=1\ *vacios=0) return 0 ;;
    *) return 1 ;;
  esac
}
t0() { date +%s%N | cut -c1-13; }
ms() { echo $(( $(t0) - $1 )); }
# Corre A en segundo plano (sosteniendo su transacción `hold` s) y B tras `retraso` s.
carrera() { # $1=nombre $2=sqlA $3=sqlB $4=hold $5=retraso
  ( $SES -c "$2" >"$TMP/$1.a" 2>&1 || true ) &
  sleep "${5:-1}"
  ini=$(t0)
  $SES -c "$3" >"$TMP/$1.b" 2>&1 || true
  echo "$(ms "$ini")" >"$TMP/$1.ms"
  wait
}
err() { grep -o 'ERROR:  [A-Z0-9]\{5\}' "$1" | head -1 | sed 's/ERROR:  //'; }
json() { grep -o '"estado": "[a-z_]*"' "$1" | head -1 | sed 's/"estado": //; s/"//g'; }

echo "== 208 activa =="
# Q1: A cambia importes y sostiene 3 s; B quita.
$PS -c "$(srv) $(fact DTM-208301)" >/dev/null
carrera q1 "$(srv) begin; $(fact DTM-208301 100000) select pg_sleep(3); commit;" "$(srv) $(quitar DTM-208301)" 3 1
F="$(foto DTM-208301)"
if [ "$(json "$TMP/q1.a")" = emitida ] && [ "$(json "$TMP/q1.b")" = retirada ] && coherente DTM-208301 && [ "$(cat "$TMP/q1.ms")" -ge 1000 ]; then
  ok "Q1 facturar ‖ quitar: B esperó $(cat "$TMP/q1.ms") ms y retiró después; final coherente [$F]"
else fallo "Q1 a=$(cat "$TMP/q1.a") b=$(cat "$TMP/q1.b") [$F]"; fi

$PS -c "$(srv) $(fact DTM-208302)" >/dev/null
carrera q1r "$(srv) begin; $(quitar DTM-208302) select pg_sleep(3); commit;" "$(srv) $(fact DTM-208302 50000)" 3 1
F="$(foto DTM-208302)"
if [ "$(json "$TMP/q1r.a")" = retirada ] && [ "$(json "$TMP/q1r.b")" = emitida ] && coherente DTM-208302 && echo "$F" | grep -q '^cfg=50000/dian=false vig=1'; then
  ok "Q1r quitar ‖ facturar: re-emitida tras el retiro; final coherente [$F]"
else fallo "Q1r a=$(cat "$TMP/q1r.a") b=$(cat "$TMP/q1r.b") [$F]"; fi

# Q2: marcar DIAN ‖ quitar, en los dos órdenes.
$PS -c "$(srv) $(fact DTM-208303)" >/dev/null
carrera q2 "$(srv) begin; $(dian DTM-208303) select pg_sleep(3); commit;" "$(srv) $(quitar DTM-208303)" 3 1
F="$(foto DTM-208303)"
if [ "$(json "$TMP/q2.a")" = marcada ] && [ "$(err "$TMP/q2.b")" = F4434 ] && echo "$F" | grep -q 'dian=true vig=1 fact=1 rev=0 vacios=0'; then
  ok "Q2 marcar ‖ quitar: quitar F4434; factura emitida y marcada [$F]"
else fallo "Q2 a=$(cat "$TMP/q2.a") b=$(cat "$TMP/q2.b") [$F]"; fi
$PS -c "$(srv) $(fact DTM-208304)" >/dev/null
carrera q2r "$(srv) begin; $(quitar DTM-208304) select pg_sleep(3); commit;" "$(srv) $(dian DTM-208304)" 3 1
F="$(foto DTM-208304)"
if [ "$(json "$TMP/q2r.a")" = retirada ] && [ "$(err "$TMP/q2r.b")" = F4435 ] && coherente DTM-208304; then
  ok "Q2r quitar ‖ marcar: marcar F4435; sin configuración [$F]"
else fallo "Q2r a=$(cat "$TMP/q2r.a") b=$(cat "$TMP/q2r.b") [$F]"; fi

# Q3: quitar ‖ quitar.
$PS -c "$(srv) $(fact DTM-208305)" >/dev/null
carrera q3 "$(srv) begin; $(quitar DTM-208305) select pg_sleep(3); commit;" "$(srv) $(quitar DTM-208305)" 3 1
F="$(foto DTM-208305)"
if [ "$(json "$TMP/q3.a")" = retirada ] && [ "$(err "$TMP/q3.b")" = F4438 ] && echo "$F" | grep -q 'cfg=no vig=0 fact=1 rev=1 vacios=0'; then
  ok "Q3 quitar ‖ quitar: el segundo F4438; UNA reversa [$F]"
else fallo "Q3 a=$(cat "$TMP/q3.a") b=$(cat "$TMP/q3.b") [$F]"; fi

# RACE-1: dos guardados simultáneos (mismos importes), con el asiento de A frenado 1 s.
$PS >/dev/null <<'SQL'
create function public.t208_lento() returns trigger language plpgsql as $$
begin if new.referencia = 'facturacion:DTM-208306' and new.origen = 'facturacion' then perform pg_sleep(2); end if; return new; end $$;
create trigger t208_lento before insert on public.asientos_contables for each row execute function public.t208_lento();
SQL
carrera race1 "$(srv) $(fact DTM-208306)" "$(srv) $(fact DTM-208306)" 0 0.5
$PS -c "drop trigger t208_lento on public.asientos_contables; drop function public.t208_lento();" >/dev/null
F="$(foto DTM-208306)"
R="$(json "$TMP/race1.a")+$(json "$TMP/race1.b")"
if { [ "$R" = "emitida+sin_cambios" ] || [ "$R" = "sin_cambios+emitida" ]; } && echo "$F" | grep -q '^cfg=0/dian=false vig=1 fact=1 rev=0 vacios=0'; then
  ok "RACE-1 facturar ‖ facturar: $R; una vigente, configuración presente [$F]"
else fallo "RACE-1 $R a=$(cat "$TMP/race1.a") b=$(cat "$TMP/race1.b") [$F]"; fi

# M1a: facturar sostiene la venta; mientras, la app registra un abono y lo postea:
# el INSERT espera la venta, y el posteo acredita Clientes (130505), no Anticipos.
carrera m1a "$(srv) begin; $(fact DTM-208307) select pg_sleep(3); commit;"   "$(aut $ADM) insert into public.abonos (numero_contrato, tenant, valor_abono, monto_cop, trm, fecha_abono, forma_pago) values ('DTM-208307', 'mayorista', 200000, 200000, 1, current_date, 'Efectivo'); reset role; $(srv) select public.postear_asiento_abono((select max(id) from public.abonos where numero_contrato = 'DTM-208307'), 'mayorista', '$ADM');" 3 1
AB="$($PS -c "select max(id) from public.abonos where numero_contrato = 'DTM-208307'")"
CRED="$($PS -c "select p.codigo from public.asiento_lineas l join public.puc_cuentas p on p.id = l.cuenta_id join public.asientos_contables a on a.id = l.asiento_id where a.referencia = 'abono:$AB' and l.haber > 0")"
if [ "$(json "$TMP/m1a.a")" = emitida ] && [ "$(json "$TMP/m1a.b")" = contabilizado ] && [ "$CRED" = 130505 ] && [ "$(cat "$TMP/m1a.ms")" -ge 1000 ]; then
  ok "M1a facturar ‖ abono+posteo: esperó $(cat "$TMP/m1a.ms") ms y acreditó Clientes (130505), no Anticipos"
else fallo "M1a a=$(cat "$TMP/m1a.a") b=$(cat "$TMP/m1a.b") cred=$CRED"; fi

# M1b: el abono se borra (sin confirmar) mientras llega el posteo tardío.
AB2="$($PS -c "$(aut $ADM) insert into public.abonos (numero_contrato, tenant, valor_abono, monto_cop, trm, fecha_abono, forma_pago) values ('DTM-208308', 'mayorista', 90000, 90000, 1, current_date, 'Efectivo') returning id;" | tail -1)"
carrera m1b "$(aut $ADM) begin; delete from public.abonos where id = $AB2; select pg_sleep(3); commit;" "$(srv) select public.postear_asiento_abono($AB2, 'mayorista', '$ADM');" 3 1
HU="$($PS -c "select count(*) from public.asientos_contables where referencia = 'abono:$AB2'")"
if [ "$(err "$TMP/m1b.b")" = F4405 ] && [ "$HU" = 0 ] && ! grep -q ERROR "$TMP/m1b.a"; then
  ok "M1b borrado ‖ posteo tardío: F4405 tras esperar $(cat "$TMP/m1b.ms") ms; 0 asientos huérfanos"
else fallo "M1b a=$(cat "$TMP/m1b.a") b=$(cat "$TMP/m1b.b") huérfanos=$HU"; fi

# E1: DELETE del abono (sostiene la fila 3 s, sin asiento todavía) ‖ posteo tardío.
# El DELETE confirma primero → el posteo ve el abono ausente (F4405); 0 asientos huérfanos.
AB3="$($PS -c "$(aut $ADM) insert into public.abonos (numero_contrato, tenant, valor_abono, monto_cop, trm, fecha_abono, forma_pago) values ('DTM-208314', 'mayorista', 70000, 70000, 1, current_date, 'Efectivo') returning id;" | tail -1)"
carrera e1 "$(aut $ADM) begin; delete from public.abonos where id = $AB3; select pg_sleep(3); commit;" "$(srv) select public.postear_asiento_abono($AB3, 'mayorista', '$ADM');" 3 1
HU="$($PS -c "select count(*) from public.asientos_contables where referencia = 'abono:$AB3'")"; AX="$($PS -c "select count(*) from public.abonos where id = $AB3")"
if ! grep -q ERROR "$TMP/e1.a" && [ "$(err "$TMP/e1.b")" = F4405 ] && [ "$HU" = 0 ] && [ "$AX" = 0 ]; then
  ok "E1 DELETE abono sin asiento ‖ posteo: borrado primero; el posteo da F4405 tras esperar $(cat "$TMP/e1.ms") ms; 0 asientos huérfanos"
else fallo "E1 a=$(cat "$TMP/e1.a") b=$(cat "$TMP/e1.b") asientos=$HU abonos=$AX"; fi

# E2: el posteo sostiene la fila (confirma a los 3 s) ‖ DELETE del abono.
# El DELETE espera la fila, ve el asiento ya confirmado y se rechaza (F4415): abono y asiento intactos.
AB4="$($PS -c "$(aut $ADM) insert into public.abonos (numero_contrato, tenant, valor_abono, monto_cop, trm, fecha_abono, forma_pago) values ('DTM-208315', 'mayorista', 80000, 80000, 1, current_date, 'Efectivo') returning id;" | tail -1)"
carrera e2 "$(srv) begin; select public.postear_asiento_abono($AB4, 'mayorista', '$ADM'); select pg_sleep(3); commit;" "$(aut $ADM) delete from public.abonos where id = $AB4;" 3 1
HU="$($PS -c "select count(*) from public.asientos_contables where referencia = 'abono:$AB4'")"; AX="$($PS -c "select count(*) from public.abonos where id = $AB4")"
if [ "$(json "$TMP/e2.a")" = contabilizado ] && [ "$(err "$TMP/e2.b")" = F4415 ] && [ "$HU" = 1 ] && [ "$AX" = 1 ] && [ "$(cat "$TMP/e2.ms")" -ge 1000 ]; then
  ok "E2 posteo ‖ DELETE abono: el DELETE esperó $(cat "$TMP/e2.ms") ms y dio F4415; abono=1 asiento=1 (sin orfandad)"
else fallo "E2 a=$(cat "$TMP/e2.a") b=$(cat "$TMP/e2.b") asientos=$HU abonos=$AX"; fi

# E3: DELETE ‖ DELETE de un abono con asiento ya confirmado: los dos F4415, sin interbloqueo.
carrera e3 "$(aut $ADM) begin; delete from public.abonos where id = $AB4; select pg_sleep(2); commit;" "$(aut $GER) delete from public.abonos where id = $AB4;" 2 0.5
if [ "$(err "$TMP/e3.a")" = F4415 ] && [ "$(err "$TMP/e3.b")" = F4415 ] && ! grep -q 40P01 "$TMP/e3.a" "$TMP/e3.b"; then
  ok "E3 DELETE ‖ DELETE de abono con asiento: los dos F4415; sin interbloqueo"
else fallo "E3 a=$(cat "$TMP/e3.a") b=$(cat "$TMP/e3.b")"; fi

# LT: espera acotada (lock_timeout 5 s dentro de la RPC).
carrera lt "begin; select 1 from public.ventas where numero_contrato = 'DTM-208309' for update; select pg_sleep(9); commit;" "$(srv) $(fact DTM-208309)" 9 1
if [ "$(err "$TMP/lt.b")" = 55P03 ] && [ "$(cat "$TMP/lt.ms")" -lt 8500 ]; then
  ok "LT venta tomada 9 s: facturar se rinde a los $(cat "$TMP/lt.ms") ms con 55P03; nada escrito [$(foto DTM-208309)]"
else fallo "LT b=$(cat "$TMP/lt.b") ms=$(cat "$TMP/lt.ms")"; fi

echo "== retirada parcial (rollback_208, D-RET) =="
for n in 310 311 312 313; do $PS -c "$(srv) $(fact DTM-208$n)" >/dev/null; done
$PSA -d "$DB" -1 < "$APP/supabase/scripts/rollback_208_facturacion_transaccional.sql" >/dev/null
GUARDAR_VIEJA="insert into public.contrato_facturacion (numero_contrato, irt, ingreso_propio, ingreso_exento, updated_at) values ('%s', 1500000, 300000, 77, now()) on conflict (numero_contrato) do update set irt = excluded.irt, ingreso_propio = excluded.ingreso_propio, ingreso_exento = excluded.ingreso_exento, updated_at = excluded.updated_at;"
g() { printf "$GUARDAR_VIEJA" "$1"; }

# Q5: Guardar (vieja) toma la venta y espera; Quitar (vieja) entra.
F0="$(foto DTM-208310)"
carrera q5 "$(aut $ADM) begin; select f208_priv.bloquear_venta('DTM-208310'); select pg_sleep(3); $(g DTM-208310) commit;" "$(aut $ADM) delete from public.contrato_facturacion where numero_contrato = 'DTM-208310';" 3 1
F="$(foto DTM-208310)"
if [ "$(err "$TMP/q5.a")" = F4440 ] && [ "$(err "$TMP/q5.b")" = F4440 ] && [ "$(cat "$TMP/q5.ms")" -lt 2500 ] && [ "$F" = "$F0" ] && ! grep -q 40P01 "$TMP/q5.a" "$TMP/q5.b"; then
  ok "Q5 Guardar(vieja) ‖ Quitar(vieja): los dos F4440; Quitar no esperó ($(cat "$TMP/q5.ms") ms); sin interbloqueo; foto idéntica [$F]"
else fallo "Q5 a=$(cat "$TMP/q5.a") b=$(cat "$TMP/q5.b") ms=$(cat "$TMP/q5.ms") [$F0 ⇒ $F]"; fi

# Q5r: Quitar (vieja) toma la FILA y espera; Guardar (vieja) entra (venta → fila).
F0="$(foto DTM-208311)"
carrera q5r "$(aut $ADM) begin; select 1 from public.contrato_facturacion where numero_contrato = 'DTM-208311' for update; select pg_sleep(3); delete from public.contrato_facturacion where numero_contrato = 'DTM-208311'; commit;" "$(aut $ADM) $(g DTM-208311)" 3 1
F="$(foto DTM-208311)"
if [ "$(err "$TMP/q5r.a")" = F4440 ] && [ "$(err "$TMP/q5r.b")" = F4440 ] && [ "$F" = "$F0" ] && ! grep -q 40P01 "$TMP/q5r.a" "$TMP/q5r.b" && [ "$(cat "$TMP/q5r.ms")" -lt 6000 ]; then
  ok "Q5r Quitar(vieja) con la fila ‖ Guardar(vieja): los dos F4440 en $(cat "$TMP/q5r.ms") ms; sin interbloqueo; foto idéntica"
else fallo "Q5r a=$(cat "$TMP/q5r.a") b=$(cat "$TMP/q5r.b") ms=$(cat "$TMP/q5r.ms") [$F0 ⇒ $F]"; fi

# Q6: Marcar DIAN (vieja) ‖ Quitar (vieja).
carrera q6 "$(aut $ADM) begin; insert into public.contrato_facturacion (numero_contrato, dian_emitida, dian_fecha, updated_at) values ('DTM-208312', true, current_date, now()) on conflict (numero_contrato) do update set dian_emitida = excluded.dian_emitida, dian_fecha = excluded.dian_fecha, updated_at = excluded.updated_at; select pg_sleep(3); commit;" "$(aut $ADM) delete from public.contrato_facturacion where numero_contrato = 'DTM-208312';" 3 1
F="$(foto DTM-208312)"
EB="$(err "$TMP/q6.b")"
if ! grep -q ERROR "$TMP/q6.a" && { [ "$EB" = F4440 ] || [ "$EB" = F4434 ]; } && echo "$F" | grep -q '^cfg=0/dian=true vig=1 fact=1 rev=0 vacios=0'; then
  ok "Q6 Marcar(vieja) ‖ Quitar(vieja): marcar sí; quitar $EB; solo cambió dian [$F]"
else fallo "Q6 a=$(cat "$TMP/q6.a") b=$(cat "$TMP/q6.b") [$F]"; fi

# Q7: Quitar (vieja) ‖ Quitar (vieja).
F0="$(foto DTM-208313)"
carrera q7 "$(aut $ADM) begin; delete from public.contrato_facturacion where numero_contrato = 'DTM-208313'; select pg_sleep(2); commit;" "$(aut $GER) delete from public.contrato_facturacion where numero_contrato = 'DTM-208313';" 2 0.5
F="$(foto DTM-208313)"
if [ "$(err "$TMP/q7.a")" = F4440 ] && [ "$(err "$TMP/q7.b")" = F4440 ] && [ "$F" = "$F0" ]; then
  ok "Q7 Quitar(vieja) ‖ Quitar(vieja): los dos F4440; foto idéntica [$F]"
else fallo "Q7 a=$(cat "$TMP/q7.a") b=$(cat "$TMP/q7.b") [$F0 ⇒ $F]"; fi

# E4 (tras la retirada parcial): el rollback NO reabre la orfandad.
HU0="$($PS -c "select count(*) from public.asientos_contables where referencia = 'abono:$AB4'")"
if $SES -c "$(aut $ADM) delete from public.abonos where id = $AB4;" >"$TMP/e4" 2>&1 && ! grep -q ERROR "$TMP/e4"; then fallo "E4 se borró un abono con asiento tras la retirada"
elif [ "$(err "$TMP/e4")" = F4415 ] && [ "$($PS -c "select count(*) from public.abonos where id = $AB4")" = 1 ] && [ "$HU0" = 1 ]; then
  ok "E4 tras la retirada parcial: el abono con asiento sigue sin poder borrarse (F4415); abono=1 asiento=1"
else fallo "E4 $(cat "$TMP/e4")"; fi

echo "Fallos: $FALLOS"
[ "$FALLOS" = 0 ]
