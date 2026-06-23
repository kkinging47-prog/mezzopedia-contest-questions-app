import bcrypt from 'bcryptjs';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const rl = readline.createInterface({ input, output });
const password = await rl.question('Enter the password to hash: ');
rl.close();

if (!password || password.length < 10) {
  console.error('Use a stronger password with at least 10 characters.');
  process.exit(1);
}

const hash = await bcrypt.hash(password, 12);
console.log('\nPaste this into Vercel as ADMIN_PASSWORD_HASH:\n');
console.log(hash);
