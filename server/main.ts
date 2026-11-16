/**
 * Server executable entrypoint.
 * Starts the local backend server on loopback interface (127.0.0.1).
 */

import { AppServer } from './server.js';

const args = process.argv.slice(2);
const isDemo =
  args.includes('--demo') ||
  process.env.MK_DEMO === '1' ||
  process.env.MK_DEMO === 'true';

const isDev =
  args.includes('--dev') ||
  process.env.NODE_ENV === 'development';

const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3210;

const server = new AppServer({
  port,
  isDemo,
  isDev,
});

async function main() {
  const info = await server.start();
  console.log(`\n=============================================================`);
  console.log(`  🚀 سرور محلی مکتب‌خونه با موفقیت راه‌اندازی شد`);
  console.log(`  📡 نشانی: http://${info.host}:${info.port}`);
  console.log(`  🔒 اتصال: صرفاً لوپ‌بک محلی (Loopback Only)`);
  if (isDemo) {
    console.log(`  🧪 حالت نمایشی (Demo Mode): فعال (داده‌ها کاملاً ایزوله هستند)`);
  }
  if (isDev) {
    console.log(`  🛠️  حالت توسعه (Dev Mode): مبدا Vite (5173) مجاز است`);
  }
  console.log(`=============================================================\n`);

  const shutdown = async () => {
    console.log('\nدر حال توقف سرور محلی...');
    await server.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('خطای مهلک در راه‌اندازی سرور:', err);
  process.exit(1);
});
