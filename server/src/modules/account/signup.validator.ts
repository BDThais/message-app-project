import validator from 'validator';
import { isValidPhoneNumber, parsePhoneNumberFromString } from 'libphonenumber-js';
import { Prisma } from '../../generated/prisma/client';
import { isRecord } from '../../lib/validation';
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

const EMAIL_EXISTS = 'Email already exists';
const TEL_EXISTS = 'Phone number already exists';

export async function checkDuplication(email: string, tel: string): Promise<string | null> {
    // Check for duplication in email or phone number
    const existingUser = await findExistingUser(email, tel);

    if (existingUser) {
        return existingUser.email === email ? EMAIL_EXISTS : TEL_EXISTS;
    }

    return null;
}

/**
 * The names the database gives for the column(s) or constraint of a unique
 * violation. Where Prisma puts them depends on how the client is set up: with
 * a driver adapter (this project's PrismaPg) in
 * meta.driverAdapterError.cause.constraint, as `fields` (column names) or
 * `index` (the constraint's name, e.g. users_email_key); without one in
 * meta.target, a list of columns or a constraint name. All of them are read,
 * so a change of setup does not silently turn every answer into one message.
 */
function uniqueViolationNames(meta: unknown): string[] {
    if (!isRecord(meta)) return [];

    const names: string[] = [];
    const collect = (value: unknown) => {
        if (typeof value === 'string') names.push(value);
        else if (Array.isArray(value)) value.forEach(collect);
    };

    collect(meta.target);
    const cause = isRecord(meta.driverAdapterError) ? meta.driverAdapterError.cause : undefined;
    const constraint = isRecord(cause) ? cause.constraint : undefined;
    if (isRecord(constraint)) {
        collect(constraint.fields);
        collect(constraint.index);
    }

    return names;
}

/**
 * The 409 message for a unique violation raised by the insert in signup, or
 * null when `error` is something else. checkDuplication runs before the
 * insert and is not atomic with it: two requests with the same email or phone
 * number can both pass it, and the database then refuses the second insert.
 * The message names the column that really collided, the same wording
 * checkDuplication uses. When the error does not say which one it was (`users`
 * has only these two unique columns besides its id), the message names both
 * instead of guessing one.
 */
export function uniqueViolationMessage(error: unknown): string | null {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
        return null;
    }

    const names = uniqueViolationNames(error.meta);
    if (names.some((name) => name.includes('email'))) return EMAIL_EXISTS;
    if (names.some((name) => name.includes('tel'))) return TEL_EXISTS;

    return 'Email or phone number already exists';
}