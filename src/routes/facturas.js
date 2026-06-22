const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { requireAuth } = require('../middleware/auth');
const { logActivity } = require('../middleware/logger');
const wati = require('../lib/wati');

const LIMITE_CONFIRMADOS = () => parseInt(process.env.LIMITE_CONFIRMADOS) || 150;

const RAZONES_LABEL = {
  foto_ilegible: 'la foto o factura no es legible',
  fuera_periodo: 'la factura está fuera de las fechas de participación',
  producto_no_participante: 'el producto o la presentación no participan',
  establecimiento_no_participante: 'el establecimiento no participa',
  factura_duplicada: 'la factura ya fue registrada anteriormente',
  valor_insuficiente: 'el valor no cumple el mínimo requerido',
  otro: null,
};

async function cupoLleno() {
  const { count } = await supabase.from('gpmd_participants')
    .select('*', { count: 'exact', head: true }).eq('estado', 'confirmado');
  return (count || 0) >= LIMITE_CONFIRMADOS();
}

// GET /api/facturas/pendientes — cola de revisión manual
router.get('/pendientes', requireAuth(['admin', 'agente']), async (req, res) => {
  const { data, error } = await supabase
    .from('gpmd_facturas')
    .select(`
      id, imagen_url, estado, created_at, nit, cliente, agente, departamento, ciudad_pdv,
      ocr_establecimiento, ocr_fecha_compra, ocr_referencia_producto, producto_catalogo,
      ocr_presentacion, ocr_cantidad, ocr_valor_total, ocr_confianza, match_confianza, ocr_motivo_revision,
      participant:participant_id ( id, nombre_piloto, cedula, phone, codigo_preregistro )
    `)
    .eq('estado', 'en_revision')
    .order('created_at');
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// GET /api/facturas/:id — detalle completo
router.get('/:id', requireAuth(['admin', 'agente']), async (req, res) => {
  const { data, error } = await supabase
    .from('gpmd_facturas').select(`*, participant:participant_id (*)`).eq('id', req.params.id).single();
  if (error) return res.status(404).json({ error: 'Factura no encontrada' });
  res.json(data);
});

// PATCH /api/facturas/:id/aprobar — aprobación manual (requiere elegir el PDV/cliente)
router.patch('/:id/aprobar', requireAuth(['admin', 'agente']), async (req, res) => {
  const { pdv_id, referencia_producto, presentacion, cantidad, valor_total, fecha_compra } = req.body;
  if (!pdv_id) return res.status(400).json({ error: 'Selecciona el Cliente (PDV) que corresponde al NIT' });

  const { data: pdv } = await supabase.from('gpmd_pdv').select('*').eq('id', pdv_id).single();
  if (!pdv) return res.status(400).json({ error: 'PDV no válido' });

  const { data, error } = await supabase.from('gpmd_facturas').update({
    estado: 'aprobada_manual',
    cliente: pdv.cliente, agente: pdv.agente, departamento: pdv.departamento, ciudad_pdv: pdv.ciudad,
    establecimiento: pdv.cliente, nit: pdv.nit,
    referencia_producto: referencia_producto || null, presentacion: presentacion || null,
    cantidad: cantidad || null, valor_total: valor_total || null, fecha_compra: fecha_compra || null,
    revisado_por: req.user.id, revisado_at: new Date().toISOString(),
  }).eq('id', req.params.id).select('*, participant:participant_id (id, phone, nombre_piloto, codigo_preregistro)').single();

  if (error) return res.status(500).json({ error: error.message });

  const lleno = await cupoLleno();
  const nuevoEstado = lleno ? 'lista_espera' : 'confirmado';
  await supabase.from('gpmd_participants').update({ estado: nuevoEstado, updated_at: new Date().toISOString() }).eq('id', data.participant_id);

  await logActivity({ entidad: 'facturas', entidadId: req.params.id, accion: 'manual_aprobado', detalle: { cliente: pdv.cliente, cupo: nuevoEstado }, usuarioId: req.user.id });
  await notificarConfirmado(data.participant, nuevoEstado).catch((e) => console.error('[GPMD] notif:', e.message));

  res.json({ ok: true, estado: nuevoEstado, data });
});

// PATCH /api/facturas/:id/rechazar — rechazo manual
router.patch('/:id/rechazar', requireAuth(['admin', 'agente']), async (req, res) => {
  const { razon_rechazo, razon_rechazo_detalle } = req.body;
  if (!razon_rechazo) return res.status(400).json({ error: 'razon_rechazo requerido' });

  const { data, error } = await supabase.from('gpmd_facturas').update({
    estado: 'rechazada', razon_rechazo, razon_rechazo_detalle: razon_rechazo_detalle || null,
    revisado_por: req.user.id, revisado_at: new Date().toISOString(),
  }).eq('id', req.params.id).select('*, participant:participant_id (id, phone, nombre_piloto)').single();

  if (error) return res.status(500).json({ error: error.message });

  await supabase.from('gpmd_participants').update({ estado: 'rechazado', updated_at: new Date().toISOString() }).eq('id', data.participant_id);
  await logActivity({ entidad: 'facturas', entidadId: req.params.id, accion: 'manual_rechazado', detalle: { razon_rechazo }, usuarioId: req.user.id });
  await notificarRechazado(data.participant, razon_rechazo, razon_rechazo_detalle).catch((e) => console.error('[GPMD] notif:', e.message));

  res.json({ ok: true, data });
});

async function notificarConfirmado(part, estado) {
  if (!part?.phone) return;
  const nombre = (part.nombre_piloto || '').split(' ')[0] || 'piloto';
  if (estado === 'confirmado') {
    await wati.updateContactAttributes(part.phone, [{ name: 'confirmado', value: 'true' }]).catch(() => {});
    await wati.sendSessionMessage(part.phone,
      `✅ *¡Tu cupo quedó confirmado, ${nombre}!*\n\nTu factura fue verificada para el *Gran Premio Mobil Delvac 2026*.\n\n🏁 Código: *${part.codigo_preregistro}*\n\n¡Nos vemos en la pista! 🚛💨`);
  } else {
    await wati.sendSessionMessage(part.phone,
      `✅ ¡Hola ${nombre}! Tu factura fue verificada, pero los cupos ya se completaron, así que quedas en *lista de espera*. Te avisaremos si se habilita un cupo. 🙏`);
  }
}

async function notificarRechazado(part, razon, detalle) {
  if (!part?.phone) return;
  const nombre = (part.nombre_piloto || '').split(' ')[0] || 'piloto';
  const label = RAZONES_LABEL[razon] || detalle || 'no cumple las condiciones de participación';
  await wati.sendSessionMessage(part.phone,
    `❌ *Hola ${nombre},*\n\nTuvimos un problema con tu factura: *${label}*.\n\nSi tienes dudas o deseas intentar de nuevo, responde este mensaje y un asesor te ayudará.`);
}

module.exports = router;
