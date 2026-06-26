const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const supabase = require('../lib/supabase');
const { requireAuth } = require('../middleware/auth');

// GET /api/usuarios
router.get('/', requireAuth(['admin']), async (req, res) => {
  const { data, error } = await supabase
    .from('gpmd_usuarios')
    .select('id, email, nombre, rol, activo, ultimo_login, created_at')
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// POST /api/usuarios
router.post('/', requireAuth(['admin']), async (req, res) => {
  const { email, nombre, password, rol } = req.body;
  if (!email || !nombre || !password || !rol) return res.status(400).json({ error: 'Todos los campos son requeridos' });
  if (!['admin', 'cliente', 'agente', 'consulta'].includes(rol)) return res.status(400).json({ error: 'Rol inválido' });

  const password_hash = await bcrypt.hash(password, 12);
  const { data, error } = await supabase
    .from('gpmd_usuarios')
    .insert({ email: email.toLowerCase().trim(), nombre, password_hash, rol })
    .select('id, email, nombre, rol, activo')
    .single();

  if (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Email ya existe' });
    return res.status(500).json({ error: error.message });
  }
  res.status(201).json(data);
});

// PATCH /api/usuarios/:id
router.patch('/:id', requireAuth(['admin']), async (req, res) => {
  const { nombre, rol, activo, password } = req.body;
  const updates = {};
  if (nombre !== undefined) updates.nombre = nombre;
  if (rol !== undefined) {
    if (!['admin', 'cliente', 'agente', 'consulta'].includes(rol)) return res.status(400).json({ error: 'Rol inválido' });
    updates.rol = rol;
  }
  if (activo !== undefined) updates.activo = activo;
  if (password) updates.password_hash = await bcrypt.hash(password, 12);

  if (!Object.keys(updates).length) return res.status(400).json({ error: 'Nada que actualizar' });

  const { data, error } = await supabase
    .from('gpmd_usuarios')
    .update(updates)
    .eq('id', req.params.id)
    .select('id, email, nombre, rol, activo')
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// DELETE /api/usuarios/:id
router.delete('/:id', requireAuth(['admin']), async (req, res) => {
  if (String(req.params.id) === String(req.user.id)) {
    return res.status(400).json({ error: 'No puedes eliminar tu propio usuario' });
  }
  const { error } = await supabase.from('gpmd_usuarios').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

module.exports = router;
