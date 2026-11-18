import { BadRequestException, ConflictException, HttpException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes, createHash } from 'node:crypto';
import { hashPassword, verifyPassword } from './password';
import { PrismaService } from './prisma.service';
import { AuthenticatedUser } from './auth.types';
import { Prisma } from '@prisma/client';
import { RegisterDto } from './auth.dto';
import { DEFAULT_ROLES } from './permissions';

const userInclude = { role: true, outlets: { include: { outlet: true } }, tenant: true } as const;
type AccessUser = Prisma.UserGetPayload<{ include: typeof userInclude }>;

@Injectable()
export class AuthService {
  private readonly attempts = new Map<string, { count: number; until: number }>();
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}

  async register(dto: RegisterDto, client: string) {
    this.rateLimit(`register:${client}`, 5);
    if (Buffer.byteLength(dto.password, 'utf8') > 72) throw new BadRequestException('Password maksimum 72 byte.');
    const passwordHash = await hashPassword(dto.password);
    const rawToken = randomBytes(32).toString('base64url');
    const user = await this.prisma.$transaction(async (tx) => {
      // Serialize registrations for one address, including requests on other API processes.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`register:${dto.email}`}, 0))::text`;
      if (await tx.user.findFirst({ where: { email: dto.email }, select: { id: true } })) throw new ConflictException('Email sudah terdaftar. Silakan masuk dengan akun Anda.');
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`business:${dto.tenantSlug}`}, 0))::text`;
      if (await tx.tenant.findFirst({ where: { slug: dto.tenantSlug }, select: { id: true } })) throw new ConflictException('Kode bisnis sudah digunakan. Pilih kode lain.');
      const tenant = await tx.tenant.create({ data: { name: dto.businessName, slug: dto.tenantSlug } });
      await tx.role.createMany({ data: DEFAULT_ROLES.map((role) => ({ ...role, tenantId: tenant.id })) });
      const ownerRole = await tx.role.findUniqueOrThrow({ where: { tenantId_code: { tenantId: tenant.id, code: 'owner' } } });
      await tx.outlet.create({ data: { tenantId: tenant.id, name: dto.outletName, code: dto.outletCode } });
      const owner = await tx.user.create({ data: { tenantId: tenant.id, name: dto.name, email: dto.email, passwordHash, roleId: ownerRole.id, allOutlets: true }, include: userInclude });
      await tx.session.create({ data: { userId: owner.id, tenantId: tenant.id, tokenHash: this.hash(rawToken), expiresAt: this.sessionExpiry() } });
      await tx.auditLog.create({ data: { tenantId: tenant.id, actorUserId: owner.id, action: 'auth.register', entityType: 'user', entityId: owner.id } });
      return owner;
    });
    return { token: rawToken, user: this.toUser(user) };
  }

  async login(tenantSlug: string | undefined, email: string, password: string, client: string) {
    this.rateLimit(client);
    if (Buffer.byteLength(password, 'utf8') > 72) throw new UnauthorizedException('Email atau password tidak valid.');
    const users = await this.prisma.user.findMany({ where: { email: email.trim().toLowerCase(), status: 'active', tenant: { ...(tenantSlug ? { slug: tenantSlug } : {}), status: 'active' } }, include: userInclude, take: 2 });
    if (users.length > 1) {
      // Ask for a business code only after proving knowledge of a password.
      const valid = await Promise.all(users.map((candidate) => verifyPassword(password, candidate.passwordHash)));
      if (valid.some(Boolean)) throw new ConflictException('Email digunakan di beberapa bisnis. Isi kode bisnis untuk memilih akun.');
    }
    const user = users.length === 1 ? users[0] : null;
    if (!user || !(await verifyPassword(password, user.passwordHash))) throw new UnauthorizedException('Bisnis, email, atau password tidak valid.');
    const rawToken = randomBytes(32).toString('base64url');
    const tokenHash = this.hash(rawToken);
    await this.prisma.$transaction(async (tx) => {
      await tx.session.create({ data: { userId: user.id, tenantId: user.tenantId, tokenHash, expiresAt: this.sessionExpiry() } });
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

  private sessionExpiry() { return new Date(Date.now() + Number(this.config.get('SESSION_TTL_HOURS', '8')) * 60 * 60 * 1000); }

  private rateLimit(client: string, limit = 10) {
    const now = Date.now();
    for (const [key, entry] of this.attempts) if (entry.until <= now) this.attempts.delete(key);
    if (this.attempts.size > 10000) throw new HttpException('Coba lagi sebentar.', 429);
    const entry = this.attempts.get(client) ?? { count: 0, until: now + 60000 };
    entry.count++;
    this.attempts.set(client, entry);
    if (entry.count > limit) throw new HttpException('Terlalu banyak percobaan. Coba lagi dalam satu menit.', 429);
  }

  private hash(value: string) { return createHash('sha256').update(value).digest('hex'); }
  private toUser(user: AccessUser): AuthenticatedUser {
    return { id: user.id, tenantId: user.tenantId, name: user.name, email: user.email, tenantName: user.tenant.name,
      role: user.role ? { id: user.role.id, code: user.role.code, name: user.role.name } : null,
      permissions: user.role?.permissions ?? [], allOutlets: user.allOutlets,
      outletIds: user.outlets.filter((membership) => membership.outlet.status === 'active').map((membership) => membership.outletId) };
  }
}
