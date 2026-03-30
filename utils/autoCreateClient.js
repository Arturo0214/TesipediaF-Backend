/**
 * Utilidad para crear automáticamente una cuenta de cliente
 * cuando se registra un proyecto o pago manual.
 * Envía las credenciales por WhatsApp.
 */
import User from '../models/User.js';
import { sendWhatsAppText } from './sendWhatsAppNotification.js';

/**
 * Genera una contraseña genérica basada en el nombre del cliente
 * Formato: PrimerNombre + 4 dígitos aleatorios + "!"
 */
const generateGenericPassword = (name) => {
  const firstName = (name || 'Cliente').split(' ')[0].toLowerCase();
  const sanitized = firstName.replace(/[^a-z]/g, '') || 'cliente';
  const digits = Math.floor(1000 + Math.random() * 9000); // 4 dígitos
  return `${sanitized}${digits}!`;
};

/**
 * Formatea un número de teléfono para uso interno.
 * Limpia caracteres no numéricos y agrega código de país MX si falta.
 */
const formatPhone = (phone) => {
  if (!phone) return '';
  const clean = phone.replace(/\D/g, '');
  if (!clean) return '';
  return clean.startsWith('52') ? clean : `52${clean}`;
};

/**
 * Crea o encuentra un usuario cliente existente por email o teléfono.
 * Si ya existe, retorna el existente. Si no, crea uno nuevo.
 * Si no hay email pero sí teléfono, genera un email basado en el teléfono.
 *
 * @param {object} params
 * @param {string} params.clientName - Nombre del cliente
 * @param {string} [params.clientEmail] - Email del cliente (opcional si hay teléfono)
 * @param {string} [params.clientPhone] - Teléfono (para enviar WhatsApp y como login alternativo)
 * @param {string} [params.projectTitle] - Título del proyecto (para el mensaje WA)
 * @returns {object} { user, isNew, password, loginIdentifier }
 */
export const autoCreateClientUser = async ({ clientName, clientEmail, clientPhone, projectTitle, manualPassword }) => {
  // Detectar si clientEmail es realmente un teléfono (solo dígitos, sin @)
  let actualEmail = clientEmail;
  let actualPhone = clientPhone;
  if (clientEmail && /^\d+$/.test(clientEmail.trim())) {
    console.log(`[AutoClient] clientEmail "${clientEmail}" parece ser un teléfono, reasignando`);
    actualPhone = actualPhone || clientEmail;
    actualEmail = '';
  }

  const phoneFormatted = formatPhone(actualPhone);

  if (!actualEmail && !phoneFormatted) {
    console.log('[AutoClient] No se proporcionó email ni teléfono, omitiendo creación de usuario');
    return { user: null, isNew: false, password: null, loginIdentifier: null };
  }

  // Determinar el email a usar
  // Si no hay email pero sí teléfono, generar email basado en teléfono
  const effectiveEmail = actualEmail
    ? actualEmail.toLowerCase()
    : `${phoneFormatted}@tesipedia.mx`;

  // Verificar si el usuario ya existe por email
  let existingUser = await User.findOne({ email: effectiveEmail });

  // Si no se encontró por email y hay teléfono, buscar por teléfono
  if (!existingUser && phoneFormatted) {
    existingUser = await User.findOne({ phone: phoneFormatted });
  }

  if (existingUser) {
    console.log(`[AutoClient] Usuario ya existe: ${existingUser.email} (${existingUser.role})`);
    // Actualizar teléfono si no lo tenía
    if (phoneFormatted && !existingUser.phone) {
      existingUser.phone = phoneFormatted;
      await existingUser.save();
    }
    const loginId = actualEmail ? existingUser.email : (existingUser.phone || existingUser.email);
    return { user: existingUser, isNew: false, password: null, loginIdentifier: loginId };
  }

  // Crear nuevo usuario
  const password = manualPassword || generateGenericPassword(clientName);

  const newUser = await User.create({
    name: clientName || 'Cliente',
    email: effectiveEmail,
    phone: phoneFormatted,
    password,
    role: 'cliente',
    isActive: true,
  });

  // El identificador de login: si tiene email real usa email, si no usa teléfono
  const loginIdentifier = actualEmail ? effectiveEmail : phoneFormatted;

  console.log(`[AutoClient] Usuario creado: ${newUser.email} / phone: ${newUser.phone} (ID: ${newUser._id})`);

  // Enviar credenciales por WhatsApp si hay teléfono
  if (phoneFormatted) {
    // Construir mensaje con el identificador de login correcto
    const loginLine = actualEmail
      ? `*Email:* ${effectiveEmail}`
      : `*Tu número de teléfono:* ${actualPhone}`;

    const message = [
      `Hola ${clientName || 'Cliente'} *Bienvenido a Tesipedia*`,
      ``,
      `Se ha creado tu cuenta para que puedas dar seguimiento a tu proyecto${projectTitle ? `: *${projectTitle}*` : ''}.`,
      ``,
      `Tus datos de acceso:`,
      loginLine,
      `*Contraseña:* ${password}`,
      ``,
      `Accede aquí: ${process.env.CLIENT_URL || 'https://tesipedia.com'}/login`,
      ``,
      `Te recomendamos cambiar tu contraseña una vez que inicies sesión.`,
    ].join('\n');

    sendWhatsAppText(phoneFormatted, message).catch(err =>
      console.error('[AutoClient] Error enviando credenciales por WhatsApp:', err.message)
    );
  }

  return { user: newUser, isNew: true, password, loginIdentifier };
};

export default { autoCreateClientUser };
