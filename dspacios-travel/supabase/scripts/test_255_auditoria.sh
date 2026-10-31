#!/bin/sh
# ────────────────────────────────────────────────────────
# PRUEBA de auditoria_255_servicios_sin_vigencia.sql en un Postgres LOCAL desechable (nunca la base compartida).
# Siembra casos en una COPIA (base `aud255`, se borra al final), corre la auditoría dentro de `begin read only` y compara el estado de cada servicio.
# Uso (desde dspacios-travel/):  sh supabase/scripts/test_255_auditoria.sh <contenedor> [plantilla] [script_viejo.sql]
#   plantilla     base con el esquema hasta la 254 (por defecto plantilla255; ver preparar_esquema_local.sh).
#   script_viejo  opcional: versión anterior de la auditoría; si se da, se muestra qué casos antes daban OK de forma falsa.
# ────────────────────────────────────────────────────────
set -u
CT="${1:-}"; PLANT="${2:-plantilla255}"; VIEJO="${3:-}"
export MSYS_NO_PATHCONV=1
printf '%s' "$CT" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$' || { echo "Uso: test_255_auditoria.sh <contenedor> [plantilla] [script_viejo]" >&2; exit 2; }
printf '%s' "$PLANT" | grep -Eq '^[a-z0-9_]+$' || { echo "plantilla inválida" >&2; exit 2; }
AQUI="$(cd "$(dirname "$0")" && pwd)"; AUD="$AQUI/auditoria_255_servicios_sin_vigencia.sql"
DB=aud255
SU() { docker exec -i -e PGPASSWORD=postgres "$CT" psql -h 127.0.0.1 -U supabase_admin -X -q -v ON_ERROR_STOP=1 "$@"; }
P() { SU -d "$DB" "$@"; }
FALLAS=0
fallo() { echo "  >> FALLA: $1"; FALLAS=$((FALLAS+1)); }

SU -d template1 -c "drop database if exists $DB" -c "create database $DB template $PLANT" || { echo "no se pudo clonar $PLANT"; exit 3; }

echo "══ 0. el script es solo lectura (sin DML/DDL fuera de comentarios)"
if grep -v '^\s*--' "$AUD" | grep -Eiq '\b(insert|update|delete|truncate|create|drop|alter|grant|revoke)\b'; then fallo "hay sentencias de escritura"; else echo "  OK: solo SELECT"; fi
[ "$(grep -v '^\s*--' "$AUD" | grep -c 'now()')" = "1" ] && echo "  OK: una sola fuente de «hoy» (Bogotá)" || fallo "now() aparece más de una vez"
grep -v '^\s*--' "$AUD" | grep -Eiq 'current_date' && fallo "usa current_date (reloj del servidor, no Bogotá)"

echo "══ 1. siembra de casos (fechas relativas a HOY de Bogotá)"
P <<'SQL'
set session_replication_role = replica;  -- fixture: sin validaciones de vínculo aéreo (solo en la base desechable)
do $$
declare h date := (now() at time zone 'America/Bogota')::date;
        pq_v bigint; pq_pas bigint; pq_sv bigint; pq_fin bigint; pq_inv bigint; pq_blq bigint; pq_din bigint; pq_din0 bigint; pq_srv bigint; bq bigint; pq_73 bigint; pq_33 bigint; pq_tr0 bigint; pq_trp bigint; pq_av bigint; pq_asb bigint;
        sid bigint;
begin
  insert into public.armado_paquetes (nombre, tipo, activo, fecha_viaje_inicio, fecha_viaje_fin) values ('PQ_V','porcion_terrestre', true, h+10, h+19) returning id into pq_v;
  insert into public.armado_paquetes (nombre, tipo, activo, fecha_viaje_inicio, fecha_viaje_fin) values ('PQ_PAS','porcion_terrestre', true, h-5, h+4) returning id into pq_pas;
  insert into public.armado_paquetes (nombre, tipo, activo) values ('PQ_SV','porcion_terrestre', true) returning id into pq_sv;
  insert into public.armado_paquetes (nombre, tipo, activo, fecha_viaje_inicio, fecha_viaje_fin) values ('PQ_FIN','porcion_terrestre', true, h-20, h-10) returning id into pq_fin;
  insert into public.armado_paquetes (nombre, tipo, activo, fecha_viaje_inicio, fecha_viaje_fin) values ('PQ_INV','porcion_terrestre', true, h+5, h+1) returning id into pq_inv;

  -- paquetes por tipo (los incluidos se evalúan por SALIDA, no por toda la ventana)
  insert into public.armado_paquetes (nombre, tipo, activo, fecha_viaje_inicio, fecha_viaje_fin) values ('PQ_BLQ','bloqueo', true, h+10, h+19) returning id into pq_blq;
  insert into public.bloqueos_vuelo (record) values ('REC255') returning id into bq;
  update public.bloqueos_vuelo set fecha_ida = h+10, fecha_regreso = h+13 where id = bq;
  insert into public.armado_vuelos (paquete_id, bloqueo_id) values (pq_blq, bq);
  insert into public.armado_paquetes (nombre, tipo, activo) values ('PQ_DIN','dinamico', true) returning id into pq_din;
  insert into public.salidas_dinamicas (paquete_id, fecha_ida, fecha_regreso, activo) values (pq_din, h+10, h+13, true), (pq_din, h+40, h+43, true);
  insert into public.armado_paquetes (nombre, tipo, activo) values ('PQ_DIN0','dinamico', true) returning id into pq_din0;
  insert into public.armado_paquetes (nombre, tipo, activo) values ('PQ_SRV','servicios', true) returning id into pq_srv;

  -- ── PQ_V: ventana h+10 .. h+19 ────────────────────────────────────────────
  -- persona
  insert into public.servicios_adicionales (nombre) values ('S_ok_persona') returning id into sid;
  insert into public.armado_servicios (paquete_id, servicio_id, modo, incluido) values (pq_v, sid, 'persona', false);
  insert into public.servicio_temporadas (servicio_id, nombre, fecha_inicio, fecha_fin, precio_persona) values (sid,'V1',h,h+60,100);

  insert into public.servicios_adicionales (nombre) values ('S_precio_cero') returning id into sid;
  insert into public.armado_servicios (paquete_id, servicio_id, modo, incluido) values (pq_v, sid, 'persona', false);
  insert into public.servicio_temporadas (servicio_id, nombre, fecha_inicio, fecha_fin, precio_persona) values (sid,'V1',h,h+60,0);

  insert into public.servicios_adicionales (nombre) values ('S_hueco_medio') returning id into sid;
  insert into public.armado_servicios (paquete_id, servicio_id, modo, incluido) values (pq_v, sid, 'persona', false);
  insert into public.servicio_temporadas (servicio_id, nombre, fecha_inicio, fecha_fin, precio_persona) values (sid,'A',h,h+13,100),(sid,'B',h+17,h+60,100);

  insert into public.servicios_adicionales (nombre) values ('S_termina_antes') returning id into sid;
  insert into public.armado_servicios (paquete_id, servicio_id, modo, incluido) values (pq_v, sid, 'persona', false);
  insert into public.servicio_temporadas (servicio_id, nombre, fecha_inicio, fecha_fin, precio_persona) values (sid,'A',h,h+15,100);

  insert into public.servicios_adicionales (nombre) values ('S_empieza_despues') returning id into sid;
  insert into public.armado_servicios (paquete_id, servicio_id, modo, incluido) values (pq_v, sid, 'persona', false);
  insert into public.servicio_temporadas (servicio_id, nombre, fecha_inicio, fecha_fin, precio_persona) values (sid,'A',h+15,h+60,100);

  insert into public.servicios_adicionales (nombre) values ('S_futura_fuera') returning id into sid;
  insert into public.armado_servicios (paquete_id, servicio_id, modo, incluido) values (pq_v, sid, 'persona', false);
  insert into public.servicio_temporadas (servicio_id, nombre, fecha_inicio, fecha_fin, precio_persona) values (sid,'A',h+30,h+60,100);

  insert into public.servicios_adicionales (nombre) values ('S_una_sin_precio') returning id into sid;
  insert into public.armado_servicios (paquete_id, servicio_id, modo, incluido) values (pq_v, sid, 'persona', false);
  insert into public.servicio_temporadas (servicio_id, nombre, fecha_inicio, fecha_fin, precio_persona) values (sid,'A',h,h+14,100),(sid,'B',h+15,h+60,null);

  insert into public.servicios_adicionales (nombre) values ('S_vencida_mas_vigente') returning id into sid;
  insert into public.armado_servicios (paquete_id, servicio_id, modo, incluido) values (pq_v, sid, 'persona', false);
  insert into public.servicio_temporadas (servicio_id, nombre, fecha_inicio, fecha_fin, precio_persona) values (sid,'OLD',h-100,h-50,null),(sid,'V1',h,h+60,100);

  -- grupo
  insert into public.servicios_adicionales (nombre) values ('S_grupo_ok') returning id into sid;
  insert into public.armado_servicios (paquete_id, servicio_id, modo, incluido) values (pq_v, sid, 'grupo', false);
  insert into public.servicio_temporadas (servicio_id, nombre, fecha_inicio, fecha_fin) values (sid,'V1',h,h+60);
  insert into public.servicio_tarifa_pax (servicio_id, pax_desde, pax_hasta, precio, temporada) values (sid,1,2,100,'V1'),(sid,3,5,80,'V1');

  insert into public.servicios_adicionales (nombre, precio_persona) values ('S_grupo_solo_general_rangos', null) returning id into sid;
  insert into public.armado_servicios (paquete_id, servicio_id, modo, incluido) values (pq_v, sid, 'grupo', false);
  insert into public.servicio_temporadas (servicio_id, nombre, fecha_inicio, fecha_fin) values (sid,'V1',h,h+60);
  insert into public.servicio_tarifa_pax (servicio_id, pax_desde, pax_hasta, precio, temporada) values (sid,1,5,100,'GENERAL');

  insert into public.servicios_adicionales (nombre) values ('S_grupo_rangos_distintos') returning id into sid;
  insert into public.armado_servicios (paquete_id, servicio_id, modo, incluido) values (pq_v, sid, 'grupo', false);
  insert into public.servicio_temporadas (servicio_id, nombre, fecha_inicio, fecha_fin) values (sid,'A',h,h+14),(sid,'B',h+15,h+60);
  insert into public.servicio_tarifa_pax (servicio_id, pax_desde, pax_hasta, precio, temporada) values (sid,1,2,100,'A'),(sid,3,5,80,'A'),(sid,1,3,100,'B'),(sid,4,6,80,'B');

  insert into public.servicios_adicionales (nombre) values ('S_grupo_hueco_vencida') returning id into sid;
  insert into public.armado_servicios (paquete_id, servicio_id, modo, incluido) values (pq_v, sid, 'grupo', false);
  insert into public.servicio_temporadas (servicio_id, nombre, fecha_inicio, fecha_fin) values (sid,'V1',h,h+60),(sid,'OLD',h-100,h-50);
  insert into public.servicio_tarifa_pax (servicio_id, pax_desde, pax_hasta, precio, temporada) values (sid,1,5,100,'V1'),(sid,1,2,100,'OLD'),(sid,4,5,80,'OLD');

  insert into public.servicios_adicionales (nombre) values ('S_grupo_hueco_vigente') returning id into sid;
  insert into public.armado_servicios (paquete_id, servicio_id, modo, incluido) values (pq_v, sid, 'grupo', false);
  insert into public.servicio_temporadas (servicio_id, nombre, fecha_inicio, fecha_fin) values (sid,'V1',h,h+60);
  insert into public.servicio_tarifa_pax (servicio_id, pax_desde, pax_hasta, precio, temporada) values (sid,1,2,100,'V1'),(sid,4,5,80,'V1');

  insert into public.servicios_adicionales (nombre) values ('S_grupo_una_sin_rangos') returning id into sid;
  insert into public.armado_servicios (paquete_id, servicio_id, modo, incluido) values (pq_v, sid, 'grupo', false);
  insert into public.servicio_temporadas (servicio_id, nombre, fecha_inicio, fecha_fin) values (sid,'A',h,h+14),(sid,'B',h+15,h+60);
  insert into public.servicio_tarifa_pax (servicio_id, pax_desde, pax_hasta, precio, temporada) values (sid,1,5,100,'A');

  -- sin vigencias utilizables
  insert into public.servicios_adicionales (nombre) values ('S_vencidas') returning id into sid;
  insert into public.armado_servicios (paquete_id, servicio_id, modo, incluido) values (pq_v, sid, 'persona', false);
  insert into public.servicio_temporadas (servicio_id, nombre, fecha_inicio, fecha_fin, precio_persona) values (sid,'OLD',h-100,h-50,100);

  insert into public.servicios_adicionales (nombre, precio_persona) values ('S_solo_general', 100) returning id into sid;
  insert into public.armado_servicios (paquete_id, servicio_id, modo, incluido) values (pq_v, sid, 'persona', false);

  insert into public.servicios_adicionales (nombre) values ('S_nada') returning id into sid;
  insert into public.armado_servicios (paquete_id, servicio_id, modo, incluido) values (pq_v, sid, 'persona', false);

  insert into public.servicios_adicionales (nombre, precio_persona) values ('S_sin_fechas', 100) returning id into sid;
  insert into public.armado_servicios (paquete_id, servicio_id, modo, incluido) values (pq_v, sid, 'persona', false);
  insert into public.servicio_temporadas (servicio_id, nombre, fecha_inicio, fecha_fin, precio_persona) values (sid,'SF',null,null,100);

  -- incluido con dos vigencias aplicables: OK pero con nota
  insert into public.servicios_adicionales (nombre) values ('S_incluido_2vig') returning id into sid;
  insert into public.armado_servicios (paquete_id, servicio_id, modo, incluido) values (pq_v, sid, 'persona', true);
  insert into public.servicio_temporadas (servicio_id, nombre, fecha_inicio, fecha_fin, precio_persona) values (sid,'A',h,h+14,100),(sid,'B',h+15,h+60,100);

  -- ── INCLUIDOS por salida (bloqueo: ida h+10; dinámico: idas h+10 y h+40) ────────────────────────────
  insert into public.servicios_adicionales (nombre) values ('S_inc_blq_cubre_salida') returning id into sid;   -- cubre la ida (h+10) pero NO toda la ventana (h+10..h+19)
  insert into public.armado_servicios (paquete_id, servicio_id, modo, incluido) values (pq_blq, sid, 'persona', true);
  insert into public.servicio_temporadas (servicio_id, nombre, fecha_inicio, fecha_fin, precio_persona) values (sid,'A',h,h+12,100);

  insert into public.servicios_adicionales (nombre) values ('S_inc_blq_no_cubre_salida') returning id into sid;
  insert into public.armado_servicios (paquete_id, servicio_id, modo, incluido) values (pq_blq, sid, 'persona', true);
  insert into public.servicio_temporadas (servicio_id, nombre, fecha_inicio, fecha_fin, precio_persona) values (sid,'A',h,h+5,100);

  insert into public.servicios_adicionales (nombre) values ('S_opc_blq_ventana_completa') returning id into sid;  -- el MISMO vigencia, pero OPCIONAL: sí exige toda la ventana
  insert into public.armado_servicios (paquete_id, servicio_id, modo, incluido) values (pq_blq, sid, 'persona', false);
  insert into public.servicio_temporadas (servicio_id, nombre, fecha_inicio, fecha_fin, precio_persona) values (sid,'A',h,h+12,100);

  insert into public.servicios_adicionales (nombre) values ('S_inc_din_segunda_salida') returning id into sid;    -- cubre la 1ª salida, no la 2ª (h+40)
  insert into public.armado_servicios (paquete_id, servicio_id, modo, incluido) values (pq_din, sid, 'persona', true);
  insert into public.servicio_temporadas (servicio_id, nombre, fecha_inicio, fecha_fin, precio_persona) values (sid,'A',h,h+20,100);

  insert into public.servicios_adicionales (nombre) values ('S_inc_din_ok') returning id into sid;
  insert into public.armado_servicios (paquete_id, servicio_id, modo, incluido) values (pq_din, sid, 'persona', true);
  insert into public.servicio_temporadas (servicio_id, nombre, fecha_inicio, fecha_fin, precio_persona) values (sid,'A',h,h+60,100);

  insert into public.servicios_adicionales (nombre) values ('S_inc_din_sin_salidas') returning id into sid;
  insert into public.armado_servicios (paquete_id, servicio_id, modo, incluido) values (pq_din0, sid, 'persona', true);
  insert into public.servicio_temporadas (servicio_id, nombre, fecha_inicio, fecha_fin, precio_persona) values (sid,'A',h,h+60,100);

  insert into public.servicios_adicionales (nombre) values ('S_inc_tipo_servicios') returning id into sid;       -- tipo servicios: no se hornea, no se evalúa cobertura
  insert into public.armado_servicios (paquete_id, servicio_id, modo, incluido) values (pq_srv, sid, 'persona', true);
  insert into public.servicio_temporadas (servicio_id, nombre, fecha_inicio, fecha_fin, precio_persona) values (sid,'A',h,h+5,100);

  insert into public.servicios_adicionales (nombre, precio_persona) values ('S_inc_solo_general', 100) returning id into sid;   -- incluido con solo GENERAL
  insert into public.armado_servicios (paquete_id, servicio_id, modo, incluido) values (pq_blq, sid, 'persona', true);

  -- ── Banderas REALES de la auditoría compartida ──────────────────────────────────────────────────────
  -- PQ_73: 112 INCLUIDO (vigencia válida corta + TEMP invertida) + asistencia 1 OPCIONAL (solo GENERAL); 3 salidas cubiertas + 16 sin cobertura (19) → OFERTA_CON_SERVICIOS_OMITIDOS
  insert into public.armado_paquetes (nombre, tipo, activo) values ('PQ_73','dinamico', true) returning id into pq_73;
  insert into public.salidas_dinamicas (paquete_id, fecha_ida, fecha_regreso, activo)
    select pq_73, h + 10 + i, h + 13 + i, true from generate_series(0, 2) i;
  insert into public.salidas_dinamicas (paquete_id, fecha_ida, fecha_regreso, activo)
    select pq_73, h + 60 + i * 2, h + 63 + i * 2, true from generate_series(0, 15) i;
  insert into public.servicios_adicionales (nombre, precio_persona) values ('S73_112_incluido', 87000) returning id into sid;
  insert into public.armado_servicios (paquete_id, servicio_id, modo, incluido) values (pq_73, sid, 'persona', true);
  insert into public.servicio_temporadas (servicio_id, nombre, fecha_inicio, fecha_fin, precio_persona) values (sid,'TEMP. 2026',h,h+40,87000),(sid,'TEMP. 2027',h+100,h+99,100000);
  insert into public.servicios_adicionales (nombre, categoria, precio_persona) values ('S73_asistencia1_opcional', 'asistencia', 100) returning id into sid;
  insert into public.armado_servicios (paquete_id, servicio_id, modo, incluido) values (pq_73, sid, 'persona', false);
  -- PQ_33: 50 INCLUIDO (cubre 4 de 16 salidas) + asistencia 1 INCLUIDA (categoría asistencia, SIN vigencias, base 100 = tarifa permanente) → OFERTA_CON_SERVICIOS_OMITIDOS: depende solo de las fechas del 50
  insert into public.armado_paquetes (nombre, tipo, activo) values ('PQ_33','dinamico', true) returning id into pq_33;
  insert into public.salidas_dinamicas (paquete_id, fecha_ida, fecha_regreso, activo)
    select pq_33, h + 10 + i, h + 13 + i, true from generate_series(0, 3) i;
  insert into public.salidas_dinamicas (paquete_id, fecha_ida, fecha_regreso, activo)
    select pq_33, h + 75 + i, h + 78 + i, true from generate_series(0, 11) i;
  insert into public.servicios_adicionales (nombre) values ('S33_50_incluido') returning id into sid;
  insert into public.armado_servicios (paquete_id, servicio_id, modo, incluido) values (pq_33, sid, 'persona', true);
  insert into public.servicio_temporadas (servicio_id, nombre, fecha_inicio, fecha_fin, precio_persona) values (sid,'TEMP',h,h+60,50000);
  insert into public.servicios_adicionales (nombre, categoria, precio_persona) values ('S33_asistencia1_incluida', 'asistencia', 100) returning id into sid;
  insert into public.armado_servicios (paquete_id, servicio_id, modo, incluido) values (pq_33, sid, 'persona', true);

  -- PQ_TRASLADO_SIN_VIG: traslado INCLUIDO (no asistencia) sin vigencias aunque tenga base + asistencia permanente → OFERTA_SIN_SERVICIOS (depende del traslado)
  insert into public.armado_paquetes (nombre, tipo, activo) values ('PQ_TRASLADO_SIN_VIG','dinamico', true) returning id into pq_tr0;
  insert into public.salidas_dinamicas (paquete_id, fecha_ida, fecha_regreso, activo) select pq_tr0, h + 10 + i, h + 13 + i, true from generate_series(0, 15) i;  -- forma del 36/133: 0 de 16 con cobertura
  insert into public.servicios_adicionales (nombre, categoria, precio_persona) values ('S_traslado_sin_vig', 'tour_traslado', 100) returning id into sid;
  insert into public.armado_servicios (paquete_id, servicio_id, modo, incluido) values (pq_tr0, sid, 'persona', true);
  insert into public.servicios_adicionales (nombre, categoria, precio_persona) values ('S_asist_perm_en_traslado', 'asistencia', 50) returning id into sid;
  insert into public.armado_servicios (paquete_id, servicio_id, modo, incluido) values (pq_tr0, sid, 'persona', true);
  -- PQ_TRASLADO_PARCIAL: traslado INCLUIDO con vigencia que cubre 1 de 2 salidas + asistencia permanente → OFERTA_CON_SERVICIOS_OMITIDOS
  insert into public.armado_paquetes (nombre, tipo, activo) values ('PQ_TRASLADO_PARCIAL','dinamico', true) returning id into pq_trp;
  insert into public.salidas_dinamicas (paquete_id, fecha_ida, fecha_regreso, activo) values (pq_trp, h+10, h+13, true), (pq_trp, h+40, h+43, true);
  insert into public.servicios_adicionales (nombre, categoria) values ('S_traslado_parcial', 'tour_traslado') returning id into sid;
  insert into public.armado_servicios (paquete_id, servicio_id, modo, incluido) values (pq_trp, sid, 'persona', true);
  insert into public.servicio_temporadas (servicio_id, nombre, fecha_inicio, fecha_fin, precio_persona) values (sid,'A',h,h+20,100);
  insert into public.servicios_adicionales (nombre, categoria, precio_persona) values ('S_asist_perm_en_parcial', 'asistencia', 50) returning id into sid;
  insert into public.armado_servicios (paquete_id, servicio_id, modo, incluido) values (pq_trp, sid, 'persona', true);
  -- PQ_ASIST_VIG: asistencia INCLUIDA CON vigencia (cubre 1 de 2 salidas): respeta su vigencia, la base NO rellena el hueco → OFERTA_CON_SERVICIOS_OMITIDOS
  insert into public.armado_paquetes (nombre, tipo, activo) values ('PQ_ASIST_VIG','dinamico', true) returning id into pq_av;
  insert into public.salidas_dinamicas (paquete_id, fecha_ida, fecha_regreso, activo) values (pq_av, h+10, h+13, true), (pq_av, h+40, h+43, true);
  insert into public.servicios_adicionales (nombre, categoria, precio_persona) values ('S_asist_con_vig_hueco', 'asistencia', 50) returning id into sid;
  insert into public.armado_servicios (paquete_id, servicio_id, modo, incluido) values (pq_av, sid, 'persona', true);
  insert into public.servicio_temporadas (servicio_id, nombre, fecha_inicio, fecha_fin, precio_persona) values (sid,'A',h,h+20,50);
  -- PQ_ASIST_SINBASE: asistencia INCLUIDA sin vigencias y SIN tarifa base → OFERTA_SIN_SERVICIOS
  insert into public.armado_paquetes (nombre, tipo, activo) values ('PQ_ASIST_SINBASE','dinamico', true) returning id into pq_asb;
  insert into public.salidas_dinamicas (paquete_id, fecha_ida, fecha_regreso, activo) values (pq_asb, h+10, h+13, true);
  insert into public.servicios_adicionales (nombre, categoria) values ('S_asist_sin_base', 'asistencia') returning id into sid;
  insert into public.armado_servicios (paquete_id, servicio_id, modo, incluido) values (pq_asb, sid, 'persona', true);
  -- asistencia con vigencia INVERTIDA: la base tampoco aplica (tiene vigencias)
  insert into public.servicios_adicionales (nombre, categoria, precio_persona) values ('S_asist_vig_invertida', 'asistencia', 50) returning id into sid;
  insert into public.armado_servicios (paquete_id, servicio_id, modo, incluido) values (pq_asb, sid, 'persona', false);
  insert into public.servicio_temporadas (servicio_id, nombre, fecha_inicio, fecha_fin, precio_persona) values (sid,'INV',h+100,h+99,50);

  -- servicio COMPARTIDO por tres paquetes: hueco en dos de ellos (ventana h+10..h+19) y OK en el tercero (sin ventana)
  insert into public.servicios_adicionales (nombre) values ('S_compartido') returning id into sid;
  insert into public.armado_servicios (paquete_id, servicio_id, modo, incluido) values (pq_v, sid, 'persona', false), (pq_blq, sid, 'persona', false), (pq_sv, sid, 'persona', false);
  insert into public.servicio_temporadas (servicio_id, nombre, fecha_inicio, fecha_fin, precio_persona) values (sid,'A',h,h+14,100);
  -- opcional con problema que YA tiene filas publicadas
  insert into public.tarifario_resultado (paquete_id, modulo, servicio_id) select pq_v, 'servicios', id from public.servicios_adicionales where nombre = 'S_hueco_medio';

  -- ── PQ_PAS: ventana h-5 .. h+4; la vigencia empieza HOY ─────────────────────
  insert into public.servicios_adicionales (nombre) values ('S_pas_empieza_hoy') returning id into sid;
  insert into public.armado_servicios (paquete_id, servicio_id, modo, incluido) values (pq_pas, sid, 'persona', false);
  insert into public.servicio_temporadas (servicio_id, nombre, fecha_inicio, fecha_fin, precio_persona) values (sid,'A',h,h+60,100);

  -- ── PQ_SV: sin rango de viaje (vigencias no vencidas) ──────────────────────
  insert into public.servicios_adicionales (nombre) values ('S_sv_hueco_irrelevante') returning id into sid;
  insert into public.armado_servicios (paquete_id, servicio_id, modo, incluido) values (pq_sv, sid, 'persona', false);
  insert into public.servicio_temporadas (servicio_id, nombre, fecha_inicio, fecha_fin, precio_persona) values (sid,'A',h,h+10,100),(sid,'B',h+20,h+60,100);

  insert into public.servicios_adicionales (nombre) values ('S_sv_incompleta') returning id into sid;
  insert into public.armado_servicios (paquete_id, servicio_id, modo, incluido) values (pq_sv, sid, 'persona', false);
  insert into public.servicio_temporadas (servicio_id, nombre, fecha_inicio, fecha_fin, precio_persona) values (sid,'A',h,h+10,100),(sid,'B',h+20,h+60,null);

  insert into public.servicios_adicionales (nombre) values ('S_sv_vencida') returning id into sid;
  insert into public.armado_servicios (paquete_id, servicio_id, modo, incluido) values (pq_sv, sid, 'persona', false);
  insert into public.servicio_temporadas (servicio_id, nombre, fecha_inicio, fecha_fin, precio_persona) values (sid,'OLD',h-100,h-1,100);

  -- borde de Bogotá: vigencia que termina HOY (Bogotá) sigue vigente
  insert into public.servicios_adicionales (nombre) values ('S_borde_termina_hoy') returning id into sid;
  insert into public.armado_servicios (paquete_id, servicio_id, modo, incluido) values (pq_sv, sid, 'persona', false);
  insert into public.servicio_temporadas (servicio_id, nombre, fecha_inicio, fecha_fin, precio_persona) values (sid,'A',h-30,h,100);

  -- ── PQ_FIN / PQ_INV ───────────────────────────────────────────────────────
  insert into public.servicios_adicionales (nombre) values ('S_fin_pasado') returning id into sid;
  insert into public.armado_servicios (paquete_id, servicio_id, modo, incluido) values (pq_fin, sid, 'persona', false);
  insert into public.servicio_temporadas (servicio_id, nombre, fecha_inicio, fecha_fin, precio_persona) values (sid,'A',h-100,h-1,100);

  insert into public.servicios_adicionales (nombre) values ('S_ventana_invalida') returning id into sid;
  insert into public.armado_servicios (paquete_id, servicio_id, modo, incluido) values (pq_inv, sid, 'persona', false);
  insert into public.servicio_temporadas (servicio_id, nombre, fecha_inicio, fecha_fin, precio_persona) values (sid,'A',h,h+60,100);
end $$;
SQL
[ $? -eq 0 ] && echo "  sembrado" || { fallo "no se pudo sembrar"; exit 4; }

# servicio | estado esperado NUEVO | estado que daba el script VIEJO (solo informativo; "-" = no se compara)
cat > /tmp/esperado_aud255.txt <<'TXT'
S_ok_persona|OK|OK
S_precio_cero|OK|VIGENCIA_SIN_PRECIO
S_hueco_medio|OPCIONAL_PARCIAL|OK
S_termina_antes|OPCIONAL_PARCIAL|OK
S_empieza_despues|OPCIONAL_PARCIAL|OK
S_futura_fuera|OPCIONAL_OCULTO|OK
S_una_sin_precio|VIGENCIA_SIN_PRECIO|OK
S_vencida_mas_vigente|OK|OK
S_grupo_ok|OK|OK
S_grupo_solo_general_rangos|VIGENCIA_SIN_RANGOS|VIGENCIA_SIN_RANGOS
S_grupo_rangos_distintos|RANGOS_DISTINTOS|OK
S_grupo_hueco_vencida|OK|OK_CON_HUECOS_PAX
S_grupo_hueco_vigente|OK_CON_HUECOS_PAX|OK_CON_HUECOS_PAX
S_grupo_una_sin_rangos|VIGENCIA_SIN_RANGOS|OK
S_vencidas|VIGENCIAS_VENCIDAS|VIGENCIAS_VENCIDAS
S_solo_general|SOLO_GENERAL|SOLO_GENERAL
S_nada|SIN_NINGUNA_TARIFA|SIN_NINGUNA_TARIFA
S_sin_fechas|SOLO_GENERAL|VIGENCIAS_VENCIDAS
S_incluido_2vig|INCLUIDO_VARIAS_VIGENCIAS|OK
S_inc_blq_cubre_salida|OK|FECHAS_SIN_COBERTURA
S_inc_blq_no_cubre_salida|INCLUIDO_OMITIDO_EN_TODAS|OK
S_opc_blq_ventana_completa|OPCIONAL_PARCIAL|OK
S_inc_din_segunda_salida|INCLUIDO_OMITIDO_EN_SALIDAS|OK
S_inc_din_ok|OK|OK
S_inc_din_sin_salidas|SIN_SALIDAS_FUTURAS|OK
S_inc_tipo_servicios|OK|OK
S_inc_solo_general|SOLO_GENERAL|SOLO_GENERAL
S_pas_empieza_hoy|OPCIONAL_PARCIAL|OK
S_sv_hueco_irrelevante|OK|OK
S_sv_incompleta|VIGENCIA_SIN_PRECIO|OK
S_sv_vencida|VIGENCIAS_VENCIDAS|VIGENCIAS_VENCIDAS
S_borde_termina_hoy|OK|OK
S_fin_pasado|VIAJE_PASADO|VIGENCIAS_VENCIDAS
S_ventana_invalida|VENTANA_INVALIDA|OK
S73_asistencia1_opcional|OK_TARIFA_PERMANENTE|SOLO_GENERAL
S33_asistencia1_incluida|OK_TARIFA_PERMANENTE|SOLO_GENERAL
S_traslado_sin_vig|SOLO_GENERAL|SOLO_GENERAL
S_asist_perm_en_traslado|OK_TARIFA_PERMANENTE|SOLO_GENERAL
S_traslado_parcial|INCLUIDO_OMITIDO_EN_SALIDAS|OK
S_asist_perm_en_parcial|OK_TARIFA_PERMANENTE|SOLO_GENERAL
S_asist_con_vig_hueco|INCLUIDO_OMITIDO_EN_SALIDAS|OK
S_asist_sin_base|SIN_NINGUNA_TARIFA|SIN_NINGUNA_TARIFA
S_asist_vig_invertida|SOLO_GENERAL|SOLO_GENERAL
TXT

envolver() { { echo "begin read only;"; cat "$1"; echo; echo "rollback;"; } > "$2"; }

echo "══ 2. auditoría NUEVA dentro de «begin read only» → estado por servicio"
envolver "$AUD" /tmp/aud_new_ro.sql
docker exec -i -e PGPASSWORD=postgres "$CT" psql -h 127.0.0.1 -U supabase_admin -d "$DB" -X -v ON_ERROR_STOP=1 -t -A -F '|' < /tmp/aud_new_ro.sql > /tmp/aud_new_out.txt 2>&1 \
  || { fallo "la auditoría falló en transacción de solo lectura"; head -c 600 /tmp/aud_new_out.txt; }
# posiciones de columna: 5=servicio 9=hoy_negocio 16=dias_futuros 17=dias_pasados 18=primer_dia; estado=antepenúltima, nota=penúltima, efecto=última
resumen() { # lee salida de la auditoría y emite servicio|estado|futuros|pasados|primer_dia|nota|efecto
  grep -E '^[0-9]+\|' "$1" | awk -F'|' '{ print $5 "|" $(NF-2) "|" $16 "|" $17 "|" $18 "|" $(NF-1) "|" $NF }'; }
resumen /tmp/aud_new_out.txt > /tmp/aud_new_res.txt
cat /tmp/aud_new_res.txt | cut -d'|' -f1-5 | column -t -s'|' | head -40

echo "══ 3. estado esperado por caso"
while IFS='|' read -r srv esp_nuevo esp_viejo; do
  obs=$(grep "^$srv|" /tmp/aud_new_res.txt | cut -d'|' -f2)
  if [ "$obs" = "$esp_nuevo" ]; then echo "  OK   $srv = $obs"; else fallo "$srv: esperado $esp_nuevo, observado '${obs:-<sin fila>}'"; fi
done < /tmp/esperado_aud255.txt

echo "══ 4. detalles de cobertura"
chk() { l=$(grep "^$1|" /tmp/aud_new_res.txt); [ "$(echo "$l" | cut -d'|' -f"$2")" = "$3" ] && echo "  OK   $1 $4" || fallo "$1: $4 (fila: $l)"; }
chk S_hueco_medio 3 3 "3 días futuros sin cobertura"
chk S_termina_antes 3 4 "4 días futuros sin cobertura"
chk S_empieza_despues 3 5 "5 días futuros sin cobertura"
chk S_futura_fuera 3 10 "10 días futuros sin cobertura"
chk S_pas_empieza_hoy 4 5 "5 días PASADOS sin cobertura"
chk S_pas_empieza_hoy 3 0 "0 días futuros"
grep "^S_pas_empieza_hoy|" /tmp/aud_new_res.txt | grep -q "solo PASADOS" && echo "  OK   S_pas_empieza_hoy nota «solo PASADOS»" || fallo "falta la nota de días solo pasados"
efecto() { l=$(grep "^$1|" /tmp/aud_new_res.txt); echo "$l" | cut -d'|' -f7 | grep -q "$2" && echo "  OK   $1 efecto: $2" || fallo "$1: efecto sin «$2» (fila: $l)"; }
efecto S_hueco_medio "se ofrece SOLO en"
efecto S_futura_fuera "no se ofrece (oculto)"
efecto S_inc_din_segunda_salida "OMITIDO en 1 de 2 salida(s)"
efecto S_inc_blq_no_cubre_salida "OMITIDO en todas"
efecto S_inc_solo_general "OMITIDO en todas"
efecto S_solo_general "no se ofrece (oculto)"
efecto S_inc_blq_cubre_salida "INCLUIDO Y COBRADO"
efecto S_ok_persona "se ofrece completo"
chk S_inc_blq_no_cubre_salida 3 1 "1 salida sin cobertura (la ida h+10)"
chk S_inc_din_segunda_salida 3 1 "solo la 2ª salida (h+40) queda sin cobertura"
grep "^S_inc_blq_cubre_salida|" /tmp/aud_new_res.txt | grep -q "fecha de ida de cada salida" && echo "  OK   S_inc_blq_cubre_salida nota por salida" || fallo "falta la nota de evaluación por salida"

if [ -n "$VIEJO" ] && [ -f "$VIEJO" ]; then
  echo "══ 5. contraste con la versión VIEJA (falsos OK que ahora se detectan)"
  envolver "$VIEJO" /tmp/aud_old_ro.sql
  docker exec -i -e PGPASSWORD=postgres "$CT" psql -h 127.0.0.1 -U supabase_admin -d "$DB" -X -v ON_ERROR_STOP=1 -t -A -F '|' < /tmp/aud_old_ro.sql > /tmp/aud_old_out.txt 2>&1 || echo "  (la versión vieja falló)"
  grep -E '^[0-9]+\|' /tmp/aud_old_out.txt | awk -F'|' '{ print $4 "|" $(NF-1) }' > /tmp/aud_old_res.txt
  FALSOS=0
  while IFS='|' read -r srv esp_nuevo esp_viejo; do
    vie=$(grep "^$srv|" /tmp/aud_old_res.txt | cut -d'|' -f2)
    nue=$(grep "^$srv|" /tmp/aud_new_res.txt | cut -d'|' -f2)
    if [ "$vie" = "OK" ] && [ "$nue" != "OK" ]; then echo "  falso OK evitado: $srv  (viejo OK → nuevo $nue)"; FALSOS=$((FALSOS+1)); fi
    [ "$vie" = "$esp_viejo" ] || echo "  (nota: la versión vieja dio '$vie' para $srv, se esperaba '$esp_viejo')"
  done < /tmp/esperado_aud255.txt
  [ "$FALSOS" -ge 5 ] && echo "  OK: $FALSOS falsos OK detectados ahora" || fallo "solo $FALSOS falsos OK detectados (esperados ≥ 5)"
fi

echo "══ 6. fecha de NEGOCIO de Bogotá (reloj simulado: 03:00 UTC del día siguiente = 22:00 del día anterior en Bogotá)"
H=$(docker exec -i -e PGPASSWORD=postgres "$CT" psql -h 127.0.0.1 -U supabase_admin -d "$DB" -X -t -A -c "select (now() at time zone 'America/Bogota')::date")
T=$(docker exec -i -e PGPASSWORD=postgres "$CT" psql -h 127.0.0.1 -U supabase_admin -d "$DB" -X -t -A -c "select ('$H'::date + 1)::text || ' 03:00:00+00'")
sed "s/now()/'$T'::timestamptz/g" "$AUD" > /tmp/aud_sim.sql
envolver /tmp/aud_sim.sql /tmp/aud_sim_ro.sql
docker exec -i -e PGPASSWORD=postgres "$CT" psql -h 127.0.0.1 -U supabase_admin -d "$DB" -X -v ON_ERROR_STOP=1 -t -A -F '|' < /tmp/aud_sim_ro.sql > /tmp/aud_sim_out.txt 2>&1
HOYSIM=$(grep -E '^[0-9]+\|' /tmp/aud_sim_out.txt | head -1 | awk -F'|' '{print $9}')
[ "$HOYSIM" = "$H" ] && echo "  OK   instante $T → hoy_negocio = $H (el día UTC sería $(docker exec -i -e PGPASSWORD=postgres "$CT" psql -h 127.0.0.1 -U supabase_admin -d "$DB" -X -t -A -c "select ('$T'::timestamptz at time zone 'UTC')::date"))" || fallo "hoy_negocio=$HOYSIM, esperado $H (Bogotá)"
ESTADO=$(grep "|S_borde_termina_hoy|" /tmp/aud_sim_out.txt | awk -F'|' '{print $(NF-2)}')
[ "$ESTADO" = "OK" ] && echo "  OK   vigencia que termina HOY (Bogotá) sigue vigente aunque en UTC ya sea mañana" || fallo "S_borde_termina_hoy = $ESTADO (con reloj UTC saldría VIGENCIAS_VENCIDAS)"

PLAN="$AQUI/plan_saneamiento_255_lectura.sql"
if [ -f "$PLAN" ]; then
  echo "══ 7. plan de saneamiento (solo lectura) sobre los mismos casos"
  grep -v '^\s*--' "$PLAN" | grep -Eiq '\b(insert|update|delete|truncate|create|drop|alter|grant|revoke)\b' && fallo "el plan contiene escritura"
  envolver "$PLAN" /tmp/plan_ro.sql
  docker exec -i -e PGPASSWORD=postgres "$CT" psql -h 127.0.0.1 -U supabase_admin -d "$DB" -X -v ON_ERROR_STOP=1 -t -A -F '|' < /tmp/plan_ro.sql > /tmp/plan_out.txt 2>&1 \
    || { fallo "el plan falló en transacción de solo lectura"; head -c 600 /tmp/plan_out.txt; }
  for v in A_servicio B_paquete C_incluido D_opcional_publicado E_paquete_oferta; do
    n=$(grep -c "^$v|" /tmp/plan_out.txt); [ "$n" -gt 0 ] && echo "  OK   vista $v: $n fila(s)" || fallo "la vista $v no devolvió filas"
  done
  # columnas: 1 vista 2 paquete_id 3 paquete 4 tipo 5 servicio_id 6 servicio 7 estados 8 ventana 9 vigencias 10 primer_hueco 11 dias 12 publicadas 13 afectados 14 detalle
  L=$(grep "^A_servicio|" /tmp/plan_out.txt | awk -F'|' '$6=="S_compartido"')
  [ "$(echo "$L" | cut -d'|' -f13)" = "2" ] && echo "  OK   S_compartido: 2 vínculos con problema agrupados en UNA fila" || fallo "S_compartido: afectados != 2 ($L)"
  echo "$L" | grep -q "hoy OK que también usan el servicio: [0-9]" && echo "  OK   S_compartido: lista el paquete que hoy está OK y también se vería afectado" || fallo "S_compartido: no lista paquetes hoy OK"
  echo "$L" | cut -d'|' -f9 | grep -q "A \[" && echo "  OK   muestra las vigencias cargadas tal cual" || fallo "no muestra vigencias existentes"
  grep "^C_incluido|" /tmp/plan_out.txt | awk -F'|' '{print $6}' | grep -q "S_inc_blq_no_cubre_salida" && echo "  OK   C_incluido lista los incluidos con problema" || fallo "C_incluido no lista S_inc_blq_no_cubre_salida"
  grep "^C_incluido|" /tmp/plan_out.txt | awk -F'|' '{print $6}' | grep -q "S_inc_blq_cubre_salida" && fallo "C_incluido lista un incluido que está OK"
  grep "^D_opcional_publicado|" /tmp/plan_out.txt | awk -F'|' '$6=="S_hueco_medio" && $12=="1"' | grep -q . && echo "  OK   D_opcional_publicado: S_hueco_medio con 1 fila publicada" || fallo "D no muestra el opcional publicado"
  grep "^D_opcional_publicado|" /tmp/plan_out.txt | awk -F'|' '{print $6}' | grep -q "S_inc_" && fallo "D mezcla incluidos"
  grep "^B_paquete|" /tmp/plan_out.txt | awk -F'|' '$3=="PQ_BLQ"' | grep -q "incluido(s)" && echo "  OK   B_paquete resume incluidos y opcionales por paquete" || fallo "B_paquete sin resumen"
  # E_paquete_oferta: columna 7 = estado de la oferta del paquete
  oferta() { e=$(grep "^E_paquete_oferta|" /tmp/plan_out.txt | awk -F'|' -v n="$1" '$3==n {print $7}'); [ "$e" = "$2" ] && echo "  OK   E_paquete_oferta $1 = $e" || fallo "E_paquete_oferta $1: esperado $2, observado '${e:-<sin fila>}'"; }
  oferta PQ_BLQ OFERTA_SIN_SERVICIOS            # su única salida tiene un incluido sin vigencia
  oferta PQ_DIN OFERTA_CON_SERVICIOS_OMITIDOS        # 1 de 2 salidas vendible (la 2ª no tiene cubierto S_inc_din_segunda_salida)
  oferta PQ_DIN0 SIN_SALIDAS
  oferta PQ_73 OFERTA_CON_SERVICIOS_OMITIDOS         # banderas reales: 112 incluido, asistencia 1 OPCIONAL sin vigencia → 3 de 19 vendibles
  oferta PQ_33 OFERTA_CON_SERVICIOS_OMITIDOS         # asistencia 1 incluida permanente: 33 depende solo del servicio 50 → 4 de 16
  oferta PQ_TRASLADO_SIN_VIG OFERTA_SIN_SERVICIOS      # depende del traslado incluido sin vigencias
  oferta PQ_TRASLADO_PARCIAL OFERTA_CON_SERVICIOS_OMITIDOS  # traslado cubre 1 de 2 salidas; la asistencia permanente no bloquea
  oferta PQ_ASIST_VIG OFERTA_CON_SERVICIOS_OMITIDOS         # asistencia CON vigencia: la base no rellena el hueco
  oferta PQ_ASIST_SINBASE OFERTA_SIN_SERVICIOS         # asistencia sin vigencias y sin base: bloquea
  grep "^E_paquete_oferta|" /tmp/plan_out.txt | awk -F'|' '$3=="PQ_73"' | grep -q "3 de 19 salida(s) con TODOS sus incluidos cobrados" && echo "  OK   PQ_73: 3 de 19 salida(s) con TODOS sus incluidos cobrados" || fallo "PQ_73: conteo de salidas vendibles"
  grep "^E_paquete_oferta|" /tmp/plan_out.txt | awk -F'|' '$3=="PQ_33"' | grep -q "4 de 16 salida(s) con TODOS sus incluidos cobrados" && echo "  OK   PQ_33: 4 de 16 salida(s) con TODOS sus incluidos cobrados" || fallo "PQ_33: conteo de salidas vendibles"
  grep "^E_paquete_oferta|" /tmp/plan_out.txt | awk -F"|" '$3=="PQ_TRASLADO_SIN_VIG"' | grep -q "0 de 16 salida(s) con TODOS sus incluidos cobrados" && echo "  OK   PQ_TRASLADO_SIN_VIG: 0 de 16" || fallo "PQ_TRASLADO_SIN_VIG: 0 de 16"
  oferta PQ_SRV OFERTA_COMPLETA       # tipo servicios: el incluido no se hornea
  grep "^E_paquete_oferta|" /tmp/plan_out.txt | awk -F'|' '$3=="PQ_DIN"' | grep -q "1 de 2 salida(s) con TODOS sus incluidos cobrados" && echo "  OK   E_paquete_oferta PQ_DIN: 1 de 2 salida(s) con TODOS sus incluidos cobrados" || fallo "E_paquete_oferta PQ_DIN: conteo de salidas vendibles"
fi

SU -d template1 -c "drop database if exists $DB"
printf '\n══ RESULTADO: '; [ "$FALLAS" -eq 0 ] && echo "AUDITORÍA OK" || echo "$FALLAS FALLA(S)"
exit "$FALLAS"
