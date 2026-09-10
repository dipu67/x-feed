import { prisma } from "./db/prisma.js";

console.log(await prisma.project.findMany())