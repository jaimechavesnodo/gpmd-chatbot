-- ============================================================
-- GPMD v2.4 — Quitar datos de copiloto y correo electrónico del
-- registro (ya no se solicitan en el chatbot ni se editan en el panel)
-- ============================================================

ALTER TABLE gpmd_participants DROP COLUMN IF EXISTS nombre_copiloto;
ALTER TABLE gpmd_participants DROP COLUMN IF EXISTS tipo_documento_copiloto;
ALTER TABLE gpmd_participants DROP COLUMN IF EXISTS numero_documento_copiloto;
ALTER TABLE gpmd_participants DROP COLUMN IF EXISTS rh_copiloto;
ALTER TABLE gpmd_participants DROP COLUMN IF EXISTS email;
