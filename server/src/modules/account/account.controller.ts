import type { Request, Response, NextFunction } from 'express';
import { hashPassword, verifyPassword } from '../../lib/passwordHash';
import { validateAccountBody, checkDuplication, normalizeTel, uniqueViolationMessage } from './signup.validator';
import type { AccountBody } from './signup.validator';
import { validateLogin } from './login.validator';
import { validateUpdateProfileBody } from './profile.validator';
import { validateChangePasswordBody } from './password.validator';
import { validateDeleteAccountBody } from './deleteAccount.validator';
import { validateVerifyEmailBody } from './emailVerification.validator';
import { createUser, updateUserProfile, findPasswordHash, changePassword, deleteAccount, toPublicUser } from './account.service';
import { newVerificationToken, issueEmailVerification, verifyEmailToken } from './emailVerification.service';
import { sendVerificationEmail } from './emailVerification.mail';
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
    
        // The link's token row is stored with the user, in one statement.
        const verification = newVerificationToken();
        await createUser({
          name,
          email,
          tel: normalizedTel,
          passwordHash,
          emailVerification: verification
        });
    
        res.status(201).json({ message: 'Account created successfully'});

        // After responding, so the request never waits for the mail (see sendVerificationEmail,
        // which does not throw). Signup does not log in; the link is only mailed here.
        await sendVerificationEmail(email, verification.token);
    } catch (error: unknown) {
        // A concurrent signup took the email or phone number between the
        // duplicate check and the insert: the database refuses this one.
        const duplicationError = uniqueViolationMessage(error);
        if (duplicationError) {
          return res.status(409).json({ error: duplicationError });
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
  
    res.status(200).json({ user: toPublicUser(user) });
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

export async function deleteMe(req: Request, res: Response, next: NextFunction) {
  try {
    const validation = validateDeleteAccountBody(req.body);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.message });
    }

    const userId = req.user!.id;
    const currentHash = await findPasswordHash(userId);
    if (!currentHash || !(await verifyPassword(currentHash, validation.data.password))) {
      return res.status(401).json({ error: 'Password is incorrect' });
    }

    const result = await deleteAccount(userId, currentHash);
    if (result.status === 'only_admin') {
      return res.status(409).json({
        error: 'You are the only admin of a group room that still has other members. Make someone else an admin or delete the room first',
        chatIds: result.chatIds,
      });
    }
    if (result.status === 'stale_password') {
      // The password was changed by another request after we checked it.
      return res.status(401).json({ error: 'Password is incorrect' });
    }

    // The session row went with the user; the browser still holds the cookie.
    clearSessionCookie(res);
    res.status(204).end();
  } catch (error) {
    console.error('Error deleting account:', error);
    next(error);
  }
}

export async function verifyEmail(req: Request, res: Response, next: NextFunction) {
  try {
    const validation = validateVerifyEmailBody(req.body);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.message });
    }

    const result = await verifyEmailToken(validation.data.token);
    if (result.status === 'invalid') {
      // The same answer for an unknown, used, replaced or expired link.
      return res.status(400).json({ error: 'This verification link is invalid or has expired' });
    }

    res.status(204).end();
  } catch (error) {
    console.error('Error verifying email:', error);
    next(error);
  }
}

export async function resendEmailVerification(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await issueEmailVerification(req.user!.id);
    if (result.status === 'no_user') {
      // The account was deleted after requireUserAuth found the session.
      return res.status(401).json({ error: 'Unauthorized Access' });
    }
    if (result.status === 'already_verified') {
      return res.status(409).json({ error: 'Email is already verified' });
    }
    if (result.status === 'cooldown') {
      return res.status(429).json({ error: 'Please wait a minute before asking for another email' });
    }

    res.status(204).end();

    // After responding, as in signup.
    await sendVerificationEmail(result.email, result.token);
  } catch (error) {
    console.error('Error requesting a verification email:', error);
    next(error);
  }
}
