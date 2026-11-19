import { normalizeEmail } from '../../lib/emailAddress';
import { hashPassword } from '../../lib/passwordHash';
import { createUser } from './account.service';
import { newVerificationToken, verifyEmailToken } from './emailVerification.service';
import { checkDuplication, normalizeTel, uniqueViolationMessage, validateAccountBody } from './signup.validator';

export type CreateVerifiedUserResult =
  | { status: 'created'; user: { id: number; name: string; email: string } }
  // The input failed the rules signup has (`message` says which).
  | { status: 'invalid'; message: string }
  // The email address or the phone number belongs to an account already.
  | { status: 'duplicate'; message: string };

/**
 * Makes an account whose address counts as verified without a mail being sent: for a deployment that has
 * no way to mail strangers (a free Resend plan sends only to its owner), and for the first accounts of
 * any deployment. It is signup without the mail: the same validation, the same duplicate check, the same
 * rows, and the address is verified through the same function a mailed link uses, with a token that is
 * never mailed. Not an endpoint: it runs where the database can be reached (see src/scripts/createVerifiedUser.ts).
 */
export async function createVerifiedUser(body: unknown): Promise<CreateVerifiedUserResult> {
  const validation = validateAccountBody(body);
  if (!validation.valid) return { status: 'invalid', message: validation.message };
  const { name, email, tel, password } = validation.data;

  const normalizedTel = normalizeTel(tel)!;
  const normalizedEmail = normalizeEmail(email);

  const duplicate = await checkDuplication(normalizedEmail, normalizedTel);
  if (duplicate) return { status: 'duplicate', message: duplicate };

  const verification = newVerificationToken();
  let user;
  try {
    user = await createUser({
      name,
      email: normalizedEmail,
      tel: normalizedTel,
      passwordHash: await hashPassword(password),
      emailVerification: verification,
    });
  } catch (error) {
    // Somebody took the address between the check and the insert.
    const taken = uniqueViolationMessage(error);
    if (taken) return { status: 'duplicate', message: taken };
    throw error;
  }

  const verified = await verifyEmailToken(verification.token);
  if (verified.status !== 'verified') throw new Error('The new account could not be verified');

  return { status: 'created', user: { id: user.id, name: user.name, email: user.email } };
}
