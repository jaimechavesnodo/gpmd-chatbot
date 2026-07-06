-- ============================================================
-- GPMD v2.5 — Segunda vía de auto-aprobación por VALOR (líneas
-- Mobil Delvac Modern ≥ mínimo), a pedido de Jaime (jul/2026)
-- ============================================================

ALTER TABLE gpmd_facturas DROP CONSTRAINT IF EXISTS gpmd_facturas_estado_check;
ALTER TABLE gpmd_facturas ADD CONSTRAINT gpmd_facturas_estado_check
  CHECK (estado IN ('pendiente','aprobada_auto','en_revision','aprobada_manual','aprobada_valor','rechazada'));
