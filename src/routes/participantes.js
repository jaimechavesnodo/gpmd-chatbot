const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { requireAuth } = require('../middleware/auth');
const { logActivity } = require('../middleware/logger');
const { genCodigo } = require('../lib/codigo');

const TIPO_DOC = ['Cédula', 'Pasaporte', 'Otro'];
const RH = ['O+', 'O-', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-'];

// Normaliza una fila (manual o de Excel) a un participante 'confirmado' sin factura.
function filaAParticipante(b) {
  const nombre = (b.nombre_piloto || b.nombre || '').toString().trim();
  const cedula = (b.cedula || b.numero_documento || b.documento || '').toString().replace(/\s/g, '');
  if (!nombre || !cedula) return { error: 'Nombre y documento son obligatorios' };

  const novatoRaw = (b.novato == null ? '' : String(b.novato)).trim().toLowerCase();
  const novato = ['si', 'sí', 'true', '1', 'novato'].includes(novatoRaw) ? true
    : ['no', 'false', '0', 'no novato'].includes(novatoRaw) ? false : null;
  const tipoDoc = TIPO_DOC.find((t) => t.toLowerCase() === String(b.tipo_documento_piloto || b.tipo_documento || '').trim().toLowerCase()) || null;
  const rh = RH.find((r) => r === String(b.rh || '').trim().toUpperCase()) || null;

  return {
    row: {
      nombre_piloto: nombre, cedula, tipo_documento_piloto: tipoDoc, novato, rh,
      vehiculo_marca: (b.vehiculo || b.vehiculo_marca || '').toString().trim() || null,
      vehiculo_placa: (b.placa || b.vehiculo_placa || '').toString().replace(/\s/g, '').toUpperCase() || null,
      codigo_preregistro: genCodigo(), estado: 'confirmado', origen: 'manual',
    },
  };
}

const SELECT = `
  id, nombre_piloto, cedula, tipo_documento_piloto, novato, rh, phone,
  vehiculo_marca, vehiculo_placa, codigo_preregistro, estado, created_at, updated_at,
  facturas:gpmd_facturas ( id, estado, cliente, nit, referencia_producto, presentacion, valor_total, ocr_confianza, imagen_url, created_at )
`;

function ultimaFactura(p) {
  const fs = (p.facturas || []).slice().sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return fs[0] || null;
}

// GET /api/participantes?estado=  — lista de preregistrados
router.get('/', requireAuth(['admin', 'cliente', 'agente', 'consulta']), async (req, res) => {
  let q = supabase.from('gpmd_participants').select(SELECT).order('created_at', { ascending: false });
  if (req.query.estado) q = q.eq('estado', req.query.estado);
  const { data, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  const lista = (data || []).map((p) => ({ ...p, factura: ultimaFactura(p), facturas: undefined }));
  const { count: confirmados } = await supabase.from('gpmd_participants')
    .select('*', { count: 'exact', head: true }).eq('estado', 'confirmado');
  res.json({ participantes: lista, confirmados: confirmados || 0, limite: parseInt(process.env.LIMITE_CONFIRMADOS) || 150 });
});

// GET /api/participantes/:id
router.get('/:id', requireAuth(['admin', 'cliente', 'agente', 'consulta']), async (req, res) => {
  const { data, error } = await supabase.from('gpmd_participants').select(SELECT).eq('id', req.params.id).single();
  if (error) return res.status(404).json({ error: 'Participante no encontrado' });
  res.json({ ...data, factura: ultimaFactura(data) });
});

// PATCH /api/participantes/:id — editar datos del piloto y opcionales
const EDITABLES = ['nombre_piloto', 'cedula', 'tipo_documento_piloto', 'novato', 'rh', 'vehiculo_marca', 'vehiculo_placa'];
router.patch('/:id', requireAuth(['admin', 'agente']), async (req, res) => {
  const patch = {};
  for (const k of EDITABLES) if (k in req.body) patch[k] = req.body[k];
  if (!Object.keys(patch).length) return res.status(400).json({ error: 'Nada para actualizar' });

  if ('nombre_piloto' in patch && !String(patch.nombre_piloto || '').trim()) return res.status(400).json({ error: 'El nombre no puede quedar vacío' });
  if ('cedula' in patch) {
    patch.cedula = String(patch.cedula || '').replace(/\s/g, '');
    if (!patch.cedula) return res.status(400).json({ error: 'El documento no puede quedar vacío' });
  }
  if ('tipo_documento_piloto' in patch && patch.tipo_documento_piloto && !TIPO_DOC.includes(patch.tipo_documento_piloto)) {
    return res.status(400).json({ error: 'Tipo de documento inválido' });
  }
  if ('rh' in patch && patch.rh && !RH.includes(patch.rh)) return res.status(400).json({ error: 'RH inválido' });
  if ('novato' in patch) patch.novato = patch.novato === true || patch.novato === 'true';

  patch.updated_at = new Date().toISOString();

  const { data, error } = await supabase.from('gpmd_participants').update(patch).eq('id', req.params.id).select().single();
  if (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Ya existe otro participante con ese documento' });
    return res.status(500).json({ error: error.message });
  }
  await logActivity({ entidad: 'participants', entidadId: req.params.id, accion: 'editado_manual', detalle: patch, usuarioId: req.user.id });
  res.json(data);
});

// Borra en cascada: imágenes en storage, facturas, conversación y el participante.
async function borrarParticipanteCascada(id) {
  const { data: files } = await supabase.storage.from('facturas').list(id, { limit: 1000 });
  if (files && files.length) await supabase.storage.from('facturas').remove(files.map((f) => `${id}/${f.name}`));
  await supabase.from('gpmd_facturas').delete().eq('participant_id', id);
  const { data: p } = await supabase.from('gpmd_participants').select('phone').eq('id', id).maybeSingle();
  if (p?.phone) await supabase.from('gpmd_conversaciones').delete().eq('phone', p.phone);
  return supabase.from('gpmd_participants').delete().eq('id', id);
}

// DELETE /api/participantes/bulk — eliminar varios seleccionados (registrar ANTES de /:id)
router.delete('/bulk', requireAuth(['admin', 'agente']), async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
  if (!ids.length) return res.status(400).json({ error: 'No hay registros seleccionados' });

  let eliminados = 0;
  const errores = [];
  for (const id of ids) {
    const { error } = await borrarParticipanteCascada(id);
    if (error) errores.push({ id, error: error.message }); else eliminados++;
  }
  await logActivity({ entidad: 'participants', entidadId: 'bulk', accion: 'eliminado_bulk', detalle: { eliminados, errores: errores.length, ids }, usuarioId: req.user.id });
  res.json({ eliminados, errores });
});

// DELETE /api/participantes/:id — eliminar un solo registro
router.delete('/:id', requireAuth(['admin', 'agente']), async (req, res) => {
  const { error } = await borrarParticipanteCascada(req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  await logActivity({ entidad: 'participants', entidadId: req.params.id, accion: 'eliminado', detalle: {}, usuarioId: req.user.id });
  res.json({ ok: true });
});

// POST /api/participantes — alta manual 1-a-1 (cupo confirmado sin factura)
router.post('/', requireAuth(['admin']), async (req, res) => {
  const { error: vErr, row } = filaAParticipante(req.body || {});
  if (vErr) return res.status(400).json({ error: vErr });

  const { data, error } = await supabase.from('gpmd_participants').insert(row).select('id, codigo_preregistro').single();
  if (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Ya existe un participante con ese documento' });
    return res.status(500).json({ error: error.message });
  }
  await logActivity({ entidad: 'participants', entidadId: data.id, accion: 'alta_manual', detalle: { cedula: row.cedula }, usuarioId: req.user.id });
  res.status(201).json(data);
});

// POST /api/participantes/bulk — carga masiva desde Excel (filas ya parseadas en el front)
router.post('/bulk', requireAuth(['admin']), async (req, res) => {
  const filas = Array.isArray(req.body?.filas) ? req.body.filas : [];
  if (!filas.length) return res.status(400).json({ error: 'No hay filas para cargar' });

  let creados = 0;
  const errores = [];
  for (let i = 0; i < filas.length; i++) {
    const { error: vErr, row } = filaAParticipante(filas[i]);
    if (vErr) { errores.push({ fila: i + 1, error: vErr }); continue; }
    const { error } = await supabase.from('gpmd_participants').insert(row);
    if (error) errores.push({ fila: i + 1, cedula: row.cedula, error: error.code === '23505' ? 'documento ya registrado' : error.message });
    else creados++;
  }
  await logActivity({ entidad: 'participants', entidadId: 'bulk', accion: 'alta_manual_bulk', detalle: { creados, errores: errores.length }, usuarioId: req.user.id });
  res.json({ creados, errores });
});

module.exports = router;
