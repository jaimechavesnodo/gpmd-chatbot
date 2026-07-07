const express = require('express');
const router = express.Router();
const supabase = require('../lib/supabase');
const { requireAuth } = require('../middleware/auth');
const { logActivity } = require('../middleware/logger');
const { nitCoincide } = require('../lib/ocr');

const CAMPOS_OBLIGATORIOS = ['nit', 'cliente', 'agente', 'departamento', 'ciudad', 'canal', 'razon_social', 'direccion'];

// GET /api/pdv?q=...    → autocompletar por NIT (prefijo) o nombre de cliente (para el aprobador)
// GET /api/pdv?nit=...  → clientes que coinciden exactamente con ese NIT
// GET /api/pdv          → listado completo (gestión)
router.get('/', requireAuth(['admin', 'agente', 'cliente']), async (req, res) => {
  const { data, error } = await supabase.from('gpmd_pdv').select('*').eq('activo', true).order('cliente');
  if (error) return res.status(500).json({ error: error.message });

  const q = (req.query.q || '').trim();
  if (q) {
    const ql = q.toLowerCase();
    const qd = q.replace(/\D/g, '');
    const rows = (data || []).filter((p) => {
      const nit = String(p.nit || '');
      const byNit = qd && nit.replace(/\D/g, '').includes(qd);
      const byCliente = p.cliente && p.cliente.toLowerCase().includes(ql);
      return byNit || byCliente;
    }).slice(0, 15);
    return res.json(rows);
  }

  const nit = req.query.nit;
  const rows = nit ? (data || []).filter((p) => nitCoincide(nit, p.nit)) : data;
  res.json(rows);
});

// POST /api/pdv — alta de un PDV (usada también desde el popup del Aprobador
// cuando el NIT de una factura no tiene ningún punto de venta registrado)
router.post('/', requireAuth(['admin', 'agente']), async (req, res) => {
  const row = {};
  for (const campo of CAMPOS_OBLIGATORIOS) {
    const val = (req.body[campo] || '').toString().trim();
    if (!val) return res.status(400).json({ error: `El campo "${campo}" es obligatorio` });
    row[campo] = val;
  }

  const { data, error } = await supabase.from('gpmd_pdv').insert(row).select().single();
  if (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Ya existe un PDV con ese NIT y Cliente' });
    return res.status(500).json({ error: error.message });
  }
  await logActivity({ entidad: 'pdv', entidadId: data.id, accion: 'alta_manual', detalle: row, usuarioId: req.user.id });
  res.status(201).json(data);
});

router.patch('/:id', requireAuth(['admin', 'agente']), async (req, res) => {
  const { data, error } = await supabase.from('gpmd_pdv').update(req.body).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  await logActivity({ entidad: 'pdv', entidadId: data.id, accion: 'editado_manual', detalle: req.body, usuarioId: req.user.id });
  res.json(data);
});

router.delete('/:id', requireAuth(['admin', 'agente']), async (req, res) => {
  await supabase.from('gpmd_pdv').update({ activo: false }).eq('id', req.params.id);
  await logActivity({ entidad: 'pdv', entidadId: req.params.id, accion: 'eliminado', detalle: {}, usuarioId: req.user.id });
  res.json({ ok: true });
});

module.exports = router;
