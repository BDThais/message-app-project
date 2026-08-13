import { prisma } from '../lib/prisma';
import type { Request, Response } from 'express';
import { hashPassword } from '../lib/passwordHash';
import { validateAccountBody, checkDuplication } from './SignUpFormValidators';
import type { AccountBody } from './SignUpFormValidators';
import { validateLogin } from './LoginValidator';
import { createSession } from '../lib/session';

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

export async function login(req: Request, res: Response) {
  try {
  const { email, password } = req.body;
 
  if (typeof email !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Email and password are required' });
  }
 
  const user = await validateLogin(email, password);
  if (!user) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
 
  await createSession(res, user.id);
 
  res.status(200).json({
    user: { id: user.id, name: user.name, email: user.email, tel: user.tel },
  });
  } catch (error) {
    console.error('Error during login:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
