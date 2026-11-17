import { HttpException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes, createHash } from 'node:crypto';
import { verifyPassword } from './password';
import { PrismaService } from './prisma.service';
import { AuthenticatedUser } from './auth.types';
import { Prisma } from '@prisma/client';

const userInclude = { role: true, outlets: { include: { outlet: true } }, tenant: true } as const;
type AccessUser = Prisma.UserGetPayload<{ include: typeof userInclude }>;

@Injectable()
export class AuthService {
  private readonly attempts = new Map<string, { count: number; until: number }>();
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}

  async login(tenantSlug: string, email: string, password: string, client: string) {
    this.rateLimit(client);
    const user = await this.prisma.user.findFirst({ where: { email: email.toLowerCase(), status: 'active', tenant: { slug: tenantSlug, status: 'active' } }, include: userInclude });
    if (!user || !(await verifyPassword(password, user.passwordHash))) throw new UnauthorizedException('Bisnis, email, atau password tidak valid.');
    const rawToken = randomBytes(32).toString('base64url');
    const tokenHash = this.hash(rawToken);
    const ttlHours = Number(this.config.get('SESSION_TTL_HOURS', '8'));
    await this.prisma.$transaction(async (tx) => {
      await tx.session.create({ data: { userId: user.id, tenantId: user.tenantId, tokenHash, expiresAt: new Date(Date.now() + ttlHours * 60 * 60 * 1000) } });
      await tx.auditLog.create({ data: { tenantId: user.tenantId, actorUserId: user.id, action: 'auth.login', entityType: 'user', entityId: user.id } });
    });
    return { token: rawToken, user: this.toUser(user) };
  }

  async fromToken(token: string | undefined): Promise<AuthenticatedUser | null> {
    if (!token) return null;
    const session = await this.prisma.session.findUnique({ where: { tokenHash: this.hash(token) }, include: { user: { include: userInclude } } });
    if (!session || session.expiresAt <= new Date() || session.user.status !== 'active' || session.user.tenantId !== session.tenantId) return null;
    const tenant = await this.prisma.tenant.findUnique({ where: { id: session.tenantId }, select: { status: true } });
    if (tenant?.status !== 'active') return null;
    return this.toUser(session.user);
  }

  async logout(token: string | undefined) {
    if (token) await this.prisma.session.deleteMany({ where: { tokenHash: this.hash(token) } });
  }

  async outlets(user: AuthenticatedUser) {
    return this.prisma.outlet.findMany({ where: { tenantId: user.tenantId, status: 'active', ...(user.allOutlets ? {} : { id: { in: user.outletIds } }) }, select: { id: true, name: true, code: true } });
  }

  private rateLimit(client: string) {
    const now = Date.now();
    for (const [key, entry] of this.attempts) if (entry.until <= now) this.attempts.delete(key);
    if (this.attempts.size > 10000) throw new HttpException('Coba lagi sebentar.', 429);
    const entry = this.attempts.get(client) ?? { count: 0, until: now + 60000 };
    entry.count++;
    this.attempts.set(client, entry);
    if (entry.count > 10) throw new HttpException('Terlalu banyak percobaan. Coba lagi dalam satu menit.', 429);
  }

  private hash(value: string) { return createHash('sha256').update(value).digest('hex'); }
  private toUser(user: AccessUser): AuthenticatedUser {
    return { id: user.id, tenantId: user.tenantId, name: user.name, email: user.email, tenantName: user.tenant.name,
      role: user.role ? { id: user.role.id, code: user.role.code, name: user.role.name } : null,
      permissions: user.role?.permissions ?? [], allOutlets: user.allOutlets,
      outletIds: user.outlets.filter((membership) => membership.outlet.status === 'active').map((membership) => membership.outletId) };
  }
}
