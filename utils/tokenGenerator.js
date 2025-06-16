import jwt from 'jsonwebtoken';
import crypto from 'crypto';

const generateToken = (user, expiresIn = '30d') => {
    if (!process.env.JWT_SECRET) {
        throw new Error("JWT_SECRET no está definido en el entorno");
    }

    const payload = typeof user === 'object'
        ? { id: user._id, role: user.role }
        : { id: user };

    return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn });
};

/**
 * Generate a tracking token for guest payments
 * @param {string} quoteId - The quote ID to associate with the token (optional)
 * @param {number} expiresIn - Token expiration time in hours (default: 72 hours)
 * @returns {string} The generated tracking token
 */
export const generateTrackingToken = (quoteId = null, expiresIn = 72) => {
    if (!process.env.JWT_SECRET) {
        throw new Error("JWT_SECRET no está definido en el entorno");
    }

    // Create a random salt for additional security
    const salt = crypto.randomBytes(16).toString('hex');

    // Create payload with quote ID (if provided) and expiration
    const payload = {
        quoteId,
        salt,
        type: 'tracking',
        timestamp: Date.now()
    };

    // Generate token that expires in specified hours
    return jwt.sign(payload, process.env.JWT_SECRET, {
        expiresIn: `${expiresIn}h`
    });
};

/**
 * Verify a tracking token
 * @param {string} token - The tracking token to verify
 * @returns {Object|null} The decoded token payload or null if invalid
 */
export const verifyTrackingToken = (token) => {
    if (!process.env.JWT_SECRET) {
        throw new Error("JWT_SECRET no está definido en el entorno");
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Verify this is a tracking token
        if (decoded.type !== 'tracking') {
            return null;
        }

        return decoded;
    } catch (error) {
        return null;
    }
};

export default generateToken;