import { prisma } from "../db/prisma.js";
import { hashPassword } from "../auth/password.js";

const [email, password] = process.argv.slice(2);
if (!email || !password ) {
  console.error("usage: npx tsx create-user.mts <email> <password-12+chars>");
  process.exit(1);
}
const user = await prisma.user.create({
  data: { email, passwordHash: await hashPassword(password) },
});
console.log("user id:", user.id);
await prisma.$disconnect();