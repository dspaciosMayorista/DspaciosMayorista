#!/bin/sh
# ──────────────────────────────────────────────────────────────────
# CARRERAS · 227 cierre E/F/G (aceptación atómica, fencing de la cabecera, RPC financiera derivada)
# DOS SESIONES REALES con COMMIT real + observador. SOLO base LOCAL DESECHABLE en un contenedor Docker propio (CI o local);
# nunca remota, nunca Preview/Producción. NO se ejecutó en la máquina del autor (sin Docker): lo ejecuta el workflow.
#
# Uso (desde dspacios-travel/):
#   sh supabase/scripts/test_227_carrera.sh <base_nueva> [contenedor] [plantilla]
#     base_nueva  ^t227_[a-z0-9_]{1,40}$ que NO exista: se crea desde la plantilla (001–226), se le aplica la 227 y se BORRA
#                 al final (KEEP=1 la conserva).
#     plantilla   base con 001–226 (por defecto plantilla227ci). Solo se lee.
#
#   R1   aceptar ‖ aceptar (misma cotización)        → UN intento y UN número; los dos reciben el mismo
#   R2a  aceptar (sostiene) ‖ cambio de la fuente    → la aceptación gana; el cambio espera y no la altera; luego sube la revisión
#   R2b  cambio de la fuente (sostiene) ‖ aceptar    → la aceptación espera, revalida y se RECHAZA (p63_oferta_cambio); 0 intento, 0 número
#   R3   cambio de retención (sostiene) ‖ aceptar    → rechazo por el contador de costos (el PVP y el tarifario siguen iguales)
#   R4   cabecera (sostiene) ‖ reversión             → la reversión no ve la fila aún no confirmada: queda 'materializando', sin huérfanos
#   R5   reversión (sostiene) ‖ aceptar (reintento)  → SIN interbloqueo (orden oferta → aceptación); el reintento recibe un número NUEVO
#   R6   finalización ‖ finalización                 → una escribe las obligaciones, la otra ya_completo; sin 23505 ni duplicados
#   R7   finalización (sostiene) ‖ compensación      → la compensación responde ya_completo; contrato intacto
#   R8   finalización ‖ finalización con payload alterno → la alterna se RECHAZA sin tocar nada
# ──────────────────────────────────────────────────────────────────
set -eu
DB="${1:-}"
CT="${2:-pg227_ci}"
PLANTILLA="${3:-plantilla227ci}"
export MSYS_NO_PATHCONV=1
nombre_ok() { printf '%s' "$1" | grep -Eq "$2"; }
nombre_ok "$DB" '^t227_[a-z0-9_]{1,40}$' || { echo "Base inválida: usa un nombre nuevo ^t227_[a-z0-9_]{1,40}\$." >&2; exit 2; }
nombre_ok "$CT" '^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$' || { echo "Contenedor inválido." >&2; exit 2; }
nombre_ok "$PLANTILLA" '^[a-z][a-z0-9_]{0,62}$' || { echo "Plantilla inválida." >&2; exit 2; }

AQUI="$(cd "$(dirname "$0")" && pwd)"
APP="$(cd "$AQUI/../.." && pwd)"
PW="${PGPASSWORD_227:-postgres}"
ROL="${ROL_MIGRA:-supabase_admin}"
PSA="docker exec -i -e PGPASSWORD=$PW $CT psql -h 127.0.0.1 -U $ROL -X -q -v ON_ERROR_STOP=1"
PS="$PSA -d $DB -t -A"
SES="docker exec -i -e PGPASSWORD=$PW $CT psql -h 127.0.0.1 -U $ROL -d $DB -X -q -t -A -v VERBOSITY=verbose"
TMP="$(mktemp -d)"
MARCA="test_227_carrera $(od -An -N6 -tx1 /dev/urandom | tr -d ' \n')"
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
  if [ -n "${SALIDAS_DIR:-}" ]; then mkdir -p "$SALIDAS_DIR" && cp "$TMP"/* "$SALIDAS_DIR"/ 2>/dev/null || true; fi
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
$PSA -d "$DB" >/dev/null <<'SQL'
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
SQL
docker exec -i -e PGPASSWORD="$PW" "$CT" psql -h 127.0.0.1 -U "$ROL" -X -q -d "$DB" -v ON_ERROR_STOP=1 < "$APP/supabase/migrations/20260601000227_salida_vinculada_empaquetado.sql" >/dev/null || { echo "La 227 falló." >&2; exit 1; }
echo "Base $DB: plantilla + 227 aplicadas."

# ── Utilidades SQL del mundo de la prueba (esquema propio t227c; la base se borra al final) ─────────
$PS >/dev/null <<'SQL'
create schema t227c;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000227c01', 'c227c@x.test') on conflict do nothing;
insert into public.usuarios (id, email, nombre, rol, activo, tenant)
values ('00000000-0000-0000-0000-000000227c01', 'c227c@x.test', 'C227C', 'venta', true, 'mayorista')
on conflict (id) do update set rol = excluded.rol, activo = true, tenant = excluded.tenant;
insert into public.destinos (id, nombre, codigo_iata, pais, activo) values (227900, 'T227C CARTAGENA', 'CTG', 'Colombia', true) on conflict do nothing;
insert into public.proveedores (id, nombre, aplica_retencion, pct_retencion) values (227700, 'T227C PROV', true, 0.035) on conflict do nothing;
insert into public.hoteles (id, destino_id, nombre, proveedor_id) values (227600, 227900, 'T227C HOTEL', 227700) on conflict do nothing;

-- Un "mundo" por carrera: paquete en modo 63 con una salida vinculada, publicado, y una oferta cotizada. Devuelve el id de la cotización.
create function t227c.snap(p_paquete bigint, p_salida bigint, p_emp bigint) returns jsonb language sql stable as $$
  select jsonb_build_object('v', 1, 'paquete_id', p_paquete, 'salida_id', p_salida, 'empaquetado_id', p_emp, 'trm', 4000, 'moneda', 'COP',
    'cabecera', jsonb_build_object('tipo_paquete', 'dinamico', 'moneda', 'COP', 'fecha_salida', (current_date + 60)::text, 'fecha_regreso', (current_date + 63)::text,
      'pax', 2, 'destino', 'T227C CARTAGENA', 'hotel', 'T227C HOTEL', 'precio_venta', 3360000, 'impuesto', 2260000, 'costo_aereo', 2080500, 'aerolinea', 'AEROTEST',
      'plan_nombre', 'ESTANDAR · PC', 'paquete_armado_id', p_paquete, 'n_tramos', 2, 'n_items', 1, 'n_hoteles', 1),
    'financiero', jsonb_build_object('costos', jsonb_build_object('costo_hotel', 840000, 'costo_aereo', 2080500), 'cxp', jsonb_build_array(
      jsonb_build_object('obligacion', 'aereo:0', 'tipo_proveedor', 'aereo', 'proveedor', 'AEROTEST', 'servicio', 'Aéreo AEROTEST', 'valor_total', 2080500, 'moneda', 'COP',
        'valor_cop', 2080500, 'trm', 4000, 'aplica_retencion', false, 'pct_retencion', 0, 'observaciones', 'Generado automáticamente desde el tarifario', 'servicio_id', null),
      jsonb_build_object('obligacion', 'hotel:0', 'tipo_proveedor', 'hotel', 'proveedor', 'T227C PROV', 'servicio', 'Hotel T227C', 'valor_total', 210, 'moneda', 'USD',
        'valor_cop', 840000, 'trm', 4000, 'aplica_retencion', true, 'pct_retencion', 0.035, 'observaciones', 'Generado automáticamente desde el tarifario', 'servicio_id', null))))
$$;

create function t227c.mundo(p_n int) returns bigint language plpgsql as $$
declare v_paq bigint := 227100 + p_n; v_emp bigint := 227100 + p_n; v_sal bigint; v_t0 jsonb; v_cot jsonb; v_id bigint;
begin
  insert into public.armado_paquetes (id, nombre, tipo, activo, destino_id, modo_oferta, trm_oferta) values (v_paq, 'T227C ' || p_n, 'dinamico', true, 227900, 'cop_trm_63', 4000);
  insert into public.empaquetados (id, record, aerolinea, ruta, destino_id, fecha_ida, fecha_regreso, tarifa_proveedor, tarifa_para_empaquetar, fee_infante, activo)
  values (v_emp, null, 'AEROTEST', 'BOG - CTG - BOG', 227900, current_date + 60, current_date + 63, 1000000, 1130000, 80500, true);
  insert into public.salidas_dinamicas (paquete_id, empaquetado_id, fecha_ida, fecha_regreso, ruta, aerolinea, valor_tiquete, fee_infante, aplica_mk, ta)
  values (v_paq, v_emp, current_date + 60, current_date + 63, 'BOG - CTG - BOG', 'AEROTEST', 1130000, 80500, false, 0) returning id into v_sal;
  insert into public.armado_hoteles (paquete_id, hotel_id) values (v_paq, 227600);
  -- Publicado y publicable (la publicación real la prueba test_227_salida_vinculada.sql): aquí se fija el estado de partida.
  update public.armado_paquetes set tarifario_snapshot_publicable = true, tarifario_revision_publicada = tarifario_revision_fuente,
         tarifario_generacion_publicada = tarifario_generacion where id = v_paq;
  select jsonb_build_object('rev_fuente', tarifario_revision_fuente, 'rev_publicada', tarifario_revision_publicada, 'gen_publicada', tarifario_generacion_publicada, 'rev_costos', p63_rev_costos)
    into v_t0 from public.armado_paquetes where id = v_paq;
  v_cot := jsonb_build_object('tenant', 'mayorista', 'payload', '{}'::jsonb, 'detalle', '{}'::jsonb, 'cliente', 'Cliente 227C', 'destino', 'T227C CARTAGENA', 'hotel', 'T227C HOTEL',
    'modulo', 'dinamico', 'plan_nombre', 'ESTANDAR · PC', 'pax', 2, 'precio_venta', 3360000, 'moneda', 'COP', 'fecha_salida', (current_date + 60)::text,
    'fecha_regreso', (current_date + 63)::text, 'vigencia_hasta', (current_date + 1)::text, 'paquete_armado_id', v_paq, 'asesor', 'A', 'creado_por', 'c227c@x.test');
  v_id := public.crear_cotizacion_oferta_63('00000000-0000-0000-0000-000000227c01', 'mayorista', v_cot, t227c.snap(v_paq, v_sal, v_emp), 'h1', 'f1', v_t0);
  return v_id;
end $$;

create function t227c.cabecera(p_numero text, p_acep bigint, p_paq bigint) returns void language plpgsql as $$
begin
  insert into public.ventas (numero_contrato, tenant, cliente, tipo_paquete, moneda, fecha_salida, fecha_regreso, pax, hotel, destino, precio_venta, impuesto, costo_aereo,
    aerolinea, estado, financiero_estado, plan_nombre, paquete_armado_id, aceptacion_63_id)
  values (p_numero, 'mayorista', 'Cliente 227C', 'dinamico', 'COP', current_date + 60, current_date + 63, 2, 'T227C HOTEL', 'T227C CARTAGENA', 3360000, 2260000, 2080500,
    'AEROTEST', 'pendiente', 'pendiente', 'ESTANDAR · PC', p_paq, p_acep);
end $$;

create function t227c.hijos_y_pendiente(p_numero text, p_acep bigint) returns void language plpgsql as $$
declare v_der jsonb := public.p63_financiero_derivado(p_acep);
begin
  insert into public.contrato_vuelos (numero_contrato) select p_numero from generate_series(1, 2);
  insert into public.contrato_items (numero_contrato, descripcion) values (p_numero, 'item');
  insert into public.contrato_hoteles (numero_contrato, nombre) values (p_numero, 'T227C HOTEL');
  insert into public.contrato_financiero_pendiente (numero_contrato, tenant, costos, cxp) values (p_numero, 'mayorista', v_der -> 'costos', v_der -> 'cxp');
end $$;
SQL

srv() { echo "set role service_role; select set_config('request.jwt.claims', '{\"role\":\"service_role\"}', false);"; }
acep() { echo "select public.aceptar_oferta_63($1, 'mayorista', '00000000-0000-0000-0000-000000227c01', 'h1', 'f1');"; }
fin() { echo "select public.registrar_financiero_contrato('$1', 'mayorista', '{}'::jsonb, '[]'::jsonb);"; }
rev() { echo "select public.revertir_contrato_incompleto('$1', 'mayorista');"; }
t0() { date +%s%N | cut -c1-13; }
ms() { echo $(( $(t0) - $1 )); }
carrera() { # $1=nombre $2=sqlA $3=sqlB $4=retraso
  ( $SES -c "$2" >"$TMP/$1.a" 2>&1 || true ) &
  sleep "${4:-1}"
  ini=$(t0)
  $SES -c "$3" >"$TMP/$1.b" 2>&1 || true
  echo "$(ms "$ini")" >"$TMP/$1.ms"
  wait
}
sec() { echo "$(srv) begin; $1 select pg_sleep($2); commit;"; }
sin_error() { ! grep -q ERROR "$1"; }
con_error() { grep -q "$2" "$1"; }
num_de() { grep -o '"numero_contrato": "[A-Z0-9-]*"' "$1" | head -1 | sed 's/.*: "//; s/"//'; }
acep_de() { grep -o '"aceptacion_id": [0-9]*' "$1" | head -1 | sed 's/.*: //'; }
cuenta_acep() { $PS -c "select count(*) from public.p63_aceptacion where cotizacion_id = $1 and estado <> 'descartada'"; }
cuenta_total() { $PS -c "select count(*) from public.p63_aceptacion where cotizacion_id = $1"; }

# R1: aceptar ‖ aceptar (la misma cotización): un solo intento y un solo número.
C1="$($PS -c "select t227c.mundo(1)")"
carrera r1 "$(sec "$(acep "$C1")" 3)" "$(srv) $(acep "$C1")" 1
if sin_error "$TMP/r1.a" && sin_error "$TMP/r1.b" && [ "$(num_de "$TMP/r1.a")" = "$(num_de "$TMP/r1.b")" ] && [ -n "$(num_de "$TMP/r1.a")" ] \
   && [ "$(cuenta_total "$C1")" = 1 ] && [ "$(cat "$TMP/r1.ms")" -ge 1000 ]; then
  ok "R1 aceptar ‖ aceptar: B esperó $(cat "$TMP/r1.ms") ms y recibió el MISMO intento/número ($(num_de "$TMP/r1.a")); un solo intento"
else fallo "R1 a=$(cat "$TMP/r1.a") b=$(cat "$TMP/r1.b") intentos=$(cuenta_total "$C1")"; fi

# R2a: la aceptación sostiene los candados ‖ alguien cambia la fuente (el cambio espera y no altera lo aceptado).
C2="$($PS -c "select t227c.mundo(2)")"
carrera r2a "$(sec "$(acep "$C2")" 3)" "$(srv) update public.empaquetados set tarifa_proveedor = 1000001 where id = 227102;" 1
if sin_error "$TMP/r2a.a" && sin_error "$TMP/r2a.b" && [ "$(cat "$TMP/r2a.ms")" -ge 1000 ] && [ "$(cuenta_acep "$C2")" = 1 ] \
   && [ "$($PS -c "select (snapshot -> 'financiero' -> 'costos' ->> 'costo_aereo')::numeric from public.p63_aceptacion where cotizacion_id = $C2")" = 2080500 ]; then
  ok "R2a aceptar ‖ cambio de la fuente: el cambio esperó $(cat "$TMP/r2a.ms") ms; el intento conserva lo aceptado (costo 2.080.500)"
else fallo "R2a a=$(cat "$TMP/r2a.a") b=$(cat "$TMP/r2a.b")"; fi

# R2b: el cambio de la fuente sostiene su fila ‖ la aceptación llega a la vez: espera, revalida y se rechaza.
C3="$($PS -c "select t227c.mundo(3)")"
carrera r2b "$(srv) begin; update public.empaquetados set tarifa_proveedor = 1000001 where id = 227103; select pg_sleep(3); commit;" "$(srv) $(acep "$C3")" 1
if con_error "$TMP/r2b.b" p63_oferta_cambio && [ "$(cuenta_total "$C3")" = 0 ] && [ "$(cat "$TMP/r2b.ms")" -ge 1000 ] \
   && [ "$($PS -c "select estado from public.p63_oferta where cotizacion_id = $C3")" = abierta ]; then
  ok "R2b cambio de la fuente ‖ aceptar: la aceptación esperó $(cat "$TMP/r2b.ms") ms y se RECHAZÓ (p63_oferta_cambio); 0 intento, 0 número"
else fallo "R2b a=$(cat "$TMP/r2b.a") b=$(cat "$TMP/r2b.b") intentos=$(cuenta_total "$C3")"; fi

# R3: la retención del proveedor del hotel cambia (sostiene) ‖ aceptar: el PVP y el tarifario siguen iguales, pero el contador de costos subió.
C4="$($PS -c "select t227c.mundo(4)")"
carrera r3 "$(srv) begin; update public.proveedores set pct_retencion = 0.11 where id = 227700; select pg_sleep(3); commit;" "$(srv) $(acep "$C4")" 1
if con_error "$TMP/r3.b" p63_oferta_cambio && [ "$(cuenta_total "$C4")" = 0 ] && [ "$($PS -c "select p63_rev_costos from public.armado_paquetes where id = 227104")" -ge 1 ]    && [ "$($PS -c "select tarifario_snapshot_publicable from public.armado_paquetes where id = 227104")" = t ]; then
  ok "R3 cambio de retención ‖ aceptar: la aceptación esperó $(cat "$TMP/r3.ms") ms y se RECHAZÓ solo por el contador de costos (el tarifario sigue publicable); 0 intento"
else fallo "R3 a=$(cat "$TMP/r3.a") b=$(cat "$TMP/r3.b") intentos=$(cuenta_total "$C4")"; fi
$PS -c "update public.proveedores set pct_retencion = 0.035 where id = 227700" >/dev/null

# R4: la cabecera (confirmada tras esperar) ‖ la reversión de otro proceso: la reversión no ve una fila no confirmada.
C5="$($PS -c "select t227c.mundo(6)")"
A5="$($SES -c "$(srv) $(acep "$C5")" 2>&1 || true)"; echo "$A5" >"$TMP/r4.acep"
N5="$(num_de "$TMP/r4.acep")"; I5="$(acep_de "$TMP/r4.acep")"
carrera r4 "$(srv) begin; select t227c.cabecera('$N5', $I5, 227106); select pg_sleep(3); commit;" "$(srv) $(rev "$N5")" 1
E5="$($PS -c "select estado from public.p63_aceptacion where id = $I5")"
if [ "$E5" = materializando ] && [ "$($PS -c "select count(*) from public.ventas where numero_contrato = '$N5'")" = 1 ]; then
  ok "R4 cabecera ‖ reversión: la reversión no vio la fila sin confirmar; el intento queda 'materializando' y la cabecera existe (la recuperación es la finalización o la reversión posterior)"
else fallo "R4 intento=$E5 a=$(cat "$TMP/r4.a") b=$(cat "$TMP/r4.b")"; fi

# R5: la reversión borra la cabecera (sostiene oferta → aceptación) ‖ el reintento de aceptar: SIN interbloqueo.
C6="$($PS -c "select t227c.mundo(7)")"
A6="$($SES -c "$(srv) $(acep "$C6")" 2>&1 || true)"; echo "$A6" >"$TMP/r5.acep"
N6="$(num_de "$TMP/r5.acep")"; I6="$(acep_de "$TMP/r5.acep")"
$PS -c "select t227c.cabecera('$N6', $I6, 227107)" >/dev/null
carrera r5 "$(srv) begin; $(rev "$N6") select pg_sleep(3); commit;" "$(srv) $(acep "$C6")" 1
N6B="$(num_de "$TMP/r5.b")"
if ! grep -q 40P01 "$TMP/r5.a" "$TMP/r5.b" && sin_error "$TMP/r5.b" && [ -n "$N6B" ] && [ "$N6B" != "$N6" ] && [ "$(cuenta_acep "$C6")" = 1 ] \
   && [ "$($PS -c "select estado from public.p63_aceptacion where id = $I6")" = descartada ]; then
  ok "R5 reversión ‖ reintento: sin interbloqueo; el intento viejo queda descartado ($N6) y el reintento recibe un número NUEVO ($N6B)"
else fallo "R5 a=$(cat "$TMP/r5.a") b=$(cat "$TMP/r5.b")"; fi

# R6/R7/R8: finalización. Un intento materializado por mundo.
materializar() { # $1=n del mundo → deja el intento listo para finalizar; imprime "cot num acep"
  c="$($PS -c "select t227c.mundo($1)")"
  a="$($SES -c "$(srv) $(acep "$c")" 2>&1 || true)"; echo "$a" >"$TMP/m$1.acep"
  n="$(num_de "$TMP/m$1.acep")"; i="$(acep_de "$TMP/m$1.acep")"
  $PS -c "select t227c.cabecera('$n', $i, 227100 + $1); select t227c.hijos_y_pendiente('$n', $i)" >/dev/null
  echo "$c $n $i"
}
set -- $(materializar 8); N8="$2"; I8="$3"
carrera r6 "$(sec "$(fin "$N8")" 3)" "$(srv) $(fin "$N8")" 1
if sin_error "$TMP/r6.a" && sin_error "$TMP/r6.b" && grep -q '"ya_completo": true' "$TMP/r6.b" && ! grep -q 23505 "$TMP/r6.a" "$TMP/r6.b" \
   && [ "$($PS -c "select count(*) from public.cuentas_por_pagar where numero_contrato = '$N8' and aceptacion_63_id = $I8")" = 2 ] \
   && [ "$($PS -c "select estado from public.p63_aceptacion where id = $I8")" = completa ]; then
  ok "R6 finalización ‖ finalización: una escribió las 2 obligaciones, la otra respondió ya_completo (esperó $(cat "$TMP/r6.ms") ms); sin 23505"
else fallo "R6 a=$(cat "$TMP/r6.a") b=$(cat "$TMP/r6.b")"; fi

set -- $(materializar 9); N9="$2"; I9="$3"
carrera r7 "$(sec "$(fin "$N9")" 3)" "$(srv) $(rev "$N9")" 1
if sin_error "$TMP/r7.b" && grep -q '"estado": "ya_completo"' "$TMP/r7.b" && [ "$($PS -c "select count(*) from public.ventas where numero_contrato = '$N9'")" = 1 ] \
   && [ "$($PS -c "select estado from public.p63_aceptacion where id = $I9")" = completa ]; then
  ok "R7 finalización ‖ compensación: la compensación esperó $(cat "$TMP/r7.ms") ms y respondió ya_completo; el contrato y su aceptación siguen completos"
else fallo "R7 a=$(cat "$TMP/r7.a") b=$(cat "$TMP/r7.b")"; fi

set -- $(materializar 10); N10="$2"; I10="$3"
ALT="select public.registrar_financiero_contrato('$N10', 'mayorista', '{\"costo_hotel\": 1}'::jsonb, '[{\"tipo_proveedor\":\"hotel\",\"valor_total\":1,\"obligacion\":\"hotel:0\"}]'::jsonb);"
carrera r8 "$(sec "$(fin "$N10")" 3)" "$(srv) $ALT" 1
if sin_error "$TMP/r8.a" && ( grep -q '"ya_completo": true' "$TMP/r8.b" || con_error "$TMP/r8.b" p63_payload_alterno ) \
   && [ "$($PS -c "select costo_hotel from public.ventas where numero_contrato = '$N10'")" = 840000 ]; then
  ok "R8 finalización ‖ payload alterno: no se tocó nada (costo_hotel sigue en 840.000); respuesta: $(grep -o 'ya_completo\|p63_payload_alterno' "$TMP/r8.b" | head -1)"
else fallo "R8 a=$(cat "$TMP/r8.a") b=$(cat "$TMP/r8.b")"; fi
# …y una alterna ANTES de completar se rechaza sin escribir.
set -- $(materializar 11); N11="$2"
$SES -c "$(srv) $(echo "$ALT" | sed "s/$N10/$N11/")" >"$TMP/r8c" 2>&1 || true
if con_error "$TMP/r8c" p63_payload_alterno && [ "$($PS -c "select financiero_estado from public.ventas where numero_contrato = '$N11'")" = pendiente ] \
   && [ "$($PS -c "select count(*) from public.cuentas_por_pagar where numero_contrato = '$N11'")" = 0 ]; then
  ok "R8b payload alterno antes de completar: rechazado (p63_payload_alterno); el contrato sigue pendiente y sin obligaciones"
else fallo "R8b $(cat "$TMP/r8c")"; fi

echo ""
if [ "$FALLOS" = 0 ]; then echo "TEST 227 CARRERAS: TODO OK"; else echo "TEST 227 CARRERAS: $FALLOS FALLO(S)"; exit 1; fi
