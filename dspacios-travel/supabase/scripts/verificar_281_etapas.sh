#!/bin/sh
# 281 · Ensaya LOCALMENTE las tres etapas que el dueño ejecutará en remoto: preflight → migración → postcheck → rollback → preflight.
# SOLO Docker local desechable (base creada aquí desde la plantilla y borrada al final).
# Uso (desde dspacios-travel/): sh supabase/scripts/verificar_281_etapas.sh <base_nueva ^t281e_...> [contenedor] [plantilla]
set -eu
DB="${1:-}"; CT="${2:-pg86soportes}"; PLANTILLA="${3:-plantilla86}"
export MSYS_NO_PATHCONV=1
printf '%s' "$DB" | grep -Eq '^t281e_[a-z0-9_]{1,40}$' || { echo "Base inválida: ^t281e_[a-z0-9_]{1,40}\$." >&2; exit 2; }
AQUI="$(cd "$(dirname "$0")" && pwd)"; APP="$(cd "$AQUI/../.." && pwd)"
PS="docker exec -i -e PGPASSWORD=postgres $CT psql -h 127.0.0.1 -U supabase_admin -X -q -t -A -F ' | ' -v ON_ERROR_STOP=1"
[ "$($PS -d postgres -c "select count(*) from pg_database where datname = '$DB'")" = 0 ] || { echo "La base $DB ya existe." >&2; exit 3; }
$PS -d postgres -c "create database $DB template $PLANTILLA" >/dev/null
trap '$PS -d postgres -c "drop database if exists $DB" >/dev/null 2>&1 || true' EXIT
$PS -d "$DB" -c "alter table storage.buckets add column if not exists file_size_limit bigint, add column if not exists allowed_mime_types text[]" >/dev/null
FN="select md5(replace(prosrc, chr(13), '')) || ' / ' || coalesce(proacl::text, '<defecto>') || ' / ' || proowner::regrole::text || ' / ' || prosecdef || ' / ' || coalesce(proconfig::text, '') from pg_proc where oid = 'public.fn_renumerar_contrato(text,text)'::regprocedure"
ORIGINAL="$($PS -d "$DB" -c "$FN")"
echo "== PREFLIGHT (antes) =="; $PS -d "$DB" -f - < "$AQUI/preflight_281_soportes.sql"
echo "== MIGRACIÓN 281 =="; $PS -1 -d "$DB" -f - < "$APP/supabase/migrations/20260601000281_soportes_pago.sql" && echo "aplicada"
echo "== POSTCHECK =="; $PS -d "$DB" -f - < "$AQUI/postcheck_281_soportes.sql"
echo "== ROLLBACK =="; $PS -d "$DB" -f - < "$AQUI/rollback_281_soportes.sql" && echo "revertida"
echo "== PREFLIGHT (después del rollback: debe volver a ser aplicable) =="; $PS -d "$DB" -f - < "$AQUI/preflight_281_soportes.sql" | tail -2
echo "== fn_renumerar_contrato restaurada EXACTAMENTE a la original (cuerpo, permisos, propietario, SECURITY DEFINER, search_path) =="
[ "$($PS -d "$DB" -c "$FN")" = "$ORIGINAL" ] && echo "OK  idéntica" || { echo "FALLA  distinta de la original"; exit 1; }

# El rollback debe NEGARSE, sin tocar nada, si la función o sus permisos cambiaron después de la 281 (no se sobrescribe en silencio).
nega() { # descripcion patron
  if salida="$($PS -d "$DB" -f - < "$AQUI/rollback_281_soportes.sql" 2>&1)"; then echo "FALLA  $1: el rollback NO se negó"; exit 1; fi
  printf '%s' "$salida" | grep -q "$2" && echo "OK  $1: el rollback se negó ($2)" || { echo "FALLA  $1: se negó por otra razón: $salida"; exit 1; }
}
echo "== ROLLBACK debe NEGARSE si algo cambió después de la 281 =="
$PS -1 -d "$DB" -f - < "$APP/supabase/migrations/20260601000281_soportes_pago.sql" && echo "281 reaplicada"
$PS -d "$DB" -c "revoke execute on function public.fn_renumerar_contrato(text, text) from anon"
nega "permisos cambiados después" "permisos o el propietario"
$PS -d "$DB" -c "grant execute on function public.fn_renumerar_contrato(text, text) to anon"
$PS -d "$DB" -c "do \$x\$ begin execute (select replace(pg_get_functiondef('public.fn_renumerar_contrato(text,text)'::regprocedure), 'No autorizado para renumerar contratos.', 'No autorizado para renumerar contratos!')); end \$x\$"
nega "cuerpo cambiado después" "ya no es la versión que dejó la 281"
echo "== y SE NIEGA si hay evidencia registrada =="
$PS -d "$DB" -c "do \$x\$ begin execute (select replace(pg_get_functiondef('public.fn_renumerar_contrato(text,text)'::regprocedure), 'No autorizado para renumerar contratos!', 'No autorizado para renumerar contratos.')); end \$x\$"
$PS -d "$DB" -c "insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000281199','e@t.test') on conflict do nothing; insert into public.usuarios (id, email, nombre, rol, activo, tenant) values ('00000000-0000-0000-0000-000000281199','e@t.test','E','agencia',true,'mayorista') on conflict (id) do update set activo = true; insert into public.ventas (numero_contrato, cliente, tenant, destino, fecha_salida, estado, precio_venta, moneda, asesor) values ('DTM-8199','C','mayorista','X',current_date,'confirmado',1,'COP','z'); insert into public.abonos (numero_contrato, valor_abono, forma_pago, tenant) values ('DTM-8199', 1, 'T', 'mayorista'); set role service_role; select public.soporte_registrar('DTM-8199','00000000-0000-0000-0000-000000281199','DTM-8199/a.pdf','a.pdf','application/pdf',1,repeat('a',64))" >/dev/null
nega "evidencia registrada" "hay soportes registrados"

# Una definición remota DISTINTA de la esperada debe BLOQUEAR: el preflight dice NO APLICAR y la propia migración se niega (sin crear nada).
DB2="${DB}_d"
$PS -d postgres -c "create database $DB2 template $PLANTILLA" >/dev/null
$PS -d "$DB2" -c "alter table storage.buckets add column if not exists file_size_limit bigint, add column if not exists allowed_mime_types text[]" >/dev/null
$PS -d "$DB2" -c "do \$x\$ begin execute (select replace(pg_get_functiondef('public.fn_renumerar_contrato(text,text)'::regprocedure), 'No autorizado para renumerar contratos.', 'No autorizado para renumerar.')); end \$x\$"
echo "== Definición remota DISTINTA: el preflight debe bloquear =="
$PS -d "$DB2" -f - < "$AQUI/preflight_281_soportes.sql" | grep -E "^14'|VEREDICTO"
$PS -d "$DB2" -f - < "$AQUI/preflight_281_soportes.sql" | grep -q "NO APLICAR" && echo "OK  preflight: NO APLICAR" || { echo "FALLA  el preflight no bloqueó"; $PS -d postgres -c "drop database $DB2" >/dev/null; exit 1; }
if salida="$($PS -1 -d "$DB2" -f - < "$APP/supabase/migrations/20260601000281_soportes_pago.sql" 2>&1)"; then echo "FALLA  la migración se aplicó sobre una definición distinta"; $PS -d postgres -c "drop database $DB2" >/dev/null; exit 1; fi
printf '%s' "$salida" | grep -q "NO es la esperada" && echo "OK  la migración se negó: definición no esperada" || echo "FALLA  se negó por otra razón: $salida"
[ "$($PS -d "$DB2" -c "select count(*) from pg_tables where schemaname = 'public' and tablename in ('contrato_soportes_pago', 'avisos', 'f281_respaldo_funciones')")" = 0 ] && echo "OK  no se creó nada" || echo "FALLA  quedaron objetos"
$PS -d postgres -c "drop database $DB2" >/dev/null
