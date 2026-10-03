import validator from 'validator';
import { isValidPhoneNumber, parsePhoneNumberFromString } from 'libphonenumber-js';
import { findExistingUser } from './account.service';

export type AccountBody = {
  name: string;
  email: string;
  tel: string;
  password: string;
};

const NAME_RE = /^[a-zA-Z0-9]+$/;

export function validateName(name: string): string | null {
     if (!NAME_RE.test(name)) {
        return 'Name must contain only letters and numbers';
    }
    return null;
}

export function validatePassword(password: string): string | null {
    if (password.length < 8) {
        return 'Password must be at least 8 characters long';
    }
    if (!/[A-Z]/.test(password)) {
        return 'Password must contain at least one uppercase letter';
    }
    if (!/[a-z]/.test(password)) {
        return 'Password must contain at least one lowercase letter';
    }
    if (!/[0-9]/.test(password)) {
        return 'Password must contain at least one number';
    }
    if (!/[^A-Za-z0-9\s]/.test(password)) {
        return 'Password must contain at least one special character';
    }
    return null;
}

function validateEmail(email: string): string | null {
    if (!validator.isEmail(email)) {
        return 'Invalid email format';
    }
    return null;
}

/**
 * The canonical E.164 spelling of a phone number ('+' and digits only), or null
 * when the number is not valid. Signup stores this form, not what was typed:
 * isValidPhoneNumber also accepts spaces, dashes, parentheses, non-ASCII digits
 * and extensions, and the unique constraint on `tel` compares raw strings, so
 * '+1 (415) 555-2671' and '+14155552671' would otherwise both register, and
 * GET /friend/search/:tel (an exact match) could never find the first one.
 * An extension is not part of E.164 and is dropped.
 *
 * isValidPhoneNumber stays the gate on purpose: it rejects a few inputs that
 * parsePhoneNumberFromString(...).isValid() alone would let through (leading
 * whitespace, a trailing newline), so the set of numbers signup accepts does
 * not change.
 */
export function normalizeTel(tel: string): string | null {
    if (!isValidPhoneNumber(tel)) return null;

    return parsePhoneNumberFromString(tel)?.number ?? null;
}

function validateTel(tel: string): string | null {
    if (normalizeTel(tel) === null) {
        return 'Invalid phone number format';
    }
    return null;
}

export function validateAccountBody(body: AccountBody): string | null {
    const { name, email, tel, password } = body;

    if (!name || !email || !tel || !password) {
        return 'All fields are required';
    }

    return (
        validateName(name) ??
        validateEmail(email) ??
        validateTel(tel) ??
        validatePassword(password)
    );
}

export async function checkDuplication(email: string, tel: string): Promise<string | null> {
    // Check for duplication in email or phone number
    const existingUser = await findExistingUser(email, tel);

    if (existingUser) {
        const field = existingUser.email === email ? 'Email' : 'Phone number';
        return `${field} already exists`;
    }

    return null;
}