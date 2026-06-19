-- ============================================================
-- GPMD 2026 — Estado conversacional del chatbot WhatsApp
-- El backend orquesta la conversación; aquí guarda en qué paso
-- va cada número y las respuestas parciales antes de crear el participante.
-- ============================================================

CREATE TABLE IF NOT EXISTS gpmd_conversaciones (
  phone        VARCHAR(20) PRIMARY KEY,
  step         VARCHAR(40) NOT NULL DEFAULT 'inicio',
  data         JSONB DEFAULT '{}'::jsonb,   -- respuestas parciales del registro
  slots_cache  JSONB,                       -- opciones de slot mostradas (numero → fecha/franja)
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE OR REPLACE TRIGGER trg_conversaciones_updated_at
  BEFORE UPDATE ON gpmd_conversaciones
  FOR EACH ROW EXECUTE FUNCTION gpmd_set_updated_at();
