import mongoose from 'mongoose';

/**
 * Contador atómico para secuencias amigables (p.ej. número de cliente del portal).
 * Uso: const n = await nextSeq('clientNumber', 1000);  // arranca en 1001
 */
const counterSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 },
});

const Counter = mongoose.model('Counter', counterSchema);

export const nextSeq = async (name, start = 0) => {
  const doc = await Counter.findByIdAndUpdate(
    name,
    { $inc: { seq: 1 }, $setOnInsert: {} },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  // Si es el primer uso, alinear al 'start' deseado
  if (doc.seq === 1 && start > 0) {
    doc.seq = start + 1;
    await doc.save();
  }
  return doc.seq;
};

export default Counter;
