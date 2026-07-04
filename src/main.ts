import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { bootstrapDatabase } from './database/bootstrap';

async function bootstrap() {
  // Applies schema/views/RLS on first boot (and re-applies RLS on
  // every boot, safely — see bootstrap.ts). Runs against whatever
  // single connection role the environment provides; FORCE ROW LEVEL
  // SECURITY in 04_row_level_security.sql means this is safe even if
  // that role happens to be the database owner, which is what most
  // managed Postgres providers (Render included) actually give you.
  //
  // RUN_DB_BOOTSTRAP defaults to on; set it to "false" to skip this
  // entirely, e.g. if the database was already prepared through some
  // other process.
  if (process.env.RUN_DB_BOOTSTRAP !== 'false') {
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
      throw new Error('DATABASE_URL is not set — cannot bootstrap the database.');
    }
    await bootstrapDatabase(dbUrl);
  }

  const app = await NestFactory.create(AppModule);
  // Allow requests from any origin — needed because the frontend
  // (the Claude artifact) runs on claude.ai, a completely different
  // domain from the Render backend. Without this, the browser blocks
  // every request before it even reaches our handlers, which shows up
  // as "Can't reach the server" even when the backend is genuinely
  // running and healthy. Confirmed as the real cause: Render logs
  // showed [bootstrap] completing successfully (backend up, no crash)
  // while the client still got a network error — classic CORS block.
  app.enableCors();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  // Render's load balancer connects to the container over its internal
  // network, not "localhost" inside the container — binding only to
  // localhost (NestJS's default) makes the app unreachable from
  // outside the container even though it's running and healthy
  // internally, which shows up as a confusing deploy timeout rather
  // than a clear error. '0.0.0.0' binds to all interfaces.
  await app.listen(process.env.PORT ?? 3000, '0.0.0.0');
}
bootstrap();
