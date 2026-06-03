// Script para crear usuario Adrian Nava + actualizar comisiones de Hugo y Sandy
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import User from '../models/User.js';

dotenv.config();

const run = async () => {
  try {
    console.log('Conectando a la base de datos...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Conexión exitosa a MongoDB');

    // === 1. Crear Adrian Nava ===
    const email = 'adrian.nava@tesipedia.com';
    const existing = await User.findOne({ email });
    if (existing) {
      console.log(`Adrian Nava ya existe (ID: ${existing._id})`);
      if (existing.comisionRate !== 0.125) {
        existing.comisionRate = 0.125;
        await existing.save();
        console.log('  comisionRate actualizado a 12.5%');
      }
    } else {
      const user = await User.create({
        name: 'Adrian Nava',
        email,
        password: 'Adrian2026!',
        phone: '',
        role: 'admin',
        isActive: true,
        comisionRate: 0.125,
      });
      console.log(`Adrian Nava creado (ID: ${user._id}) — 12.5% comisión`);
      console.log(`  Email: ${email} / Password: Adrian2026!`);
    }

    // === 2. Actualizar comisiones de Hugo y Sandy a 25% ===
    const vendedores = [
      { name: /hugo/i, rate: 0.25 },
      { name: /sandy/i, rate: 0.25 },
    ];

    for (const v of vendedores) {
      const user = await User.findOne({ name: v.name });
      if (user) {
        if (user.comisionRate !== v.rate) {
          user.comisionRate = v.rate;
          await user.save();
          console.log(`${user.name}: comisionRate actualizado a ${v.rate * 100}%`);
        } else {
          console.log(`${user.name}: ya tiene ${v.rate * 100}%`);
        }
      } else {
        console.log(`No se encontró usuario con nombre ${v.name}`);
      }
    }

    await mongoose.disconnect();
    console.log('Listo');
  } catch (error) {
    console.error('Error:', error.message);
    await mongoose.disconnect();
    process.exit(1);
  }
};

run();
