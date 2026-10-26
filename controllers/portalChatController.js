import asyncHandler from 'express-async-handler';
import PortalMessage from '../models/PortalMessage.js';
import User from '../models/User.js';
import { ensureClientAccess } from '../utils/clientAccess.js';

const shape = (m) => ({
  id: String(m._id), from: m.from, authorName: m.authorName,
  text: m.text, createdAt: m.createdAt,
});

/* ═════════ PORTAL (cliente) ═════════ */

// GET /portal/messages — hilo del cliente logueado (marca como leídos los del equipo)
export const getMyMessages = asyncHandler(async (req, res) => {
  const msgs = await PortalMessage.find({ client: req.user._id }).sort({ createdAt: 1 }).lean();
  await PortalMessage.updateMany({ client: req.user._id, from: 'team', readByClient: false }, { readByClient: true });
  res.json(msgs.map(shape));
});

// POST /portal/messages { text } — el cliente escribe al equipo
export const sendMyMessage = asyncHandler(async (req, res) => {
  const text = String(req.body?.text || '').trim();
  if (!text) { res.status(400); throw new Error('Mensaje vacío'); }
  const m = await PortalMessage.create({
    client: req.user._id, from: 'client', authorName: req.user.name || 'Cliente',
    text, readByClient: true,
  });
  res.status(201).json(shape(m));
});

// GET /portal/messages/unread — número de mensajes del equipo sin leer (badge)
export const myUnread = asyncHandler(async (req, res) => {
  const n = await PortalMessage.countDocuments({ client: req.user._id, from: 'team', readByClient: false });
  res.json({ unread: n });
});

/* ═════════ ADMIN (equipo, desde Proyectos) ═════════ */

// Resuelve el cliente por userId directo, o por nombre/email/teléfono de la fila del tablero.
async function resolveClientId({ clientId, clientName, clientEmail, clientPhone }) {
  if (clientId) return clientId;
  const access = await ensureClientAccess({ clientName, clientEmail, clientPhone });
  return access?.userId || null;
}

// GET /client-chat?clientId= | &clientEmail=&clientPhone= — hilo (marca leídos los del cliente)
export const getClientMessages = asyncHandler(async (req, res) => {
  const clientId = await resolveClientId(req.query);
  if (!clientId) { res.json({ clientId: null, messages: [] }); return; }
  const msgs = await PortalMessage.find({ client: clientId }).sort({ createdAt: 1 }).lean();
  await PortalMessage.updateMany({ client: clientId, from: 'client', readByTeam: false }, { readByTeam: true });
  res.json({ clientId: String(clientId), messages: msgs.map(shape) });
});

// POST /client-chat { clientId|clientEmail|clientPhone, text } — el equipo responde
export const sendTeamMessage = asyncHandler(async (req, res) => {
  const text = String(req.body?.text || '').trim();
  if (!text) { res.status(400); throw new Error('Mensaje vacío'); }
  const clientId = await resolveClientId(req.body);
  if (!clientId) { res.status(404); throw new Error('No se pudo resolver el cliente'); }
  const m = await PortalMessage.create({
    client: clientId, from: 'team', authorName: req.user?.name || 'Equipo Tesipedia',
    text, readByTeam: true,
  });
  res.status(201).json({ clientId: String(clientId), message: shape(m) });
});

export default { getMyMessages, sendMyMessage, myUnread, getClientMessages, sendTeamMessage };
