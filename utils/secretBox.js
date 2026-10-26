import crypto from 'crypto';

/**
 * Cifrado simétrico reversible (AES-256-GCM) para secretos que el ADMIN debe poder
 * revelar después — p.ej. la contraseña autogenerada del portal del cliente, que el
 * equipo necesita para decirle al cliente "entra aquí con esto".
 *
 * NO usar para contraseñas de login propias del sistema (esas van hasheadas con bcrypt).
 * Esto es solo para credenciales que deliberadamente deben poder leerse de vuelta.
 *
 * Clave: CREDENTIALS_ENC_KEY si está en env; si no, se deriva de JWT_SECRET. La clave
 * nunca sale del servidor. Formato de salida: "v1:<iv b64>:<tag b64>:<cipher b64>".
 */
const deriveKey = () => {
  const secret = process.env.CREDENTIALS_ENC_KEY || process.env.JWT_SECRET || 'tesipedia-fallback-key';
  // scrypt a 32 bytes con sal fija (la sal fija es aceptable: el secreto ya es alto-entropía)
  return crypto.scryptSync(secret, 'tesipedia-creds-v1', 32);
};

export const encryptSecret = (plain) => {
  if (plain == null || plain === '') return '';
  const key = deriveKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
};

export const decryptSecret = (blob) => {
  if (!blob || typeof blob !== 'string' || !blob.startsWith('v1:')) return null;
  try {
    const [, ivB64, tagB64, dataB64] = blob.split(':');
    const key = deriveKey();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    const dec = Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]);
    return dec.toString('utf8');
  } catch (err) {
    console.error('[secretBox] No se pudo descifrar:', err.message);
    return null;
  }
};

export default { encryptSecret, decryptSecret };
