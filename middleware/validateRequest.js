import { validationResult } from 'express-validator';

export const validateRequest = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({
            success: false,
            errors: errors.array().map(err => ({
                field: err.param,
                message: err.msg
            }))
        });
    }
    next();
};

// Common validation rules
export const commonValidations = {
    id: (field = 'id') => ({
        in: ['params'],
        isMongoId: true,
        errorMessage: 'Invalid ID format'
    }),

    email: (field = 'email') => ({
        in: ['body'],
        isEmail: true,
        normalizeEmail: true,
        errorMessage: 'Invalid email format'
    }),

    password: (field = 'password') => ({
        in: ['body'],
        isLength: {
            min: 6,
            errorMessage: 'Password must be at least 6 characters long'
        },
        matches: {
            options: /^(?=.*\d)(?=.*[a-z])(?=.*[A-Z])/,
            errorMessage: 'Password must contain at least one uppercase letter, one lowercase letter, and one number'
        }
    }),

    name: (field = 'name') => ({
        in: ['body'],
        isLength: {
            min: 2,
            max: 50,
            errorMessage: 'Name must be between 2 and 50 characters'
        },
        trim: true
    }),

    phone: (field = 'phone') => ({
        in: ['body'],
        isMobilePhone: true,
        errorMessage: 'Invalid phone number format'
    }),

    date: (field = 'date') => ({
        in: ['body'],
        isISO8601: true,
        errorMessage: 'Invalid date format'
    }),

    number: (field = 'number') => ({
        in: ['body'],
        isNumeric: true,
        errorMessage: 'Must be a valid number'
    }),

    boolean: (field = 'boolean') => ({
        in: ['body'],
        isBoolean: true,
        errorMessage: 'Must be a boolean value'
    })
}; 