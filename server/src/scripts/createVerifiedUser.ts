// Makes a verified account in the database DATABASE_URL points at, without sending any mail:
//
//   USER_PASSWORD='Str0ng!Pass' DATABASE_URL='postgresql://...' \
//     npx tsx src/scripts/createVerifiedUser.ts DemoOne demo1@example.com +84901234567
//
// The password comes from the environment and not from an argument, so that it does not end up in the shell
// history or the process list. The same rules as signup apply (a name of letters and digits only, a strong
// password, a phone number in international form). Exit code 0 when the account was made, 1 when it was
// refused (the reason is printed), 2 for a wrong call.

import { prisma } from '../lib/prisma';
import { createVerifiedUser } from '../modules/account/verifiedUser.service';

const [name, email, tel] = process.argv.slice(2);
const password = process.env.USER_PASSWORD;

if (!name || !email || !tel || !password) {
  console.error(
    'Usage: USER_PASSWORD=... npx tsx src/scripts/createVerifiedUser.ts <name> <email> <phone, like +84901234567>',
  );
  process.exit(2);
}

try {
  const result = await createVerifiedUser({ name, email, tel, password });
  if (result.status === 'created') {
    console.log(`Created the verified account ${result.user.name} <${result.user.email}> (id ${result.user.id})`);
  } else {
    console.error(`Not created: ${result.message}`);
    process.exitCode = 1;
  }
} finally {
  await prisma.$disconnect();
}
