import axios from 'axios';

/**
 * Intenta obtener geolocalización de una IP.
 * Primero intenta ipinfo.io (si hay token), luego ip-api.com como fallback.
 */
const getGeoFromIP = async (ip) => {
  // Limpiar IP (quitar ::ffff: de IPv4-mapped IPv6, quitar puertos, tomar primera de lista)
  let cleanIP = (ip || '').split(',')[0].trim();
  if (cleanIP.startsWith('::ffff:')) cleanIP = cleanIP.replace('::ffff:', '');
  if (cleanIP === '::1' || cleanIP === '127.0.0.1' || !cleanIP) {
    return { city: 'Local', region: 'Local', country: 'Local', org: 'Localhost', loc: null };
  }

  // 1) ipinfo.io (con token)
  if (process.env.IPINFO_TOKEN) {
    try {
      const { data } = await axios.get(`https://ipinfo.io/${cleanIP}?token=${process.env.IPINFO_TOKEN}`, { timeout: 5000 });
      if (data && data.country) {
        return {
          city: data.city || 'Desconocido',
          region: data.region || 'Desconocido',
          country: data.country || 'Desconocido',
          org: data.org || '',
          loc: data.loc || null,
        };
      }
    } catch (err) {
      console.warn('⚠️ ipinfo.io falló, intentando fallback:', err.message);
    }
  }

  // 2) Fallback: ip-api.com (gratis, sin token, 45 req/min)
  try {
    const { data } = await axios.get(`http://ip-api.com/json/${cleanIP}?fields=status,country,countryCode,regionName,city,isp,lat,lon`, { timeout: 5000 });
    if (data && data.status === 'success') {
      return {
        city: data.city || 'Desconocido',
        region: data.regionName || 'Desconocido',
        country: data.countryCode || 'Desconocido',
        org: data.isp || '',
        loc: data.lat && data.lon ? `${data.lat},${data.lon}` : null,
      };
    }
  } catch (err) {
    console.warn('⚠️ ip-api.com también falló:', err.message);
  }

  // 3) Último fallback: ipapi.co (gratis, 1000 req/día)
  try {
    const { data } = await axios.get(`https://ipapi.co/${cleanIP}/json/`, { timeout: 5000 });
    if (data && !data.error) {
      return {
        city: data.city || 'Desconocido',
        region: data.region || 'Desconocido',
        country: data.country_code || 'Desconocido',
        org: data.org || '',
        loc: data.latitude && data.longitude ? `${data.latitude},${data.longitude}` : null,
      };
    }
  } catch (err) {
    console.error('🌐 Todos los servicios de geolocalización fallaron:', err.message);
  }

  return { city: 'Desconocido', region: 'Desconocido', country: 'XX', org: '', loc: null };
};

export default getGeoFromIP;
