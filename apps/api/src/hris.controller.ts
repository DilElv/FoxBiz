import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { AuthGuard } from './auth.guard';
import { AuthenticatedRequest } from './auth.types';
import { AttendanceEventDto, EmployeeDto } from './hris.dto';
import { HrisService } from './hris.service';
import { PermissionGuard, RequirePermission } from './permissions';

const photoLimit = 5 * 1024 * 1024;
const upload = { limits: { fileSize: photoLimit, files: 1 } };

@Controller('hris')
@UseGuards(AuthGuard, PermissionGuard)
export class HrisController {
  constructor(private readonly hris: HrisService) {}
  @Get('employees') @RequirePermission('hris.read') employees(@Req() req: AuthenticatedRequest, @Query('search') search?: string, @Query('page') page?: string) { return this.hris.employees(req.user!, search, page); }
  @Post('employees') @RequirePermission('hris.employees.write') createEmployee(@Req() req: AuthenticatedRequest, @Body() dto: EmployeeDto) { return this.hris.saveEmployee(req.user!, dto); }
  @Patch('employees/:id') @RequirePermission('hris.employees.write') updateEmployee(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: EmployeeDto) { return this.hris.saveEmployee(req.user!, dto, id); }
  @Get('kiosk') @RequirePermission('hris.attendance.kiosk') kiosk(@Req() req: AuthenticatedRequest, @Query('outletId', ParseUUIDPipe) outletId: string) { return this.hris.kiosk(req.user!, outletId); }
  @Post('attendance/clock-in') @RequirePermission('hris.attendance.kiosk') @UseInterceptors(FileInterceptor('photo', upload))
  clockIn(@Req() req: AuthenticatedRequest, @Body() dto: AttendanceEventDto, @UploadedFile() photo?: Express.Multer.File) {
    if (!photo?.buffer?.length) throw new BadRequestException('Foto absen masuk wajib diambil.');
    return this.hris.clockIn(req.user!, dto, photo.buffer);
  }
  @Post('attendance/clock-out') @RequirePermission('hris.attendance.kiosk') @UseInterceptors(FileInterceptor('photo', upload))
  clockOut(@Req() req: AuthenticatedRequest, @Body() dto: AttendanceEventDto, @UploadedFile() photo?: Express.Multer.File) {
    if (!photo?.buffer?.length) throw new BadRequestException('Foto absen pulang wajib diambil.');
    return this.hris.clockOut(req.user!, dto, photo.buffer);
  }
  @Get('attendance') @RequirePermission('hris.read') recap(@Req() req: AuthenticatedRequest, @Query('outletId', ParseUUIDPipe) outletId: string, @Query('from') from: string, @Query('to') to: string, @Query('page') page?: string) { return this.hris.recap(req.user!, outletId, from, to, page); }
  @Get('attendance/monthly') @RequirePermission('hris.read') monthly(@Req() req: AuthenticatedRequest, @Query('outletId', ParseUUIDPipe) outletId: string, @Query('from') from: string, @Query('to') to: string) { return this.hris.monthly(req.user!, outletId, from, to); }
  @Get('attendance/export') @RequirePermission('hris.read') async export(@Req() req: AuthenticatedRequest, @Res() res: Response, @Query('outletId', ParseUUIDPipe) outletId: string, @Query('from') from: string, @Query('to') to: string, @Query('mode') mode = 'daily') {
    const { buffer, filename } = await this.hris.exportPdf(req.user!, outletId, from, to, mode);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', String(buffer.length));
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(buffer);
  }
  @Get('attendance/:id/photo/:kind') @RequirePermission('hris.read') async photo(@Req() req: AuthenticatedRequest, @Res() res: Response, @Param('id', ParseUUIDPipe) id: string, @Param('kind') kind: string, @Query('download') download?: string) {
    const { stream, filename } = await this.hris.photo(req.user!, id, kind);
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Content-Disposition', `${download === '1' ? 'attachment' : 'inline'}; filename="${filename}"`);
    res.setHeader('Cache-Control', 'private, max-age=60');
    stream.on('error', () => { if (!res.headersSent) res.status(404); res.end(); });
    stream.pipe(res);
  }
}
