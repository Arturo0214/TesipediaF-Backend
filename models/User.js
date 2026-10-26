// models/User.js
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'El nombre es obligatorio'],
    },
    email: {
      type: String,
      required: [true, 'El correo es obligatorio'],
      unique: true,
      lowercase: true,
      match: [/^\S+@\S+\.\S+$/, 'Correo inválido'],
    },
    password: {
      type: String,
      required: [true, 'La contraseña es obligatoria'],
      minlength: 6,
      select: false,
    },
    phone: {
      type: String,
      default: '',
      index: true,
    },
    role: {
      type: String,
      enum: ['cliente', 'admin', 'redactor', 'superadmin'],
      default: 'cliente',
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    comisionRate: {
      type: Number,
      default: 0.20,
      min: 0,
      max: 1,
    },
    resetPasswordToken: String,              // 🆕 Token hashed
    resetPasswordExpires: Date,              // 🆕 Fecha de expiración

    // 🔑 Portal del cliente: contraseña autogenerada guardada CIFRADA (AES-GCM, utils/secretBox)
    // para que el equipo la pueda revelar y decirle al cliente "entra aquí con esto".
    // El login real sigue validando contra `password` (bcrypt); esto es solo para mostrarla.
    accessPassword: { type: String, select: false, default: '' },
    // Número de cliente amigable ("Cliente #1234") asignado al crear la cuenta.
    clientNumber: { type: Number, index: true },
  },
  {
    timestamps: true,
  }
);


// 🔐 Encriptar contraseña antes de guardar
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) {
    return next(); // No se vuelve a hashear si no se modificó
  }
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// 📌 Método para comparar contraseñas
userSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

const User = mongoose.model('User', userSchema);
export default User;