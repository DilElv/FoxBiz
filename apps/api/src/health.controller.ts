import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}
  @Get()
  async health() {
    try { await this.prisma.$queryRaw`SELECT 1`; } catch { throw new ServiceUnavailableException('Database belum tersedia.'); }
    return {
      status: 'ok',
      service: 'foxbiz-api',
      environment: process.env.NODE_ENV ?? 'development',
      database: 'connected',
      timestamp: new Date().toISOString(),
    };
  }
}
