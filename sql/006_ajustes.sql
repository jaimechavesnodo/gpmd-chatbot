-- ============================================================
-- GPMD v2.2 — Ajustes post-reunión:
--  · origen del participante (chatbot | manual)
--  · phone nullable (los cupos manuales no tienen teléfono)
--  · nuevo rol 'consulta' (solo lectura: preregistrados + buscar)
-- ============================================================

ALTER TABLE gpmd_participants ADD COLUMN IF NOT EXISTS origen VARCHAR(10) DEFAULT 'chatbot';

-- Los cupos manuales se crean sin teléfono (UNIQUE permite múltiples NULL)
ALTER TABLE gpmd_participants ALTER COLUMN phone DROP NOT NULL;

-- Rol de solo consulta
ALTER TABLE gpmd_usuarios DROP CONSTRAINT IF EXISTS gpmd_usuarios_rol_check;
ALTER TABLE gpmd_usuarios ADD CONSTRAINT gpmd_usuarios_rol_check
  CHECK (rol IN ('admin','cliente','agente','consulta'));
