import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthenticatedRequest } from './auth.types';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService, private readonly config: ConfigService) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && request.headers.origin && request.headers.origin !== this.config.get<string>('WEB_ORIGIN')) throw new ForbiddenException('Origin tidak diizinkan.');
    const token = request.headers.authorization?.startsWith('Bearer ') ? request.headers.authorization.slice(7) : this.cookie(request.headers.cookie, 'foxbiz_session');
    const user = await this.auth.fromToken(token);
    if (!user) throw new UnauthorizedException('Sesi tidak valid atau sudah berakhir.');
    if (request.header('x-tenant-id') && request.header('x-tenant-id') !== user.tenantId) throw new ForbiddenException('Akses lintas tenant ditolak.');
    request.user = user;
    return true;
  }
  private cookie(header: string | undefined, key: string) { return header?.split(';').map((item) => item.trim()).find((item) => item.startsWith(`${key}=`))?.slice(key.length + 1); }
}
