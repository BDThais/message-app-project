// Manual end-to-end check of email verification and password reset with REAL mail.
//
// The automated tests never send a mail (they read an in-memory outbox), so this is the only
// thing that proves a mail really leaves through Resend and that its link works. It talks to a
// running server over HTTP, signs up a throwaway account with the address you give, and asks
// you to paste the link from each mail that arrives.
//
//   1. server/.env:  MAIL_TRANSPORT=resend
//                    RESEND_API_KEY=re_...
//                    MAIL_FROM=Message App <onboarding@resend.dev>
//      Until you verify a domain in Resend, onboarding@resend.dev delivers only to the address
//      of the Resend account itself (any other recipient is a 403), so use that address below.
//   2. npm run dev                                  (the server, in one terminal)
//   3. npm run try:email -- you@example.com         (this script, in another)
//
//   --url=http://localhost:3000   where the server listens (default: that)
//   --keep                        leave the throwaway account in the database
//
// Steps: sign up -> mail 1 (verification link) -> verify -> ask for a reset -> mail 2 (reset
// link) -> set a new password -> mail 3 (password changed notice) -> check the old session and
// both passwords -> delete the account again, so the same address works for the next run.
// Each paste prompt takes the whole link or just the token; an empty line stops the run (the
// account is still cleaned up). If a mail does not arrive, look in the spam folder and in the
// server's log: a failed send is logged there as "Could not send ...".
//
// Limits to know about: a reset can be asked for 3 times an hour per address, so run this at
// most 3 times an hour with the same address (a 429 means that).
import { randomBytes } from 'node:crypto';
import readline from 'node:readline';

const args = process.argv.slice(2);
const keep = args.includes('--keep');
const urlArg = args.find((arg) => arg.startsWith('--url='));
const base = (urlArg ? urlArg.slice('--url='.length) : 'http://localhost:3000').replace(/\/+$/, '');
const rest = args.filter((arg) => arg !== '--keep' && !arg.startsWith('--url='));
const usage = 'Usage: node scripts/try-email-flows.mjs <email> [--url=http://localhost:3000] [--keep]';
if (rest.length !== 1 || !rest[0].includes('@')) {
  console.error(usage);
  process.exit(2);
}
const email = rest[0];

class Stop extends Error {}

const rl = readline.createInterface({ input: process.stdin });
const lines = rl[Symbol.asyncIterator]();
async function ask(question) {
  process.stdout.write(question);
  const { value, done } = await lines.next();
  if (done) {
    throw new Stop('input closed');
  }
  return value.trim();
}

const step = (text) => console.log(`\n== ${text}`);
const ok = (text) => console.log(`   ok    ${text}`);
function expect(condition, text) {
  if (!condition) {
    throw new Error(`FAILED: ${text}`);
  }
  ok(text);
}

async function call(method, path, { body, cookie } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // 204 and other empty bodies
  }
  const setCookie = res.headers.getSetCookie?.()[0];
  return { status: res.status, json, text, cookie: setCookie ? setCookie.split(';')[0] : undefined };
}

// A mailed link ends in `#token=...`; accept the whole link, a link with `?token=`, or the bare token.
function tokenFrom(input) {
  const match = input.match(/[#?&]token=([^&\s]+)/);
  return match && match[1] ? match[1] : input;
}

async function pasteToken(what) {
  const input = await ask(`   Paste the link (or token) from the "${what}" mail, empty line to stop: `);
  if (!input) {
    throw new Stop('no link pasted');
  }
  return tokenFrom(input);
}

const suffix = randomBytes(4).toString('hex');
const account = {
  name: `Try${suffix}`,
  email,
  // 415-551-xxxx: a well-formed US number, which signup's validator accepts.
  tel: `+1415551${String(randomBytes(2).readUInt16BE() % 10000).padStart(4, '0')}`,
  password: `Tr1!x${randomBytes(6).toString('hex')}`,
};
const newPassword = `Tr2!y${randomBytes(6).toString('hex')}`;
let currentPassword = account.password;
let created = false;

async function cleanup() {
  if (!created) {
    return;
  }
  if (keep) {
    console.log(`\nKept the account (${email}, password ${currentPassword}) because of --keep.`);
    return;
  }
  const login = await call('POST', '/account/login', { body: { email, password: currentPassword } });
  if (login.status !== 200 || !login.cookie) {
    console.log(`\nCould not log in to delete the throwaway account (${login.status}): delete the row for ${email} by hand.`);
    return;
  }
  const del = await call('DELETE', '/account/me', { body: { password: currentPassword }, cookie: login.cookie });
  console.log(
    del.status === 204
      ? '\nDeleted the throwaway account.'
      : `\nCould not delete the throwaway account (${del.status} ${del.text}): delete the row for ${email} by hand.`
  );
}

let exitCode = 0;
try {
  step(`server at ${base}`);
  const probe = await call('GET', '/account/me').catch((error) => {
    throw new Error(`FAILED: cannot reach ${base} (${error.cause?.code ?? error.message}). Is "npm run dev" running?`);
  });
  expect(probe.status === 200, 'the server answers');

  step('1. sign up');
  const signup = await call('POST', '/account/signup', { body: account });
  if (signup.status === 409) {
    throw new Error(
      `FAILED: signup answered 409 (${signup.text}). If an earlier run stopped halfway, delete the leftover row for ${email} and run again.`
    );
  }
  expect(signup.status === 201, 'signup answered 201');
  created = true;

  step('2. verification mail');
  console.log(`   A mail "Confirm your email address" should arrive at ${email} within a few seconds.`);
  const verifyToken = await pasteToken('Confirm your email address');
  const bogus = await call('POST', '/account/email/verify', { body: { token: `${verifyToken}x` } });
  expect(bogus.status === 400, 'a changed token is refused (400)');
  const verify = await call('POST', '/account/email/verify', { body: { token: verifyToken } });
  expect(verify.status === 204, 'the link from the mail verifies the address (204)');
  const again = await call('POST', '/account/email/verify', { body: { token: verifyToken } });
  expect(again.status === 400, 'the same link a second time is refused (400)');
  const login1 = await call('POST', '/account/login', { body: { email, password: currentPassword } });
  expect(login1.status === 200 && !!login1.cookie, 'login works');
  const me = await call('GET', '/account/me', { cookie: login1.cookie });
  expect(me.json?.user?.emailVerified === true, 'GET /account/me says emailVerified: true');

  step('3. password reset mail');
  const request = await call('POST', '/account/password/reset-request', { body: { email } });
  expect(request.status === 202, 'reset-request answered 202');
  console.log(`   A mail "Reset your password" should arrive at ${email}.`);
  const resetToken = await pasteToken('Reset your password');
  const weak = await call('POST', '/account/password/reset', { body: { token: resetToken, new_password: 'weak' } });
  expect(weak.status === 400, 'a weak password is refused (400) without using up the link');
  const reset = await call('POST', '/account/password/reset', { body: { token: resetToken, new_password: newPassword } });
  expect(reset.status === 204, 'the link from the mail sets the new password (204)');
  currentPassword = newPassword;
  const reuse = await call('POST', '/account/password/reset', { body: { token: resetToken, new_password: `${newPassword}z` } });
  expect(reuse.status === 400, 'the same link a second time is refused (400)');

  step('4. after the reset');
  const old = await call('GET', '/account/me', { cookie: login1.cookie });
  expect(old.json?.user === null, 'the session from before the reset is signed out');
  const oldLogin = await call('POST', '/account/login', { body: { email, password: account.password } });
  expect(oldLogin.status === 401, 'the old password is refused (401)');
  const newLogin = await call('POST', '/account/login', { body: { email, password: newPassword } });
  expect(newLogin.status === 200, 'the new password works');
  const notice = (await ask('   Did a third mail, "Your password was changed", arrive? [y/n]: ')).toLowerCase();
  expect(notice === 'y' || notice === 'yes', 'the password-changed notice arrived');

  console.log('\nAll steps passed.');
} catch (error) {
  exitCode = 1;
  console.error(error instanceof Stop ? `\nStopped: ${error.message}.` : `\n${error.message}`);
} finally {
  await cleanup().catch((error) => console.error(`Cleanup failed: ${error.message}`));
  rl.close();
}
process.exit(exitCode);
