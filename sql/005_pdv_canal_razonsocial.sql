-- ============================================================
-- GPMD v2.1 — PDV: columnas Canal y Razón Social (informativas, no editables)
-- Se asocian al NIT/Cliente y se copian a cada factura aprobada.
-- ============================================================

ALTER TABLE gpmd_pdv
  ADD COLUMN IF NOT EXISTS canal        VARCHAR(120),
  ADD COLUMN IF NOT EXISTS razon_social VARCHAR(200);

ALTER TABLE gpmd_facturas
  ADD COLUMN IF NOT EXISTS canal        VARCHAR(120),
  ADD COLUMN IF NOT EXISTS razon_social VARCHAR(200);
