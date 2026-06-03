// Script para crear usuario vendedor: Adrian Nava (revival de cotizaciones)
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import User from '../models/User.js';

dotenv.config();

const createAdrianNava = async () => {
  try {
    console.log('Conectando a la base de datos...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Conexión exitosa a MongoDB');

    const email = 'adrian.nava@tesipedia.com';

    // Verificar si ya existe
    const existing = await User.findOne({ email });
    if (existing) {
      console.log(`El usuario ${email} ya existe (ID: ${existing._id})`);
      // Actualizar comisionRate si es necesario
      if (existing.comisionRate !== 0.125) {
        existing.comisionRate = 0.125;
        await existing.save();
        console.log('comisionRate actualizado a 12.5%');
      }
      await mongoose.disconnect();
      return;
    }

    const user = await User.create({
      name: 'Adrian Nava',
      email,
      password: 'Adrian2026!',
      phone: '',
      role: 'admin',
      isActive: true,
      comisionRate: 0.125,
    });

    console.log('Usuario creado exitosamente:');
    console.log(`  Nombre: ${user.name}`);
    console.log(`  Email: ${user.email}`);
    console.log(`  Role: ${user.role}`);
    console.log(`  Comision: 12.5%`);
    console.log(`  Password: Adrian2026!`);
    console.log(`  ID: ${user._id}`);

    await mongoose.disconnect();
    console.log('Desconectado de MongoDB');
  } catch (error) {
    console.error('Error:', error.message);
    await mongoose.disconnect();
    process.exit(1);
  }
};

createAdrianNava();
