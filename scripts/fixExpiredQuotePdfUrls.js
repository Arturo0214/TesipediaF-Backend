// Migración: reemplaza las pdfUrl firmadas de Cloudinary (expiran a los 7 días)
// por la secure_url permanente en todas las cotizaciones generadas.
// Uso: node scripts/fixExpiredQuotePdfUrls.js [--dry-run]
import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

const DRY_RUN = process.argv.includes('--dry-run');
const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  const col = mongoose.connection.db.collection('generatedquotes');

  const cursor = col.find(
    { pdfUrl: { $regex: 'api\\.cloudinary\\.com' } },
    { projection: { pdfUrl: 1, pdfPublicId: 1, clientName: 1 } }
  );

  let fixed = 0, skipped = 0;
  for await (const doc of cursor) {
    // public_id preferente del campo guardado; si no, extraerlo de la propia URL
    const fromUrl = (doc.pdfUrl.match(/public_id=([^&]+)/) || [])[1];
    const publicId = doc.pdfPublicId || (fromUrl ? decodeURIComponent(fromUrl) : null);
    if (!publicId) { skipped++; continue; }

    const secureUrl = `https://res.cloudinary.com/${CLOUD_NAME}/raw/upload/${publicId}`;
    if (DRY_RUN) {
      console.log(`[dry-run] ${doc.clientName || doc._id}: ${secureUrl}`);
    } else {
      await col.updateOne({ _id: doc._id }, { $set: { pdfUrl: secureUrl } });
    }
    fixed++;
  }

  console.log(`${DRY_RUN ? '[dry-run] ' : ''}Corregidas: ${fixed} | Sin public_id (omitidas): ${skipped}`);
  await mongoose.disconnect();
}

run().catch((err) => { console.error(err); process.exit(1); });
