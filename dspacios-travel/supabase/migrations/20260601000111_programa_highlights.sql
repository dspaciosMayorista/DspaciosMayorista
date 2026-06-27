-- ───────────────────────────────────────────────────────────────────────────
-- 111 · PROGRAMAS — highlights (atractivos) para el documento comercial
--
--  Lista de "highlights" del programa (Canal de Panamá, Comunidad Emberá,
--  Portobelo, Agua Clara, Casco Antiguo, Biomuseo…) que se muestran como chips
--  en la portada del PDF comercial. Las "Observaciones internas" reutilizan la
--  columna `notas` ya existente (que NUNCA sale en el documento público).
-- ───────────────────────────────────────────────────────────────────────────

alter table public.programas
  add column if not exists highlights text[] not null default '{}';
