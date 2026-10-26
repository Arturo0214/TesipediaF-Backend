import asyncHandler from 'express-async-handler';
import { ensureClientAccess, regenerateClientAccess, resendClientAccess } from '../utils/clientAccess.js';

/**
 * Credenciales del portal del cliente, para el admin.
 * reveal: garantiza que exista la cuenta + devuelve usuario/contraseña a comunicar.
 * regenerate: nueva contraseña. resend: la reenvía por WhatsApp al cliente.
 */

// POST /client-access/reveal  { clientName, clientEmail, clientPhone, projectTitle }
export const revealAccess = asyncHandler(async (req, res) => {
  const { clientName, clientEmail, clientPhone, projectTitle } = req.body || {};
  if (!clientEmail && !clientPhone) { res.status(400); throw new Error('Se requiere email o teléfono del cliente'); }
  const info = await ensureClientAccess({ clientName, clientEmail, clientPhone, projectTitle });
  if (!info) { res.status(404); throw new Error('No se pudo crear/encontrar la cuenta del cliente'); }
  res.json(info);
});

// POST /client-access/regenerate  { userId }
export const regenerateAccess = asyncHandler(async (req, res) => {
  const { userId } = req.body || {};
  if (!userId) { res.status(400); throw new Error('userId requerido'); }
  const info = await regenerateClientAccess(userId);
  if (!info) { res.status(404); throw new Error('Cliente no encontrado'); }
  res.json(info);
});

// POST /client-access/resend  { userId }
export const resendAccess = asyncHandler(async (req, res) => {
  const { userId } = req.body || {};
  if (!userId) { res.status(400); throw new Error('userId requerido'); }
  const r = await resendClientAccess(userId);
  res.json(r);
});
