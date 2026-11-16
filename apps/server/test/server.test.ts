import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createLocalClient, localChangePassword, localInviteTenant, localSignIn, localSignUp, today } from '../../../packages/core/src/index.ts';
import { startServer } from '../src/server.ts';

test('local server: accounts, saved data, tenant sign-in, files and isolation', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'lettly-'));
  let running = await startServer({ dataDir, port: 0, host: '127.0.0.1' });
  let base = `http://127.0.0.1:${running.port}`;

  // A landlord creates an account that starts empty.
  await assert.rejects(() => localSignUp(base, { name: 'Sam', email: 'sam@example.com', password: 'short', sample: false }));
  const landlordSession = await localSignUp(base, { name: 'Sam Landlord', email: 'Sam@Example.com', password: 'correct horse', sample: false });
  assert.equal(landlordSession.user.role, 'landlord');
  await assert.rejects(() => localSignUp(base, { name: 'Dup', email: 'sam@example.com', password: 'another one', sample: false }));
  const landlord = createLocalClient(base, () => landlordSession.token);
  assert.deepEqual(await landlord.listProperties(), []);

  // They add a property and a tenancy; the legal requirements are generated.
  const property = await landlord.createProperty({ addressLine1: '1 Test Street', addressLine2: null, town: 'Leeds', postcode: 'LS1 1AA', nation: 'england', hasGas: true, isHmo: false });
  const tenancy = await landlord.createTenancy({ propertyId: property.id, startDate: today(), rentAmountPence: 90000, rentFrequency: 'monthly', depositPence: 100000, tenants: [{ name: 'Tess Tenant', email: 'tess@example.com' }] });
  assert.ok((await landlord.listCompliance()).items.length >= 5);

  // The tenant is invited, signs in, and sees only their own home.
  const invite = await localInviteTenant(base, landlordSession.token, { tenancyId: tenancy.id, name: 'Tess Tenant', email: 'tess@example.com' });
  assert.ok(invite.temporaryPassword);
  const tenantSession = await localSignIn(base, 'tess@example.com', invite.temporaryPassword!);
  assert.equal(tenantSession.user.role, 'tenant');
  const tenant = createLocalClient(base, () => tenantSession.token);
  assert.equal((await tenant.listProperties()).length, 1);
  assert.equal((await tenant.listTenancies())[0]!.balancePence, 90000);
  await assert.rejects(() => tenant.listCompliance());
  await assert.rejects(() => tenant.createProperty({ addressLine1: 'x', addressLine2: null, town: 'y', postcode: 'AB1 2CD', nation: 'england', hasGas: true, isHmo: false }));
  await assert.rejects(() => localInviteTenant(base, tenantSession.token, { tenancyId: tenancy.id, name: 'x', email: 'x@example.com' }));

  // The tenant reports a repair with a photo; the landlord sees it and opens the photo.
  const ticket = await tenant.requestUpload({ fileName: 'leak.jpg', contentType: 'image/jpeg', type: 'maintenance_photo' });
  const upload = await fetch(ticket.uploadUrl, { method: 'PUT', body: Buffer.from('fake image bytes') });
  assert.equal(upload.status, 200);
  assert.equal((await fetch(ticket.uploadUrl, { method: 'PUT', body: 'again' })).status, 403, 'an upload link works once');
  const repair = await tenant.reportMaintenance({ title: 'Leak under sink', description: 'Dripping', category: 'plumbing', urgency: 'urgent', photoDocumentIds: [ticket.documentId] });
  assert.equal((await landlord.listMaintenance()).length, 1);
  const { url } = await landlord.downloadUrl(ticket.documentId);
  const file = await fetch(url);
  assert.equal(file.headers.get('content-type'), 'image/jpeg');
  assert.equal(await file.text(), 'fake image bytes');
  assert.equal((await fetch(url.replace(/t=.*/, 't=wrong'))).status, 401);

  await landlord.updateMaintenance(repair.id, { status: 'triaged', message: 'Plumber booked' });
  assert.equal((await tenant.getMaintenance(repair.id)).status, 'triaged');

  // A second landlord, starting with the sample portfolio, cannot see the first one's data.
  const other = await localSignUp(base, { name: 'Olga Other', email: 'olga@example.com', password: 'another password', sample: true });
  const otherApi = createLocalClient(base, () => other.token);
  assert.equal((await otherApi.listProperties()).length, 4);
  assert.ok(!(await otherApi.listProperties()).some((p) => p.id === property.id && p.addressLine1 === '1 Test Street'));
  await assert.rejects(() => otherApi.downloadUrl(ticket.documentId));

  // A backup carries the records and the stored files, and can be put back.
  const backup = await landlord.exportData();
  assert.equal(backup.files!.length, 1);
  assert.equal(Buffer.from(backup.files![0]!.base64, 'base64').toString(), await (await fetch(url)).text());
  await landlord.saveLicence({ propertyId: property.id, kind: 'selective', authority: 'Test Council', reference: null, issuedOn: null, expiresOn: '2030-01-01', maxOccupants: null, conditions: null });
  assert.equal((await landlord.listLicences()).length, 1);
  await landlord.restoreData(backup);
  assert.equal((await landlord.listLicences()).length, 0);
  assert.equal((await fetch(url)).status, 200);
  // Another account cannot overwrite the file by restoring a backup that names it.
  await otherApi.restoreData({ ...(await otherApi.exportData()), files: [{ id: ticket.documentId, contentType: 'text/plain', base64: Buffer.from('hijacked').toString('base64') }] });
  assert.notEqual(await (await fetch(url)).text(), 'hijacked');
  await assert.rejects(() => tenant.exportData());

  // Bad requests are refused.
  await assert.rejects(() => localSignIn(base, 'sam@example.com', 'wrong password'));
  await assert.rejects(() => createLocalClient(base, () => 'not-a-token').listProperties());
  await assert.rejects(() => (landlord as unknown as { constructor: () => Promise<unknown> }).constructor());
  assert.equal((await fetch(`${base}/rpc`, { method: 'POST', headers: { Authorization: `Bearer ${landlordSession.token}`, 'Content-Type': 'application/json' }, body: '{"method":"__proto__","args":[]}' })).status, 404);

  // Passwords can be changed.
  await localChangePassword(base, tenantSession.token, 'my own password');
  await assert.rejects(() => localSignIn(base, 'tess@example.com', invite.temporaryPassword!));
  await localSignIn(base, 'tess@example.com', 'my own password');

  // Everything is still there after the server restarts.
  await running.close();
  running = await startServer({ dataDir, port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${running.port}`;
  const again = await localSignIn(base, 'sam@example.com', 'correct horse');
  const reopened = createLocalClient(base, () => again.token);
  assert.equal((await reopened.listProperties())[0]!.addressLine1, '1 Test Street');
  assert.equal((await reopened.getMaintenance(repair.id)).updates!.length, 2);
  assert.equal((await (await fetch((await reopened.downloadUrl(ticket.documentId)).url)).text()), 'fake image bytes');
  assert.equal(((await (await fetch(`${base}/health`)).json()) as { accounts: number }).accounts, 2);
  await running.close();
});
