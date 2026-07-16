import { prisma } from '@services/prisma';

const email = process.env.SEED_USER_EMAIL ?? 'admin@quantswing.local';
const password = process.env.SEED_USER_PASSWORD ?? 'ChangeMe123!';

const BCRYPT_COST = 10;

const run = async () => {
  const passwordHash = await Bun.password.hash(password, {
    algorithm: 'bcrypt',
    cost: BCRYPT_COST,
  });
  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, passwordHash, name: 'Principal User' },
  });
  console.log(`Seeded user: ${user.email} (${user.id})`);
};

run()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
