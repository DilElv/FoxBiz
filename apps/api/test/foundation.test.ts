import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyPassword } from '../src/password';
import { validateEnvironment } from '../src/environment';
import { validate } from 'class-validator';
import { RoleDto } from '../src/sprint1.dto';
import { PERMISSIONS } from '../src/permissions';

test('password hashing verifies valid passwords and rejects incorrect passwords', async () => {
  const value = 'foundation-test-password';
  const encoded = await hashPassword(value);
  assert.notEqual(encoded, value);
  assert.equal(await verifyPassword(value, encoded), true);
  assert.equal(await verifyPassword('incorrect-password', encoded), false);
});

test('startup rejects invalid database, port, ttl and production origin', () => {
  assert.throws(() => validateEnvironment({}), /DATABASE_URL/);
  const base = { DATABASE_URL: 'postgresql://localhost/test' };
  assert.throws(() => validateEnvironment({ ...base, API_PORT: 0 }), /API_PORT/);
  assert.throws(() => validateEnvironment({ ...base, SESSION_TTL_HOURS: 100 }), /SESSION_TTL/);
  assert.throws(() => validateEnvironment({ ...base, NODE_ENV: 'production' }), /HTTPS/);
  assert.equal(validateEnvironment(base).API_PORT, 4000);
});

test('roles accept the complete permission catalog and reject unknown permissions', async () => {
  const role: RoleDto = Object.assign(new RoleDto(), { name: 'Full access', permissions: [...PERMISSIONS] });
  assert.deepEqual(await validate(role), []);
  role.permissions = ['unknown.permission'];
  assert.ok((await validate(role)).some((error) => error.property === 'permissions'));
});
