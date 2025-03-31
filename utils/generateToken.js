import jwt from 'jsonwebtoken';

const generateToken = (user, expiresIn = '30d') => {
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET no está definido en el entorno");
  }

  const payload = typeof user === 'object'
    ? { id: user._id, role: user.role }
    : { id: user };

  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn });
};

export default generateToken;