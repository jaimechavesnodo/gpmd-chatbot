const supabase = require('../lib/supabase');

async function logActivity({ entidad, entidadId, accion, detalle, usuarioId, fuente = 'manual' }) {
  await supabase.from('gpmd_log').insert({
    entidad,
    entidad_id: String(entidadId),
    accion,
    detalle,
    usuario_id: usuarioId || null,
    fuente,
  });
}

module.exports = { logActivity };
