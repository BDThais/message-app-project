// One-off cleanup for numbers stored before signup started normalizing `tel`.
//
// Signup used to save the phone number exactly as typed, so a database can hold
// '+1 (415) 555-2671' next to '+14155552671'. GET /friend/search/:tel is an
// exact match on the canonical spelling, so it can never find the first one.
// This rewrites every users.tel to canonical E.164, using the same rule as
// signup (src/modules/account/signup.validator.ts, normalizeTel).
//
//   npm run db:normalize-tels               dry run: lists what would change
//   npm run db:normalize-tels -- --apply    writes the changes, in one transaction
//
// Reads DATABASE_URL from the environment or server/.env. Rows that need a human
// are never touched, and make the script exit with code 1:
//   - a number that is no longer valid (nothing to normalize it to);
//   - a group of accounts that would end up with the same number, whether they
//     already share it after normalizing or one of them already has it. The
//     unique constraint would reject the update, and which account keeps the
//     number is your call (merge or delete the others, then run this again).
import 'dotenv/config';
import pg from 'pg';
import { isValidPhoneNumber, parsePhoneNumberFromString } from 'libphonenumber-js';

const apply = process.argv.includes('--apply');
const unknownArgs = process.argv.slice(2).filter((arg) => arg !== '--apply');
if (unknownArgs.length > 0) {
  throw new Error(`Unknown argument(s): ${unknownArgs.join(' ')}. Usage: node scripts/normalize-tels.mjs [--apply]`);
}
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set (put it in server/.env or the environment).');
}

// Same gate as signup's normalizeTel: isValidPhoneNumber decides validity, the
// parser only produces the canonical spelling (an extension is dropped).
function normalizeTel(tel) {
  if (!isValidPhoneNumber(tel)) return null;

  return parsePhoneNumberFromString(tel)?.number ?? null;
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

try {
  const { rows: users } = await client.query('SELECT id, tel FROM users ORDER BY id');

  const invalid = [];
  const plan = users.map((user) => {
    const target = normalizeTel(user.tel);
    if (target === null) invalid.push(user);

    // A number that cannot be normalized keeps what it has.
    return { id: user.id, from: user.tel, to: target ?? user.tel };
  });

  // Every account ends up with `to`, so two accounts sharing one is a conflict.
  const byFinalTel = new Map();
  for (const entry of plan) {
    byFinalTel.set(entry.to, [...(byFinalTel.get(entry.to) ?? []), entry]);
  }
  const conflicts = [...byFinalTel.entries()].filter(([, entries]) => entries.length > 1);
  const conflictedIds = new Set(conflicts.flatMap(([, entries]) => entries.map((entry) => entry.id)));

  const changes = plan.filter((entry) => entry.from !== entry.to && !conflictedIds.has(entry.id));

  console.log(`${users.length} account(s) checked.`);
  if (changes.length === 0) {
    console.log('No number needs rewriting.');
  } else {
    console.log(`${changes.length} number(s) ${apply ? 'to rewrite' : 'would be rewritten'}:`);
    for (const { id, from, to } of changes) console.log(`  user ${id}: ${JSON.stringify(from)} -> ${to}`);
  }

  if (conflicts.length > 0) {
    console.log(`${conflicts.length} number(s) would be shared by several accounts, left alone:`);
    for (const [tel, entries] of conflicts) {
      console.log(`  ${tel}: ${entries.map((entry) => `user ${entry.id} (${JSON.stringify(entry.from)})`).join(', ')}`);
    }
  }
  if (invalid.length > 0) {
    console.log(`${invalid.length} number(s) are not valid phone numbers, left alone:`);
    for (const { id, tel } of invalid) console.log(`  user ${id}: ${JSON.stringify(tel)}`);
  }

  if (apply && changes.length > 0) {
    await client.query('BEGIN');
    try {
      for (const { id, from, to } of changes) {
        // `AND tel = from` makes a row that changed since the read a no-op
        // instead of overwriting it.
        await client.query('UPDATE users SET tel = $1 WHERE id = $2 AND tel = $3', [to, id, from]);
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
    console.log('Done.');
  } else if (!apply && changes.length > 0) {
    console.log('Dry run: nothing was written. Re-run with --apply to write these changes.');
  }

  if (conflicts.length > 0 || invalid.length > 0) process.exitCode = 1;
} finally {
  await client.end();
}
