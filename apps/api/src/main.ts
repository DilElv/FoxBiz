import { ConfigService } from '@nestjs/config';
import { createApp } from './create-app';

async function bootstrap() {
  const app = await createApp();
  const config = app.get(ConfigService);
  await app.listen(config.get<number>('API_PORT', 4000), '127.0.0.1');
}

bootstrap().catch(() => { console.error('API startup failed. Check environment configuration and database availability.'); process.exitCode = 1; });
