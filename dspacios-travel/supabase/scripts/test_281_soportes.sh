#!/bin/sh
# ──────────────────────────────────────────────────────────────────
# SOPORTES DE PAGO (#86, migración 281) · pruebas en PostgreSQL LOCAL desechable con el esquema 001-280 (la plantilla).
# 1) migración 281 sobre una base nueva copiada de la plantilla; 2) test_281_soportes.sql (límite, reemplazo, EXCEDIDO, RLS, avisos…);
# 3) carreras REALES entre dos sesiones, con commits, contra la RPC real `anular_abono` (248): sin interbloqueos (40P01) ni sobrepasar el límite.
# SOLO Docker local: nada habla con Supabase remoto.
#
# Uso (desde dspacios-travel/):
#   sh supabase/scripts/test_281_soportes.sh <base_nueva> [contenedor_pg] [plantilla]
#     base_nueva    ^t281_[a-z0-9_]{1,40}$ y que NO exista; se crea desde la plantilla y se borra al final (KEEP=1 la conserva).
#     contenedor_pg postgres local (por defecto pg86soportes).
#     plantilla     base con 001-280 aplicadas (preparar_esquema_local.sh <contenedor> 280 plantilla86).
# Propiedad: lo único que se borra es la base creada aquí (solo si lleva la marca de esta corrida).
# ──────────────────────────────────────────────────────────────────
set -eu
DB="${1:-}"
CT="${2:-pg86soportes}"
PLANTILLA="${3:-plantilla86}"
export MSYS_NO_PATHCONV=1
ok_nombre() { printf '%s' "$1" | grep -Eq "$2"; }
ok_nombre "$DB" '^t281_[a-z0-9_]{1,40}$' || { echo "Base inválida: usa un nombre nuevo ^t281_[a-z0-9_]{1,40}\$." >&2; exit 2; }
ok_nombre "$CT" '^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$' || { echo "Contenedor inválido." >&2; exit 2; }
ok_nombre "$PLANTILLA" '^[a-z][a-z0-9_]{0,62}$' || { echo "Plantilla inválida." >&2; exit 2; }
AQUI="$(cd "$(dirname "$0")" && pwd)"
APP="$(cd "$AQUI/../.." && pwd)"
MIG="$APP/supabase/migrations/20260601000281_soportes_pago.sql"
MARCA="test_281_soportes $(od -An -N6 -tx1 /dev/urandom | tr -d ' \n')"
PS="docker exec -i -e PGPASSWORD=postgres $CT psql -h 127.0.0.1 -U supabase_admin -X -q -t -A -v ON_ERROR_STOP=1"
SALIDAS="$(mktemp -d)"
BASE_PROPIA=0
limpiar() {
  st=$?
  if [ "$BASE_PROPIA" = 1 ] && [ "${KEEP:-}" != 1 ]; then
    marca="$($PS -d postgres -c "select shobj_description(oid, 'pg_database') from pg_database where datname = '$DB'" 2>/dev/null || true)"
    if [ "$marca" = "$MARCA" ]; then
      for i in 1 2 3 4 5; do $PS -d postgres -c "drop database $DB" >/dev/null 2>&1 && break; sleep 2; done
    else echo "AVISO: $DB no lleva la marca de esta corrida; no se borra." >&2; fi
  fi
  rm -rf "$SALIDAS"
  exit "$st"
}
trap limpiar EXIT
docker inspect -f '{{.State.Running}}' "$CT" 2>/dev/null | grep -qx true || { echo "El contenedor $CT no está corriendo." >&2; exit 2; }
[ "$($PS -d postgres -c "select count(*) from pg_database where datname = '$PLANTILLA'")" = 1 ] || { echo "No existe la plantilla $PLANTILLA." >&2; exit 2; }
[ "$($PS -d postgres -c "select count(*) from pg_database where datname = '$DB'")" = 0 ] || { echo "La base $DB ya existe: no se toca." >&2; exit 3; }
creada=0
for i in 1 2 3 4 5 6; do
  $PS -d postgres -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = '$PLANTILLA' and pid <> pg_backend_pid()" >/dev/null 2>&1 || true
  $PS -d postgres -c "create database $DB template $PLANTILLA" >/dev/null 2>&1 && { creada=1; break; }
  sleep 1
done
[ "$creada" = 1 ] || { echo "No se pudo crear $DB." >&2; exit 3; }
BASE_PROPIA=1
$PS -d postgres -c "comment on database $DB is '$MARCA'" >/dev/null

# ── Entorno (NO es esquema de la app) ─────────────────────────────────────
# La imagen no trae file_size_limit/allowed_mime_types en storage.buckets (Supabase alojado sí) y su auth.uid() no lee request.jwt.claims.
$PS -d "$DB" >/dev/null <<'SQL'
alter table storage.buckets add column if not exists file_size_limit bigint, add column if not exists allowed_mime_types text[];
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
$$;
SQL
POLICIES_ANTES="$($PS -d "$DB" -c "select count(*) from pg_policies where schemaname='storage' and tablename='objects'")"

PERMISOS_ANTES="$($PS -d "$DB" -c "select coalesce(proacl::text, '<defecto>') || ' / ' || proowner::regrole::text || ' / ' || prosecdef || ' / ' || coalesce(proconfig::text, '') from pg_proc where oid = 'public.fn_renumerar_contrato(text,text)'::regprocedure")"
echo "== 1. Aplicando la migración 281 (una transacción) =="
$PS -1 -d "$DB" -f - < "$MIG" >/dev/null
echo "   aplicada. Policies de storage.objects antes/después: $POLICIES_ANTES / $($PS -d "$DB" -c "select count(*) from pg_policies where schemaname='storage' and tablename='objects'")"

echo "== 2. Pruebas SQL deterministas =="
$PS -d "$DB" -F ' | ' -f - < "$AQUI/test_281_soportes.sql" | tee "$SALIDAS/sql.out" | grep -E 'FALLA|RESUMEN' || true
FALLAS_SQL="$(grep -c '| FALLA$' "$SALIDAS/sql.out" || true)"
echo "   filas de control: $(grep -c '| OK$' "$SALIDAS/sql.out" || true) OK, $FALLAS_SQL FALLA"

echo "== 3. Carreras reales entre dos sesiones (commits, anular_abono real) =="
$PS -d "$DB" >/dev/null <<'SQL'
insert into auth.users (id, email) values
 ('00000000-0000-0000-0000-000000281101','ger2@t.test'),('00000000-0000-0000-0000-000000281102','aliado2@t.test') on conflict do nothing;
insert into public.usuarios (id, email, nombre, rol, activo, tenant) values
 ('00000000-0000-0000-0000-000000281101','ger2@t.test','Gerente C281','gerencia',true,'mayorista'),
 ('00000000-0000-0000-0000-000000281102','aliado2@t.test','Aliado C281','agencia',true,'mayorista')
on conflict (id) do update set nombre = excluded.nombre, rol = excluded.rol, activo = excluded.activo, tenant = excluded.tenant;
insert into public.ventas (numero_contrato, cliente, tenant, destino, fecha_salida, estado, precio_venta, moneda, asesor)
 select 'DTM-82' || lpad(i::text, 2, '0'), 'C' || i, 'mayorista', 'X', current_date + 30, 'confirmado', 1000, 'COP', 'nadie' from generate_series(1, 9) i;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000281103','su281@t.test') on conflict do nothing;
insert into public.usuarios (id, email, nombre, rol, activo, tenant) values ('00000000-0000-0000-0000-000000281103','su281@t.test','Super C281','superadmin',true,'minorista')
 on conflict (id) do update set nombre = excluded.nombre, rol = excluded.rol, activo = excluded.activo, tenant = excluded.tenant;
insert into public.ventas (numero_contrato, cliente, tenant, destino, fecha_salida, estado, precio_venta, moneda, asesor)
 select 'MIN-00-94' || lpad(i::text, 2, '0'), 'R' || i, 'minorista', 'X', current_date + 30, 'activo', 1000, 'COP', 'nadie' from generate_series(1, 6) i;
insert into public.abonos (numero_contrato, valor_abono, forma_pago, tenant)
 select 'MIN-00-94' || lpad(i::text, 2, '0'), 100, 'Transferencia', 'minorista' from generate_series(1, 6) i, generate_series(1, 2);
-- 01: 1 abono, 0 soportes · 02/03/04/05: 2 abonos · 06/07: 3 abonos
insert into public.abonos (numero_contrato, valor_abono, forma_pago, tenant)
 select 'DTM-82' || lpad(c::text, 2, '0'), 100, 'Transferencia', 'mayorista'
   from (values (1,1),(2,2),(3,2),(4,2),(5,2),(6,3),(7,3)) v(c, n), generate_series(1, v.n);
SQL
reg() { printf "select public.soporte_registrar('%s','00000000-0000-0000-0000-000000281102','%s/%s.pdf','c.pdf','application/pdf',10,repeat('a',64));" "$1" "$1" "$2"; }
sembrar() { # contrato n_soportes
  i=1; while [ "$i" -le "$2" ]; do $PS -d "$DB" -c "set role service_role; $(reg "$1" "s$i")" >/dev/null; i=$((i + 1)); done
}
sesion() { # nombre retardo_seg sql  → deja la salida en $SALIDAS/nombre.out
  ( sleep "$2"; printf '\\set VERBOSITY verbose\nset role service_role;\n%s\n' "$3" | docker exec -i -e PGPASSWORD=postgres "$CT" psql -h 127.0.0.1 -U supabase_admin -X -q -t -A -d "$DB" > "$SALIDAS/$1.out" 2>&1 ) &
}
sesion_su() { # nombre retardo_seg sql  → como superadmin autenticado (fn_renumerar_contrato exige rol de verdad)
  ( sleep "$2"; printf '\\set VERBOSITY verbose\nselect set_config(\x27request.jwt.claim.sub\x27, \x2700000000-0000-0000-0000-000000281103\x27, false), set_config(\x27request.jwt.claims\x27, \x27{"sub":"00000000-0000-0000-0000-000000281103","role":"authenticated"}\x27, false);\nset role authenticated;\n%s\n' "$3" | docker exec -i -e PGPASSWORD=postgres "$CT" psql -h 127.0.0.1 -U supabase_admin -X -q -t -A -d "$DB" > "$SALIDAS/$1.out" 2>&1 ) &
}
codigo() { grep -ohE 'F45[0-9]{2}|F44[0-9]{2}|40P01|55P03|40001' "$SALIDAS/$1.out" | head -1; }
FALLAS_CARRERA=0
veredicto() { # control esperado observado
  if [ "$2" = "$3" ]; then e=OK; else e=FALLA; FALLAS_CARRERA=$((FALLAS_CARRERA + 1)); fi
  printf '   %-72s esperado=%-14s observado=%-14s %s\n' "$1" "$2" "$3" "$e"
}
estado() { $PS -d "$DB" -c "select (select count(*) from public.abonos where numero_contrato='$1') || '|' || (select count(*) from public.contrato_soportes_pago where numero_contrato='$1' and vigente) || '|' || (select count(*) from public.contrato_soportes_pago where numero_contrato='$1')"; }
tx() { printf 'begin;\n%s\nselect pg_sleep(%s);\ncommit;' "$1" "$2"; }

# C1 · dos altas simultáneas con un solo abono: exactamente una pasa.
sesion c1a 0 "$(tx "$(reg DTM-8201 a)" 2)"; sesion c1b 0.8 "$(tx "$(reg DTM-8201 b)" 0)"; wait
veredicto "C1 dos altas con 1 abono: pasan (1)" "1" "$(cat "$SALIDAS"/c1a.out "$SALIDAS"/c1b.out | grep -c "^{")"
veredicto "C1 la perdedora recibe SOPORTE_LIMITE" "F4515" "$(codigo c1a)$(codigo c1b)"
veredicto "C1 estado final abonos|vigentes|filas" "1|1|1" "$(estado DTM-8201)"

# C2 · dos reemplazos simultáneos del MISMO soporte: uno gana, el otro F4513; vigentes no cambia.
sembrar DTM-8202 1; ID2="$($PS -d "$DB" -c "select id from public.contrato_soportes_pago where numero_contrato='DTM-8202' and vigente")"
rem() { printf "select public.soporte_reemplazar(%s,'00000000-0000-0000-0000-000000281102','DTM-8202/%s.pdf','n.pdf','application/pdf',10,repeat('b',64));" "$ID2" "$1"; }
sesion c2a 0 "$(tx "$(rem a)" 2)"; sesion c2b 0.8 "$(tx "$(rem b)" 0)"; wait
veredicto "C2 reemplazos simultáneos: el perdedor recibe SOPORTE_NO_VIGENTE" "F4513" "$(codigo c2a)$(codigo c2b)"
veredicto "C2 estado final abonos|vigentes|filas (1 vigente, historial 2)" "2|1|2" "$(estado DTM-8202)"

# C3 · reemplazar vs retirar el mismo soporte.
sembrar DTM-8203 1; ID3="$($PS -d "$DB" -c "select id from public.contrato_soportes_pago where numero_contrato='DTM-8203' and vigente")"
sesion c3a 0 "$(tx "select public.soporte_reemplazar($ID3,'00000000-0000-0000-0000-000000281102','DTM-8203/n.pdf','n.pdf','application/pdf',10,repeat('b',64));" 2)"
sesion c3b 0.8 "$(tx "select public.soporte_retirar($ID3,'00000000-0000-0000-0000-000000281102','x');" 0)"; wait
veredicto "C3 reemplazar vs retirar: el perdedor recibe SOPORTE_NO_VIGENTE" "F4513" "$(codigo c3a)$(codigo c3b)"
veredicto "C3 estado final abonos|vigentes|filas" "2|1|2" "$(estado DTM-8203)"

# C4 · alta (2.º soporte, cabe) vs anular un abono: ambas pasan, sin interbloqueo; queda EXCEDIDO (1 abono, 2 vigentes).
sembrar DTM-8204 1; AB4="$($PS -d "$DB" -c "select min(id) from public.abonos where numero_contrato='DTM-8204'")"
anu() { printf "select public.anular_abono(%s,'%s','mayorista','00000000-0000-0000-0000-000000281101','carrera 281');" "$2" "$1"; }
sesion c4a 0 "$(tx "$(reg DTM-8204 n2)" 2)"; sesion c4b 0.8 "$(tx "$(anu DTM-8204 "$AB4")" 0)"; wait
veredicto "C4 alta vs anulación: sin errores ni interbloqueo" "" "$(codigo c4a)$(codigo c4b)"
veredicto "C4 estado final abonos|vigentes|filas (excedido, nada se perdió)" "1|2|2" "$(estado DTM-8204)"

# C5 · anulación primero, alta después: el alta ve el abono ya anulado y se rechaza (límite).
sembrar DTM-8205 1; AB5="$($PS -d "$DB" -c "select min(id) from public.abonos where numero_contrato='DTM-8205'")"
sesion c5a 0 "$(tx "$(anu DTM-8205 "$AB5")" 2)"; sesion c5b 0.8 "$(tx "$(reg DTM-8205 n2)" 0)"; wait
veredicto "C5 anulación y luego alta: el alta recibe SOPORTE_LIMITE" "F4515" "$(codigo c5a)$(codigo c5b)"
veredicto "C5 estado final abonos|vigentes|filas" "1|1|1" "$(estado DTM-8205)"

# C6 · contrato EXCEDIDO (3 abonos/3 soportes → se anula 1 → 2/3): reemplazar vs anular otro abono; ambas pasan, el conteo vigente no cambia.
sembrar DTM-8206 3; AB6="$($PS -d "$DB" -c "select min(id) from public.abonos where numero_contrato='DTM-8206'")"
$PS -d "$DB" -c "set role service_role; $(anu DTM-8206 "$AB6")" >/dev/null
ID6="$($PS -d "$DB" -c "select min(id) from public.contrato_soportes_pago where numero_contrato='DTM-8206' and vigente")"
AB6B="$($PS -d "$DB" -c "select min(id) from public.abonos where numero_contrato='DTM-8206'")"
sesion c6a 0 "$(tx "select public.soporte_reemplazar($ID6,'00000000-0000-0000-0000-000000281102','DTM-8206/n.pdf','n.pdf','application/pdf',10,repeat('b',64));" 2)"
sesion c6b 0.8 "$(tx "$(anu DTM-8206 "$AB6B")" 0)"; wait
veredicto "C6 excedido: reemplazar vs anular, sin errores ni interbloqueo" "" "$(codigo c6a)$(codigo c6b)"
veredicto "C6 estado final abonos|vigentes|filas (1 abono, 3 vigentes, 4 filas)" "1|3|4" "$(estado DTM-8206)"

# C8 · un escritor de abonos que NO toma el bloqueo de ventas (p. ej. el importador de minorista borra y re-inserta abonos) baja el conteo mientras una alta está en curso:
#      no hay error ni corrupción; el contrato queda EXCEDIDO (calculado), que es un estado de primera clase. Un escritor que SUBE el conteo solo afloja el límite.
$PS -d "$DB" -c "insert into public.abonos (numero_contrato, valor_abono, forma_pago, tenant) select 'DTM-8208', 100, 'Transferencia', 'mayorista' from generate_series(1, 2)" >/dev/null
sembrar DTM-8208 1; AB8="$($PS -d "$DB" -c "select min(id) from public.abonos where numero_contrato='DTM-8208'")"
sesion c8a 0 "$(tx "$(reg DTM-8208 n2)" 2)"; sesion c8b 0.8 "reset role; delete from public.abonos where id = $AB8;"; wait
veredicto "C8 alta vs borrado de abono SIN bloqueo de ventas: sin errores" "" "$(codigo c8a)$(codigo c8b)"
veredicto "C8 estado final abonos|vigentes|filas (excedido, nada corrupto ni perdido)" "1|2|2" "$(estado DTM-8208)"

# C9-C12 · RENUMERAR un contrato (fn_renumerar_contrato REAL, como superadmin) contra altas, reemplazos y retiros de soportes. Orden de bloqueos único: venta → soportes.
#   · la renumeración bloquea la fila VIEJA de ventas primero; una alta que llegue después NO encuentra el contrato (nunca registra evidencia bajo el número viejo);
#     una alta ya en curso termina ANTES del traslado y su soporte viaja al número nuevo; reemplazar/retirar re-resuelven el número si se movió mientras esperaban.
rem() { printf "select public.fn_renumerar_contrato('%s', '%s');" "$1" "$2"; }
sembrar MIN-00-9401 1; sembrar MIN-00-9402 1; sembrar MIN-00-9403 1; sembrar MIN-00-9404 1
# C9 · renumeración en curso + alta bajo el número viejo
sesion_su c9a 0 "$(tx "$(rem MIN-00-9401 MIN-00-9411)" 2)"; sesion c9b 0.8 "$(reg MIN-00-9401 n2)"; wait
veredicto "C9 renumeración vs alta bajo el número VIEJO: la alta no encuentra el contrato" "F4510" "$(codigo c9b)"
veredicto "C9 la renumeración terminó sin error" "" "$(codigo c9a)"
veredicto "C9 bajo el número NUEVO: abonos|vigentes|filas (la evidencia viajó; nada se registró bajo el viejo)" "2|1|1" "$(estado MIN-00-9411)"
veredicto "C9 bajo el número VIEJO: nada" "0|0|0" "$(estado MIN-00-9401)"
# C10 · alta en curso + renumeración
sesion c10a 0 "$(tx "$(reg MIN-00-9402 n2)" 2)"; sesion_su c10b 0.8 "$(rem MIN-00-9402 MIN-00-9412)"; wait
veredicto "C10 alta en curso vs renumeración: sin errores" "" "$(codigo c10a)$(codigo c10b)"
veredicto "C10 el soporte recién registrado viajó al número nuevo: abonos|vigentes|filas" "2|2|2" "$(estado MIN-00-9412)"
veredicto "C10 nada queda bajo el número viejo" "0|0|0" "$(estado MIN-00-9402)"
# C11 · renumeración en curso + REEMPLAZAR (re-resuelve el número nuevo)
ID11="$($PS -d "$DB" -c "select id from public.contrato_soportes_pago where numero_contrato='MIN-00-9403' and vigente")"
sesion_su c11a 0 "$(tx "$(rem MIN-00-9403 MIN-00-9413)" 2)"
sesion c11b 0.8 "select public.soporte_reemplazar($ID11,'00000000-0000-0000-0000-000000281102','MIN-00-9403/n.pdf','n.pdf','application/pdf',10,repeat('b',64));"; wait
veredicto "C11 renumeración vs reemplazar: sin errores (el reemplazo opera sobre el número nuevo)" "" "$(codigo c11a)$(codigo c11b)"
veredicto "C11 bajo el número nuevo: abonos|vigentes|filas (1 vigente + historial)" "2|1|2" "$(estado MIN-00-9413)"
veredicto "C11 nada bajo el número viejo" "0|0|0" "$(estado MIN-00-9403)"
# C12 · renumeración en curso + RETIRAR
ID12="$($PS -d "$DB" -c "select id from public.contrato_soportes_pago where numero_contrato='MIN-00-9404' and vigente")"
sesion_su c12a 0 "$(tx "$(rem MIN-00-9404 MIN-00-9414)" 2)"
sesion c12b 0.8 "select public.soporte_retirar($ID12,'00000000-0000-0000-0000-000000281102','baja');"; wait
veredicto "C12 renumeración vs retirar: sin errores" "" "$(codigo c12a)$(codigo c12b)"
veredicto "C12 bajo el número nuevo: abonos|vigentes|filas (retirado, conservado)" "2|0|1" "$(estado MIN-00-9414)"
veredicto "C12 nada bajo el número viejo" "0|0|0" "$(estado MIN-00-9404)"
# C13/C14 · la renumeración también toma «venta primero» frente a anular_abono (248): sin interbloqueo (40P01) en ninguno de los dos órdenes.
sembrar MIN-00-9405 1; sembrar MIN-00-9406 1
AB13="$($PS -d "$DB" -c "select min(id) from public.abonos where numero_contrato='MIN-00-9405'")"
AB14="$($PS -d "$DB" -c "select min(id) from public.abonos where numero_contrato='MIN-00-9406'")"
anu2() { printf "select public.anular_abono(%s,'%s','minorista','00000000-0000-0000-0000-000000281101','carrera renumeración');" "$2" "$1"; }
sesion_su c13a 0 "$(tx "$(rem MIN-00-9405 MIN-00-9415)" 2)"; sesion c13b 0.8 "$(anu2 MIN-00-9405 "$AB13")"; wait
veredicto "C13 renumeración vs anular_abono con el número VIEJO: sin interbloqueo; la anulación falla limpio (el número viejo ya no existe)" "F4404" "$(codigo c13b)"
veredicto "C13 estado bajo el número nuevo: abonos|vigentes|filas" "2|1|1" "$(estado MIN-00-9415)"
sesion c14a 0 "$(tx "$(anu2 MIN-00-9406 "$AB14")" 2)"; sesion_su c14b 0.8 "$(rem MIN-00-9406 MIN-00-9416)"; wait
veredicto "C14 anular_abono en curso vs renumeración: sin errores ni interbloqueo" "" "$(codigo c14a)$(codigo c14b)"
veredicto "C14 estado bajo el número nuevo: abonos|vigentes|filas (1 abono, 1 soporte, nada se perdió)" "1|1|1" "$(estado MIN-00-9416)"
PERMISOS_DESPUES="$($PS -d "$DB" -c "select coalesce(proacl::text, '<defecto>') || ' / ' || proowner::regrole::text || ' / ' || prosecdef || ' / ' || coalesce(proconfig::text, '') from pg_proc where oid = 'public.fn_renumerar_contrato(text,text)'::regprocedure")"
veredicto "fn_renumerar_contrato: permisos, propietario, SECURITY DEFINER y search_path IDÉNTICOS tras la 281" "$PERMISOS_ANTES" "$PERMISOS_DESPUES"

# C7 · reclamo concurrente de avisos: el segundo salta lo bloqueado; no hay duplicados.
$PS -d "$DB" -c "insert into public.avisos (usuario_id, tipo, numero_contrato) select '00000000-0000-0000-0000-000000281101','soporte_pago_nuevo','DTM-8201' from generate_series(1,6)" >/dev/null
PEND7="$($PS -d "$DB" -c "select count(*) from public.avisos where usuario_id='00000000-0000-0000-0000-000000281101' and notificado_en is null and leido_en is null")"
sesion c7a 0 "$(tx "select id from public.avisos_reclamar('00000000-0000-0000-0000-000000281101', 50);" 2)"
sesion c7b 0.8 "$(tx "select id from public.avisos_reclamar('00000000-0000-0000-0000-000000281101', 50);" 0)"; wait
TOTAL7="$(cat "$SALIDAS"/c7a.out "$SALIDAS"/c7b.out | grep -cE '^[0-9]+$')"
UNICOS7="$(cat "$SALIDAS"/c7a.out "$SALIDAS"/c7b.out | grep -E '^[0-9]+$' | sort -u | wc -l | tr -d ' ')"
veredicto "C7 reclamo concurrente: cada aviso sale UNA sola vez" "$UNICOS7" "$TOTAL7"
veredicto "C7 reclamo concurrente: entre las dos pestañas salen TODOS los pendientes" "$PEND7" "$UNICOS7"
veredicto "C7 reclamar no marcó leído" "0" "$($PS -d "$DB" -c "select count(*) from public.avisos where usuario_id='00000000-0000-0000-0000-000000281101' and leido_en is not null")"

TOT=$(( FALLAS_CARRERA + FALLAS_SQL ))
echo "== Resumen: $FALLAS_SQL falla(s) SQL, $FALLAS_CARRERA falla(s) de carreras =="
[ "$TOT" = 0 ] || exit 1
