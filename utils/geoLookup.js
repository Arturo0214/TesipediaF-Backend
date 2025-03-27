import axios from 'axios';

const getGeoFromIP = async (ip) => {
  try {
    const { data } = await axios.get(`https://ipinfo.io/${ip}?token=${process.env.IPINFO_TOKEN}`);

    return {
      city: data.city,
      region: data.region,
      country: data.country,
      org: data.org,
      loc: data.loc, // latitud,longitud
    };
  } catch (error) {
    console.error('🌐 Error al obtener datos geográficos:', error.message);
    return null;
  }
};

export default getGeoFromIP;