import jwt from 'jsonwebtoken';

const generateToken = (user, expiresIn = '30d') => {
  const payload = typeof user === 'object'
    ? { id: user._id, role: user.role }
    : { id: user }; // permite pasar solo el ID también

  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn });
};

export default generateToken;
