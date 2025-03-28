import xss from 'xss';
import validator from 'validator';

// Sanitize a string to prevent XSS attacks
export const sanitizeString = (str) => {
    if (!str) return str;
    return xss(str, {
        whiteList: {}, // No HTML tags allowed
        stripIgnoreTag: true,
        stripIgnoreTagBody: ['script'],
    });
};

// Sanitize an email address
export const sanitizeEmail = (email) => {
    if (!email) return email;
    return validator.normalizeEmail(email);
};

// Sanitize a phone number
export const sanitizePhone = (phone) => {
    if (!phone) return phone;
    return validator.whitelist(phone, '0-9+');
};

// Sanitize a URL
export const sanitizeUrl = (url) => {
    if (!url) return url;
    return validator.escape(url);
};

// Sanitize a number
export const sanitizeNumber = (num) => {
    if (num === undefined || num === null) return num;
    return validator.toInt(num.toString());
};

// Sanitize a date
export const sanitizeDate = (date) => {
    if (!date) return date;
    return validator.toDate(date);
};

// Sanitize an object recursively
export const sanitizeObject = (obj) => {
    if (!obj || typeof obj !== 'object') return obj;

    const sanitized = Array.isArray(obj) ? [] : {};

    for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
            const value = obj[key];
            if (typeof value === 'string') {
                sanitized[key] = sanitizeString(value);
            } else if (typeof value === 'object') {
                sanitized[key] = sanitizeObject(value);
            } else {
                sanitized[key] = value;
            }
        }
    }

    return sanitized;
};

// Sanitize request body
export const sanitizeRequestBody = (req) => {
    if (req.body) {
        req.body = sanitizeObject(req.body);
    }
    if (req.query) {
        req.query = sanitizeObject(req.query);
    }
    if (req.params) {
        req.params = sanitizeObject(req.params);
    }
    return req;
}; 