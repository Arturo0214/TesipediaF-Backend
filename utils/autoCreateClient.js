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
 * Crea o encuentra un usuario cliente existente por email.
 * Si ya existe, retorna el existente. Si no, crea uno nuevo.
 *
 * @param {object} params
 * @param {string} params.clientName - Nombre del cliente
 * @param {string} params.clientEmail - Email del cliente
 * @param {string} [params.clientPhone] - Teléfono (para enviar WhatsApp)
 * @param {string} [params.projectTitle] - Título del proyecto (para el mensaje WA)
 * @returns {object} { user, isNew, password }
 */
export const autoCreateClientUser = async ({ clientName, clientEmail, clientPhone, projectTitle }) => {
  if (!clientEmail) {
    console.log('[AutoClient] No se proporcionó email, omitiendo creación de usuario');
    return { user: null, isNew: false, password: null };
  }

  // Verificar si el usuario ya existe
  const existingUser = await User.findOne({ email: clientEmail.toLowerCase() });
  if (existingUser) {
    console.log(`[AutoClient] Usuario ya existe: ${clientEmail} (${existingUser.role})`);
    return { user: existingUser, isNew: false, password: null };
  }

  // Crear nuevo usuario
  const password = generateGenericPassword(clientName);

  const newUser = await User.create({
    name: clientName || 'Cliente',
    email: clientEmail.toLowerCase(),
    password,
    role: 'cliente',
    isActive: true,
  });

  console.log(`[AutoClient] Usuario creado: ${newUser.email} (ID: ${newUser._id})`);

  // Enviar credenciales por WhatsApp si hay teléfono
  if (clientPhone) {
    const phoneClean = clientPhone.replace(/\D/g, '');
    // Agregar código de país México si no lo tiene
    const phoneFormatted = phoneClean.startsWith('52') ? phoneClean : `52${phoneClean}`;

    const message = [
      `Hola ${clientName || 'Cliente'} *Bienvenido a Tesipedia*`,
      ``,
      `Se ha creado tu cuenta para que puedas dar seguimiento a tu proyecto${projectTitle ? `: *${projectTitle}*` : ''}.`,
      ``,
      `Tus datos de acceso:`,
      `*Email:* ${clientEmail}`,
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

  return { user: newUser, isNew: true, password };
};

export default { autoCreateClientUser };
