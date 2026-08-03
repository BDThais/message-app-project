import { prisma } from '../lib/prisma';
import type { Request, Response } from 'express';
import { hashPassword } from '../lib/passwordHash';
import validator from 'validator';
import { isValidPhoneNumber } from 'libphonenumber-js';

type AccountBody = {
  name: string;
  email: string;
  tel: string;
  password: string;
};

const NAME_RE = /^[a-zA-Z0-9]+$/;

function validateName(name: string): string | null {
     if (!NAME_RE.test(name)) {
        return 'Name must contain only letters and numbers';
    }
    return null;
}

function validatePassword(password: string): string | null {
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

function validateTel(tel: string): string | null {
    if (!isValidPhoneNumber(tel)) {
        return 'Invalid phone number format';
    }
    return null;
}

function validateAccountBody(body: AccountBody): string | null {
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

async function checkDuplication(email: string, tel: string): Promise<string | null> {
    // Check for duplication in email or phone number
    const existingUser = await prisma.user.findFirst({
        where: {
            OR: [{ email }, { tel }]
        }
    });

    if (existingUser) {
        const field = existingUser.email === email ? 'Email' : 'Phone number';
        return `${field} already exists`;
    }

    return null;
}

export async function createAccount(req: Request, res: Response) {
    try {
        const { name, email, tel, password } = req.body as AccountBody;
            
        const validationError = validateAccountBody({ name, email, tel, password });
        if (validationError) {
          return res.status(400).json({ error: validationError });
        }
    
        const duplicationError = await checkDuplication(email, tel);
        if (duplicationError) {
          return res.status(409).json({ error: duplicationError });
        }
    
        const passwordHash = await hashPassword(password);
    
        await prisma.user.create({
          data: {
            name,
            email,
            tel,
            passwordHash
          }
        });
    
        res.status(201).json({ message: 'Account created successfully'});
    } catch (error: unknown) {
        // Handle Prisma unique constraint violation error
        const prismaError = error as { code?: string; meta?: { target?: string[] } };
        if (prismaError.code === 'P2002') {
          const target = prismaError.meta?.target ?? [];
          const field = target.includes('email') ? 'Email' : 'Phone number';
          return res.status(409).json({ error: `${field} already exists` });
        }

        console.error('Error creating account:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}