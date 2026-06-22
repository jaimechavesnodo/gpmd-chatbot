const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { requireAuth } = require('../middleware/auth');
const { logActivity } = require('../middleware/logger');

const SELECT = `
  id, nombre_piloto, cedula, tipo_documento_piloto, novato, rh, email, phone,
  nombre_copiloto, tipo_documento_copiloto, numero_documento_copiloto, rh_copiloto,
  vehiculo_marca, vehiculo_placa, codigo_preregistro, estado, created_at, updated_at,
  facturas:gpmd_facturas ( id, estado, cliente, nit, referencia_producto, presentacion, valor_total, ocr_confianza, imagen_url, created_at )
`;

function ultimaFactura(p) {
  const fs = (p.facturas || []).slice().sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return fs[0] || null;
}

// GET /api/participantes?estado=  — lista de preregistrados
router.get('/', requireAuth(['admin', 'cliente', 'agente']), async (req, res) => {
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
router.get('/:id', requireAuth(['admin', 'cliente', 'agente']), async (req, res) => {
  const { data, error } = await supabase.from('gpmd_participants').select(SELECT).eq('id', req.params.id).single();
  if (error) return res.status(404).json({ error: 'Participante no encontrado' });
  res.json({ ...data, factura: ultimaFactura(data) });
});

// PATCH /api/participantes/:id — editar datos opcionales (cambios de último momento)
const EDITABLES = ['nombre_copiloto', 'tipo_documento_copiloto', 'numero_documento_copiloto', 'rh_copiloto', 'vehiculo_marca', 'vehiculo_placa', 'email'];
router.patch('/:id', requireAuth(['admin', 'agente']), async (req, res) => {
  const patch = {};
  for (const k of EDITABLES) if (k in req.body) patch[k] = req.body[k];
  if (!Object.keys(patch).length) return res.status(400).json({ error: 'Nada para actualizar' });
  patch.updated_at = new Date().toISOString();

  const { data, error } = await supabase.from('gpmd_participants').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  await logActivity({ entidad: 'participants', entidadId: req.params.id, accion: 'editado_manual', detalle: patch, usuarioId: req.user.id });
  res.json(data);
});

module.exports = router;
