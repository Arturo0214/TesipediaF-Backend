import { v4 as uuidv4 } from 'uuid';

const setCookieIfNotExists = (req, res, next) => {
  if (!req.cookies.cookieId) {
    res.cookie('cookieId', uuidv4(), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'Lax',
      maxAge: 1000 * 60 * 60 * 24 * 30, // 30 días
    });
  }

  next();
};

export default setCookieIfNotExists;