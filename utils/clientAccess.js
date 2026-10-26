/**
 * Acceso del cliente al portal: asegurar/revelar/regenerar las credenciales que el
 * equipo comunica al cliente ("entra aquí con esto"). La contraseña se guarda CIFRADA
 * (secretBox) además del hash bcrypt, para poder mostrarla de vuelta.
 */
import User from '../models/User.js';
import { autoCreateClientUser } from './autoCreateClient.js';
import { encryptSecret, decryptSecret } from './secretBox.js';
import { nextSeq } from '../models/Counter.js';
import { sendWhatsAppText } from './sendWhatsAppNotification.js';

const PORTAL_URL = () => (process.env.CLIENT_URL || 'https://tesipedia.com');

const generarPassword = (name) => {
  const base = (name || 'Cliente')
    .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .split(/\s+/).map((w) => w.replace(/[^a-z]/g, '')).filter((w) => w.length >= 3)[0] || 'cliente';
  return `${base}${Math.floor(1000 + Math.random() * 9000)}!`;
};

const loginIdOf = (user) =>
  (user.email && !/@tesipedia\.mx$/.test(user.email)) ? user.email : (user.phone || user.email);

/**
 * Garantiza que exista la cuenta del cliente y que tengamos su contraseña revelable.
 * Si la cuenta es vieja y no tiene accessPassword, genera una nueva (resetea el login).
 * @returns {object|null} { userId, nombre, clientNumber, loginId, email, phone, password, portalUrl, isNew }
 */
export const ensureClientAccess = async ({ clientName, clientEmail, clientPhone, projectTitle } = {}) => {
  const { user, isNew } = await autoCreateClientUser({ clientName, clientEmail, clientPhone, projectTitle });
  if (!user) return null;

  // Cargar con los campos ocultos
  const full = await User.findById(user._id).select('+accessPassword name email phone clientNumber role');
  if (!full) return null;

  let password = decryptSecret(full.accessPassword);

  // Cuenta sin contraseña revelable (p.ej. creada antes de este sistema): generamos una
  if (!password) {
    password = generarPassword(full.name);
    full.password = password;                       // re-hashea (pre-save)
    full.accessPassword = encryptSecret(password);  // guarda revelable
    if (!full.clientNumber) full.clientNumber = await nextSeq('clientNumber', 1000);
    await full.save();
  }

  return {
    userId: String(full._id),
    nombre: full.name,
    clientNumber: full.clientNumber || null,
    loginId: loginIdOf(full),
    email: full.email,
    phone: full.phone,
    password,
    portalUrl: `${PORTAL_URL()}/portal`,
    isNew,
  };
};

/** Regenera la contraseña del cliente (nuevo login) y la devuelve. */
export const regenerateClientAccess = async (userId) => {
  const full = await User.findById(userId).select('+accessPassword name email phone clientNumber');
  if (!full) return null;
  const password = generarPassword(full.name);
  full.password = password;
  full.accessPassword = encryptSecret(password);
  if (!full.clientNumber) full.clientNumber = await nextSeq('clientNumber', 1000);
  await full.save();
  return {
    userId: String(full._id), nombre: full.name, clientNumber: full.clientNumber,
    loginId: loginIdOf(full), email: full.email, phone: full.phone, password,
    portalUrl: `${PORTAL_URL()}/portal`,
  };
};

/** Reenvía las credenciales al cliente por WhatsApp. */
export const resendClientAccess = async (userId) => {
  const info = await (async () => {
    const full = await User.findById(userId).select('+accessPassword name email phone clientNumber');
    if (!full) return null;
    let password = decryptSecret(full.accessPassword);
    if (!password) { const r = await regenerateClientAccess(userId); return r; }
    return {
      nombre: full.name, clientNumber: full.clientNumber, loginId: loginIdOf(full),
      email: full.email, phone: full.phone, password, portalUrl: `${PORTAL_URL()}/portal`,
    };
  })();
  if (!info || !info.phone) return { sent: false, info };
  const msg = [
    `Hola ${info.nombre || ''} 👋 *Tesipedia*`,
    ``,
    `Aquí das seguimiento a tu proyecto en vivo: pagos, documentos y chat con el equipo.`,
    ``,
    `*Tu acceso:*`,
    `Usuario: ${info.loginId}`,
    `Contraseña: ${info.password}`,
    ``,
    `Entra aquí: ${info.portalUrl}`,
  ].join('\n');
  await sendWhatsAppText(info.phone, msg).catch((e) => console.error('[clientAccess] WA:', e.message));
  return { sent: true, info };
};

export default { ensureClientAccess, regenerateClientAccess, resendClientAccess };
