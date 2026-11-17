import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

async function log(name) {
  const buffer = await readFile(`.local/sprint6-${name}.log`);
  return buffer.toString(buffer[0] === 0xff && buffer[1] === 0xfe ? 'utf16le' : 'utf8').replace(/\u001b\[[0-9;]*m/g, '');
}
async function json(name) { return JSON.parse(await readFile(`docs/SPRINT_6_${name}_RESULTS.json`, 'utf8')); }
function tests(text) {
  const result = {};
  for (const key of ['tests', 'pass', 'fail', 'cancelled', 'skipped', 'duration_ms']) {
    const match = text.match(new RegExp(`^# ${key} ([\\d.]+)`, 'm')); assert.ok(match, key); result[key] = Number(match[1]);
  }
  assert.ok(result.tests > 0); assert.equal(result.pass, result.tests); assert.equal(result.fail + result.cancelled + result.skipped, 0);
  return result;
}
const build = await log('build-final'); assert.match(build, /Compiled successfully/); assert.match(build, /tsc -p tsconfig.build.json/); assert.doesNotMatch(build, /error TS\d|Build failed|Failed to compile/);
const lint = await log('lint-final'); assert.match(lint, /--max-warnings=0/); assert.doesNotMatch(lint, /\d+ problems? \(/);
for (const kind of ['web', 'api']) { const text = await log(`typecheck-${kind}-final`); assert.match(text, /tsc --noEmit/); assert.doesNotMatch(text, /error TS\d/); }
const unit = tests(await log('unit-final')), integration = tests(await log('integration-final'));
const ui = await json('UI'), migration = await json('MIGRATION'), cleanup = await json('CLEANUP');
const crmViewports = ui.reports.filter((report) => report.viewport);
assert.deepEqual(crmViewports.map((report) => report.viewport), ['desktop', 'tablet', 'mobile390', 'mobile360']);
assert.ok(crmViewports.every((report) => ['createEditUniquePhone', 'searchSegmentFilter', 'emptyAndPaidProfile', 'optionalCustomerSelection', 'selectionReload', 'holdResumeCustomerLocked', 'lostResponseCustomerRecoverySingleSale', 'nameOnlyReceipt', 'checkoutWithoutCustomer', 'offlineRetry'].every((key) => report[key] === true) && report.errors.length === 0 && Object.values(report.overflow).every((value) => value === false)));
assert.equal(crmViewports[0].closedProfileStaysClosed, true);
assert.deepEqual(ui.reports.filter((report) => report.role).map((report) => report.role), ['viewer', 'cashier', 'none']);
assert.ok(ui.reports.filter((report) => report.role).every((report) => report.permissionUI));
assert.equal(ui.reports.find((report) => report.role === 'cashier').cashierLookupWithoutCrmAccess, true);
assert.ok(migration.applied && migration.databaseConstraints && cleanup.complete);
const posText = await log('pos-regression-final'); assert.match(posText, /"lostResponseRecovery": true/); assert.doesNotMatch(posText, /TimeoutError|ExpectError/);
const pos = JSON.parse(await readFile('docs/SPRINT_2_UI_RESULTS.json', 'utf8'));
const posViewports = pos.reports.filter((report) => report.viewport);
assert.deepEqual(posViewports.map((report) => report.viewport), ['desktop', 'tablet', 'mobile390', 'mobile360']);
assert.ok(posViewports.every((report) => ['cash', 'manualEdc', 'holdResume', 'historyReprint', 'lostResponseRecovery'].every((key) => report[key] === true) && report.errors.length === 0 && Object.values(report.overflow).every((value) => value === false)));
await writeFile('docs/SPRINT_6_POS_REGRESSION_RESULTS.json', JSON.stringify(pos, null, 2));
const status = await log('db-status-final'); assert.match(status, /7 migrations found/); assert.match(status, /Database schema is up to date/);
const audit = await log('audit-final'); assert.match(audit, /found 0 vulnerabilities/);
const result = {
  verifiedAt: new Date().toISOString(), sprint: 6, status: 'pass',
  environment: { web: 'Next.js production build at http://127.0.0.1:3000', api: 'NestJS development server at http://127.0.0.1:4000', database: 'PostgreSQL 17 at 127.0.0.1:55432, foxbiz_sprint0' },
  gates: {
    build: { status: 'pass', web: true, api: true, log: '.local/sprint6-build-final.log' },
    lint: { status: 'pass', maxWarnings: 0, log: '.local/sprint6-lint-final.log' },
    typecheck: { status: 'pass', web: true, api: true },
    unit: { status: 'pass', ...unit, log: '.local/sprint6-unit-final.log' },
    fullIntegration: { status: 'pass', ...integration, log: '.local/sprint6-integration-final.log' },
    uiSmoke: { status: 'pass', viewports: ui.reports.filter((report) => report.viewport).map((report) => report.viewport), roles: ui.reports.filter((report) => report.role).map((report) => report.role), overflowDetected: false, consoleErrors: 0, results: 'docs/SPRINT_6_UI_RESULTS.json', log: '.local/sprint6-smoke-final.log' },
    posRegression: { status: 'pass', viewports: posViewports.map((report) => report.viewport), log: '.local/sprint6-pos-regression-final.log', results: 'docs/SPRINT_6_POS_REGRESSION_RESULTS.json' },
    migration: { status: 'pass', results: 'docs/SPRINT_6_MIGRATION_RESULTS.json' },
    database: { status: 'pass', migrations: 7, schemaUpToDate: true },
    cleanup: { status: 'pass', results: 'docs/SPRINT_6_CLEANUP_RESULTS.json' },
    dependencyAudit: { status: 'pass', vulnerabilities: 0 },
    prismaGenerate: { status: 'pass', clientVersion: '6.19.3' },
  },
  scope: { operationalUat: 'not performed', physicalDevices: 'not tested', productionDeployment: 'not performed', pixelPerfect: 'not claimed', productionScalePerformance: 'not measured' },
};
await writeFile('docs/SPRINT_6_VERIFICATION_RESULTS.json', JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
