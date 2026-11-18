import { Body, Controller, ForbiddenException, Get, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { AuthenticatedRequest } from './auth.types';
import { LoginDto, RegisterDto } from './auth.dto';

@Controller()
export class AuthController {
  constructor(private readonly auth: AuthService, private readonly config: ConfigService) {}

  @Post('auth/register')
  async register(@Body() body: RegisterDto, @Req() request: AuthenticatedRequest, @Res({ passthrough: true }) response: Response) {
    this.checkOrigin(request);
    const result = await this.auth.register(body, request.ip ?? 'local');
    this.setSession(response, result.token);
    return { user: result.user };
  }

  @Post('auth/login')
  async login(@Body() body: LoginDto, @Req() request: AuthenticatedRequest, @Res({ passthrough: true }) response: Response) {
    this.checkOrigin(request);
    const result = await this.auth.login(body.tenantSlug, body.email, body.password, request.ip ?? 'local');
    this.setSession(response, result.token);
    return { user: result.user };
  }

  @Get('me')
  @UseGuards(AuthGuard)
  me(@Req() request: AuthenticatedRequest) { return { user: request.user, tenantId: request.user?.tenantId }; }

  @Post('auth/logout')
  @UseGuards(AuthGuard)
  async logout(@Req() request: AuthenticatedRequest, @Res({ passthrough: true }) response: Response) {
    this.checkOrigin(request);
    const token = request.headers.cookie?.split(';').map((item) => item.trim()).find((item) => item.startsWith('foxbiz_session='))?.slice(15) ?? request.headers.authorization?.slice(7);
    await this.auth.logout(token);
    response.clearCookie('foxbiz_session', { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/' });
    return { success: true };
  }

  @Get('foundation/outlets')
  @UseGuards(AuthGuard)
  async outlets(@Req() request: AuthenticatedRequest) {
    return { outlets: await this.auth.outlets(request.user!) };
  }

  private checkOrigin(request: AuthenticatedRequest) {
    if (request.headers.origin && request.headers.origin !== this.config.get<string>('WEB_ORIGIN')) throw new ForbiddenException('Origin tidak diizinkan.');
  }

  private setSession(response: Response, token: string) {
    response.cookie('foxbiz_session', token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: Number(this.config.get('SESSION_TTL_HOURS', '8')) * 60 * 60 * 1000, path: '/' });
  }
}
