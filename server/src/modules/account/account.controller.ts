import type { Request, Response, NextFunction } from 'express';
import { hashPassword, verifyPassword } from '../../lib/passwordHash';
import { validateAccountBody, checkDuplication, normalizeTel } from './signup.validator';
import type { AccountBody } from './signup.validator';
import { validateLogin } from './login.validator';
import { validateUpdateProfileBody } from './profile.validator';
import { validateChangePasswordBody } from './password.validator';
import { createUser, updateUserProfile, findPasswordHash, changePassword } from './account.service';
import { createSession, deleteSession } from './session.service';
import { getSessionUser, setSessionCookie, clearSessionCookie } from '../../middlewares/SessionCookie';
import config from '../../config/config';

export async function signup(req: Request, res: Response, next: NextFunction) {
    try {
        const { name, email, tel, password } = req.body as AccountBody;
            
        const validationError = validateAccountBody({ name, email, tel, password });
        if (validationError) {
          return res.status(400).json({ error: validationError });
        }
    
        // validateAccountBody accepted tel, so it normalizes. Both the duplicate
        // check and the insert use the canonical form, never the raw input.
        const normalizedTel = normalizeTel(tel)!;

        const duplicationError = await checkDuplication(email, normalizedTel);
        if (duplicationError) {
          return res.status(409).json({ error: duplicationError });
        }
    
        const passwordHash = await hashPassword(password);
    
        await createUser({
          name,
          email,
          tel: normalizedTel,
          passwordHash
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
        next(error);
    }
}

export async function login(req: Request, res: Response, next: NextFunction) {
  try {
    const { email, password } = req.body;
  
    if (typeof email !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: 'Email and password are required' });
    }
  
    const user = await validateLogin(email, password);
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
  
    const session = await createSession(user.id);
    setSessionCookie(res, session);
  
    res.status(200).json({
      user: { id: user.id, name: user.name, email: user.email, tel: user.tel, avatarUrl: user.avatarUrl },
    });
  } catch (error) {
    console.error('Error during login:', error);
    next(error);
  }
}

export async function me(req: Request, res: Response, next: NextFunction) {
  try {
    const user = await getSessionUser(req, res);
    res.status(200).json({ user });
  } catch (error) {
    console.error('Error fetching user session:', error);
    next(error);
  }
}

export async function logout(req: Request, res: Response, next: NextFunction) {
  try {
    const sessionId = req.cookies?.[config.SESSION_COOKIE];
  
    if (sessionId) {
      await deleteSession(sessionId);
    }
  
    clearSessionCookie(res);
    res.status(200).json({ user: null });
  } catch (error) {
    console.error('Error during logout:', error);
    next(error);
  }
}

export async function updateMe(req: Request, res: Response, next: NextFunction) {
  try {
    const validation = validateUpdateProfileBody(req.body);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.message });
    }

    const user = await updateUserProfile(req.user!.id, validation.data);
    res.status(200).json({ user });
  } catch (error) {
    console.error('Error updating profile:', error);
    next(error);
  }
}

export async function updatePassword(req: Request, res: Response, next: NextFunction) {
  try {
    const validation = validateChangePasswordBody(req.body);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.message });
    }
    const { currentPassword, newPassword } = validation.data;

    const userId = req.user!.id;
    const currentHash = await findPasswordHash(userId);
    if (!currentHash || !(await verifyPassword(currentHash, currentPassword))) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    // requireUserAuth found this session through the same cookie, so it exists.
    const currentSessionId: string = req.cookies[config.SESSION_COOKIE];
    const newHash = await hashPassword(newPassword);

    const changed = await changePassword(userId, currentHash, newHash, currentSessionId);
    if (!changed) {
      // The password was changed by another request after we checked it, so
      // what the client sent is no longer the current password.
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    res.status(204).end();
  } catch (error) {
    console.error('Error changing password:', error);
    next(error);
  }
}
