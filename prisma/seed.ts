import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { hashPassword } from '../src/common/utils/hash.util';
import { Role } from '../src/common/enums/role.enum';
import { Provider } from '../src/generated/prisma/client';

async function seed() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is not defined');
  }

  const adapter = new PrismaPg({ connectionString });
  const prisma = new PrismaClient({ adapter });

  console.log('[Seed] Checking for existing SuperAdmin...');

  const existingSuperAdmin = await prisma.user.findFirst({
    where: { role: Role.SUPER_ADMIN },
  });

  if (existingSuperAdmin) {
    console.log(
      `[Seed] SuperAdmin account already exists (${existingSuperAdmin.email}). No action taken.`,
    );
    await prisma.$disconnect();
    return;
  }

  const email =
    process.env.SUPER_ADMIN_EMAIL?.trim() || 'superadmin@purple-bd.com';
  const password =
    process.env.SUPER_ADMIN_PASSWORD || 'SuperSecretPassword123!';
  const fullName =
    process.env.SUPER_ADMIN_NAME?.trim() || 'System Super Admin';

  const hashedPassword = await hashPassword(password);

  const existingUserWithEmail = await prisma.user.findUnique({
    where: { email },
  });

  if (existingUserWithEmail) {
    await prisma.user.update({
      where: { id: existingUserWithEmail.id },
      data: {
        role: Role.SUPER_ADMIN,
        password: hashedPassword,
        isVerified: true,
        fullName,
      },
    });
    console.log(
      `[Seed] Existing user (${email}) elevated to SUPER_ADMIN role successfully.`,
    );
  } else {
    await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        fullName,
        role: Role.SUPER_ADMIN,
        isVerified: true,
        provider: Provider.LOCAL,
      },
    });
    console.log(`[Seed] SuperAdmin account created successfully: ${email}`);
  }

  await prisma.$disconnect();
}

seed().catch((e) => {
  console.error('[Seed] Error during seeding:', e);
  process.exit(1);
});
