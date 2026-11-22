#!/usr/bin/env bash
# Usage (Git Bash, from anywhere):  MSYS_NO_PATHCONV=1 bash supabase/scripts/release_rel2/rel2_plantillas.sh   (needs the Docker container pgb2b, the template plantillab2b = schema 001-311 and plantilla_int = 001-324)
# REL-2 · prepara DOS plantillas desechables en pgb2b (nunca toca la base del dueño ni sus archivos):
#   plantilla_rel2_viejo = esquema de PRODUCCIÓN actual (001–311) = copia de plantillab2b (esquema del árbol viejo 312608a59, sin 312+)
#   plantilla_rel2_final = plantilla_int (001–324, con la 315) + 325 + 326 (archivos finales), con preflight → migración → postcheck de cada etapa que se aplica
# Comprueba: (1) la VIEJA no tiene ningún objeto de 312+ ; (2) la FINAL pasa los 13 postchecks 312–326 ; (3) comparación de objetos viejo → final: solo se AGREGA o se reemplaza (nada desaparece).
set -u
export MSYS_NO_PATHCONV=1
NEW="$(cd "$(dirname "$0")/../../.." && pwd)"   # dspacios-travel/ of the FINAL tree (this worktree)
PS=(docker exec -i -e PGPASSWORD=postgres pgb2b psql -h 127.0.0.1 -U supabase_admin -X -q -t -A -F'|' -v ON_ERROR_STOP=1)
sqlx() { "${PS[@]}" -d "$1" "${@:2}"; }
crear() { # plantilla origen
  sqlx postgres -c "select pg_terminate_backend(pid) from pg_stat_activity where datname in ('$1','$2') and pid <> pg_backend_pid()" >/dev/null
  sqlx postgres -c "drop database if exists $1 with (force)" 2>/dev/null; sqlx postgres -c "create database $1 template $2" || exit 2
}
revisa() { # etiqueta base archivo → muestra filas y falla con REVISAR/FALLO
  local out; out="$(sqlx "$2" < "$3" 2>&1)" || { echo "FALLO SQL $1:"; echo "$out" | head -5; return 1; }
  local n bad; n=$(grep -cE '\|[A-Za-z_]+$' <<<"$out"); bad=$(grep -E '\|[A-Za-z_]+$' <<<"$out" | grep -vE '\|(OK|INFO)$')
  if [ -n "$bad" ] || [ "$n" = 0 ]; then echo "FALLO $1: $n filas; estados distintos de OK/INFO (o ninguna fila):"; echo "$bad" | cut -c1-200; return 1; fi
  echo "OK    $1: $n filas OK/INFO"
}
echo "== plantilla_rel2_viejo (esquema de PRODUCCIÓN 001–311, de plantillab2b)"
crear plantilla_rel2_viejo plantillab2b
echo -n "viejo tiene algún objeto de 312+ (columna moneda_pago, disparador 315, función 313, tablas 316/318/319/322/323/324/325): "
sqlx plantilla_rel2_viejo -c "select exists(select 1 from information_schema.columns where table_name='abonos' and column_name='moneda_pago') or exists(select 1 from pg_trigger where tgname='tarifario_trg_hotel_blackouts_ins') or (to_regproc('public.registrar_abono_moneda') is not null) or (to_regclass('public.recuperaciones_consumidas') is not null) or (to_regclass('public.aliado_firmas') is not null) or (to_regclass('public.aliado_logos') is not null) or (to_regclass('public.aliado_clientes') is not null) or (to_regclass('public.cotizacion_solicitudes_contrato') is not null) or (to_regclass('public.registro_b2b_estado') is not null) or (to_regclass('public.cotizacion_evidencias') is not null) or (to_regclass('public.cotizacion_pasajeros_aliado') is not null)"
echo -n "viejo tiene la 307–311 (contrato_minimo_acuerdo, fn_gestion_contratos 309, promocion_guardar_reglas de 8 args 310, sin defaults de edad 311): "
sqlx plantilla_rel2_viejo -c "select (to_regclass('public.contrato_minimo_acuerdo') is not null) and (to_regproc('public.fn_gestion_contratos') is not null) and exists(select 1 from pg_proc where proname='promocion_guardar_reglas' and pronargs=8) and (select count(*)=0 from information_schema.columns where table_name='hoteles' and column_name in ('edad_infante_max','edad_nino_max') and column_default is not null)"
echo; echo "== plantilla_rel2_final (cadena final 001–326)"
crear plantilla_rel2_final plantilla_int
for n in 325 326; do
  pre="$(ls "$NEW/supabase/scripts" | grep -E "^preflight_${n}_" | head -1)"; post="$(ls "$NEW/supabase/scripts" | grep -E "^postcheck_${n}_" | head -1)"; mg="$(ls "$NEW/supabase/migrations" | grep -E "^2026060100$(printf %04d $n)_" | head -1)"
  revisa "$n preflight" plantilla_rel2_final "$NEW/supabase/scripts/$pre" || exit 1
  sqlx plantilla_rel2_final -1 < "$NEW/supabase/migrations/$mg" >/dev/null && echo "OK    $n migración aplicada ($mg)" || { echo "FALLO al aplicar $n"; exit 1; }
  revisa "$n postcheck" plantilla_rel2_final "$NEW/supabase/scripts/$post" || exit 1
done
echo; echo "== postchecks 312–326 (solo lectura) sobre la FINAL: la cadena completa debe estar instalada"
mal=0; for n in 312 313 314 315 316 317 318 319 322 323 324 325 326; do post="$(ls "$NEW/supabase/scripts" | grep -E "^postcheck_${n}_" | head -1)"; revisa "postcheck $n" plantilla_rel2_final "$NEW/supabase/scripts/$post" || mal=1; done
echo; echo "== control negativo: los postchecks 312, 315 y 324 sobre la VIEJA NO deben pasar"
for n in 312 315 324; do post="$(ls "$NEW/supabase/scripts" | grep -E "^postcheck_${n}_" | head -1)"; out="$(sqlx plantilla_rel2_viejo < "$NEW/supabase/scripts/$post" 2>&1 || true)"; echo "postcheck $n sobre la vieja: $(grep -cE '\|(REVISAR|FALLO|FALLA)$|^ERROR' <<<"$out") fila(s)/error(es) de fallo (esperado > 0)"; done
echo; echo "== objetos del esquema public: viejo → final (nada debe desaparecer)"
LISTA="select 'T:'||c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','v','m','p') union all select 'F:'||p.proname||'/'||p.pronargs from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' union all select 'C:'||c.relname||'.'||a.attname from pg_class c join pg_namespace n on n.oid=c.relnamespace join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped where n.nspname='public' and c.relkind in ('r','p') union all select 'G:'||t.tgname from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal order by 1"
sqlx plantilla_rel2_viejo -c "$LISTA" | sort > /tmp/rel2_viejo_objs.txt; sqlx plantilla_rel2_final -c "$LISTA" | sort > /tmp/rel2_final_objs.txt
echo "objetos viejo=$(wc -l < /tmp/rel2_viejo_objs.txt) final=$(wc -l < /tmp/rel2_final_objs.txt)"
echo "DESAPARECEN en la final (esperado 0): $(comm -23 /tmp/rel2_viejo_objs.txt /tmp/rel2_final_objs.txt | wc -l)"; comm -23 /tmp/rel2_viejo_objs.txt /tmp/rel2_final_objs.txt | head -20
echo "NUEVOS en la final: $(comm -13 /tmp/rel2_viejo_objs.txt /tmp/rel2_final_objs.txt | wc -l)"; comm -13 /tmp/rel2_viejo_objs.txt /tmp/rel2_final_objs.txt | grep -E "^(T|C|G):" | tr '\n' ' ' | fold -w 200
echo
[ "$mal" = 0 ] && echo "CADENA FINAL COMPLETA VERIFICADA" || { echo "ALGÚN POSTCHECK FALLÓ"; exit 1; }
