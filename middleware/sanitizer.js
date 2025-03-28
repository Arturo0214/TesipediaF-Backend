import { sanitizeRequestBody } from '../utils/sanitizer.js';

// Middleware to sanitize all request data
export const sanitizeRequest = (req, res, next) => {
    req = sanitizeRequestBody(req);
    next();
}; 