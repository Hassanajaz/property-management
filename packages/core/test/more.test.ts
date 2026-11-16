import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  addDays,
  addMonths,
  calendarEntries,
  calendarIcs,
  createStoreApi,
  emptyStore,
  latestReadings,
  licenceState,
  matchBankRows,
  meterReport,
  parseBankCsv,
  parseBankDate,
  phoneAlerts,
  recurringDueDates,
  rentStatement,
  seedSampleStore,
  statementLines,
  textToHtml,
  today,
} from '../src/index.ts';

test('rent statement lists every charge and payment with a running balance', async () => {
  const api = createStoreApi(seedSampleStore(), { role: 'landlord' });
  const tenancy = (await api.listTenancies()).find((t) => t.id === 'demo-tenancy-2')!;
  const ledger = await api.getLedger(tenancy.id);
  const lines = statementLines(ledger, today());
  assert.equal(lines.length, 15 + 15);
  assert.equal(lines.at(-1)!.balancePence, tenancy.balancePence);
  assert.equal(lines[0]!.chargedPence, 89500);
  const text = rentStatement({ landlordName: 'Sam Landlord', tenancy, ledger, asOf: today() });
  assert.ok(text.includes('Balance owed: £395.00'));
  assert.ok(textToHtml('Statement', text).includes('<th>Balance</th>'));

  // The tenant can get the same statement for their own tenancy, and nobody else's.
  const tenant = createStoreApi(seedSampleStore(), { role: 'tenant', tenancyIds: ['demo-tenancy-1'] });
  assert.equal((await tenant.getLedger('demo-tenancy-1')).payments.length, 1);
  await assert.rejects(tenant.getLedger('demo-tenancy-2'));
});

test('bank statement import reads common layouts and matches payments to tenancies', async () => {
  assert.equal(parseBankDate('05/11/2026'), '2026-11-05');
  assert.equal(parseBankDate('5-11-26'), '2026-11-05');
  assert.equal(parseBankDate('2026-11-05'), '2026-11-05');
  assert.equal(parseBankDate('5 Nov 2026'), '2026-11-05');
  assert.equal(parseBankDate('05 November 2026'), '2026-11-05');
  assert.equal(parseBankDate('soon'), null);

  const separate = parseBankCsv(
    ['Account: 12345678', 'Date,Type,Description,Paid out,Paid in,Balance', '05/11/2026,FPI,"LLOYD M, RENT",,895.00,"1,200.00"', '06/11/2026,DD,BRITISH GAS,54.10,,1145.90', 'bad,FPI,X,,1.00,1'].join('\n'),
  );
  assert.deepEqual(separate.rows, [{ date: '2026-11-05', description: 'LLOYD M, RENT', amountPence: 89500 }]);
  assert.equal(separate.ignored, 1);
  assert.equal(separate.errors.length, 1);

  const signed = parseBankCsv('Transaction Date,Transaction Type,Transaction Description,Amount\n2026-11-01,CR,C FRASER FLAT,720.00\n2026-11-02,DR,TESCO,-12.50\n2026-11-03,CR,UNKNOWN PERSON,"£1,150.00"');
  assert.equal(signed.rows.length, 2);
  assert.equal(signed.rows[1]!.amountPence, 115000);
  assert.ok(parseBankCsv('nothing useful here').errors.length === 1);

  const api = createStoreApi(seedSampleStore(), { role: 'landlord' });
  const tenancies = await api.listTenancies();
  const matches = matchBankRows([...separate.rows, ...signed.rows, { date: '2026-11-04', description: 'MYSTERY', amountPence: 4200 }], tenancies, await api.listPayments());
  assert.deepEqual(matches.map((m) => [m.tenancyId, m.reason]), [['demo-tenancy-2', 'name'], ['demo-tenancy-3', 'name'], ['demo-tenancy-1', 'amount'], [null, null]]);
  assert.ok(matches.every((m) => !m.alreadyRecorded));

  // Once recorded, the same line is flagged so it is not added twice.
  await api.recordPayment('demo-tenancy-2', { date: '2026-11-05', amountPence: 89500, method: 'bank_transfer' });
  assert.equal(matchBankRows(separate.rows, tenancies, await api.listPayments())[0]!.alreadyRecorded, true);
});

test('repeating costs are added to the expenses when they fall due, once', async () => {
  assert.deepEqual(recurringDueDates({ startDate: '2026-01-31', endDate: null, frequency: 'monthly', postedThrough: null }, '2026-04-30'), ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  assert.deepEqual(recurringDueDates({ startDate: '2026-01-31', endDate: '2026-03-01', frequency: 'monthly', postedThrough: '2026-01-31' }, '2026-12-31'), ['2026-02-28']);
  assert.deepEqual(recurringDueDates({ startDate: '2025-06-01', endDate: null, frequency: 'yearly', postedThrough: null }, '2026-11-16'), ['2025-06-01', '2026-06-01']);

  const api = createStoreApi(emptyStore(), { role: 'landlord' });
  const start = addMonths(today(), -2);
  const recurring = await api.addRecurringExpense({ propertyId: null, category: 'insurance', description: 'Portfolio insurance', amountPence: 4000, frequency: 'monthly', startDate: start });
  assert.equal((await api.listExpenses()).length, 3);
  assert.equal((await api.listExpenses()).length, 3, 'reading again adds nothing');
  await api.stopRecurringExpense(recurring.id, { endDate: today() });
  assert.equal((await api.listRecurringExpenses())[0]!.endDate, today());
  await assert.rejects(api.addRecurringExpense({ propertyId: null, category: 'insurance', description: '', amountPence: 4000, frequency: 'monthly', startDate: start }));
});

test('meter readings, licences, certificate history and photos', async () => {
  const store = seedSampleStore();
  const landlord = createStoreApi(store, { role: 'landlord' });
  const tenant = createStoreApi(store, { role: 'tenant', tenancyIds: ['demo-tenancy-1'] });

  // A tenant can send a reading for their own home only.
  const reading = await tenant.addMeterReading({ propertyId: 'demo-property-1', meter: 'gas', reading: 4900, date: today(), occasion: 'routine' });
  assert.equal(reading.recordedBy, 'tenant');
  await assert.rejects(tenant.addMeterReading({ propertyId: 'demo-property-2', meter: 'gas', reading: 1, date: today(), occasion: 'routine' }));
  assert.ok((await tenant.listMeterReadings()).every((r) => r.propertyId === 'demo-property-1'));
  const latest = latestReadings(await landlord.listMeterReadings(), 'demo-property-1');
  assert.equal(latest.find((l) => l.meter === 'gas')!.usedSincePrevious, 79);
  assert.equal(latest.find((l) => l.meter === 'water')!.usedSincePrevious, null);
  assert.ok(meterReport('14 Maple Road', await landlord.listMeterReadings()).includes('Gas,4900,Routine,No,Tenant'));

  assert.equal(licenceState({ expiresOn: addDays(today(), 91) }, today()), 'valid');
  assert.equal(licenceState({ expiresOn: addDays(today(), 90) }, today()), 'renew_soon');
  assert.equal(licenceState({ expiresOn: addDays(today(), -1) }, today()), 'expired');
  const licences = await landlord.listLicences();
  assert.equal(licences[0]!.id, 'demo-licence-1', 'soonest to expire comes first');
  const saved = await landlord.saveLicence({ ...licences[0]!, expiresOn: addMonths(today(), 36) });
  assert.equal(saved.id, 'demo-licence-1');
  assert.equal((await landlord.listLicences()).length, 3);
  await assert.rejects(tenant.listLicences());

  // Renewing a certificate keeps the one it replaces.
  const gas = (await landlord.listCompliance()).items.find((i) => i.ruleId.startsWith('gas_safety') && i.propertyId === 'demo-property-1')!;
  assert.equal(gas.history!.length, 2);
  const renewed = await landlord.completeComplianceItem(gas.id, { completedOn: today() });
  assert.equal(renewed.history!.length, 3);
  assert.equal(renewed.history![0]!.completedOn, gas.completedOn);

  const inventory = await landlord.addInventoryPhoto('demo-tenancy-1', 'demo-inv-1', 'doc-1');
  assert.deepEqual(inventory.items[0]!.photoDocumentIds, ['doc-1']);
  assert.deepEqual((await landlord.addInspectionPhoto('demo-inspection-1', 'doc-2')).photoDocumentIds, ['doc-2']);
  await assert.rejects(tenant.addInventoryPhoto('demo-tenancy-1', 'demo-inv-1', 'doc-3'));
});

test('calendar file and phone alerts cover every date to remember', async () => {
  const api = createStoreApi(seedSampleStore(), { role: 'landlord' });
  const entries = calendarEntries(
    { compliance: (await api.listCompliance()).items, inspections: await api.listInspections(), licences: await api.listLicences(), rightToRent: await api.listRightToRent(), contractors: await api.listContractors() },
    today(),
  );
  assert.ok(entries.every((e) => e.date >= today()));
  assert.ok(entries.some((e) => e.id === 'licence-demo-licence-1') && entries.some((e) => e.id === 'inspection-demo-inspection-1') && entries.some((e) => e.id === 'right-to-rent-demo-rtr-1'));
  assert.ok(!entries.some((e) => e.id === 'inspection-demo-inspection-3'), 'finished inspections are left out');
  assert.equal(new Set(entries.map((e) => e.id)).size, entries.length);

  const ics = calendarIcs([{ id: 'a', date: '2026-12-31', title: 'Gas check; boiler, flue', detail: '1 High St' }], '2026-11-16T20:30:00.000Z');
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n') && ics.endsWith('END:VCALENDAR\r\n'));
  assert.ok(ics.includes('DTSTART;VALUE=DATE:20261231\r\nDTEND;VALUE=DATE:20270101'));
  assert.ok(ics.includes('SUMMARY:Gas check\\; boiler\\, flue') && ics.includes('DTSTAMP:20261116T203000Z') && ics.includes('UID:a@lettly'));

  const alerts = phoneAlerts([{ id: 'a', date: '2026-12-01', title: 'EICR due', detail: '1 High St' }], '2026-11-16T20:30');
  assert.deepEqual(alerts.map((a) => a.at), ['2026-11-24T09:00', '2026-12-01T09:00']);
  assert.equal(alerts[0]!.title, 'In 7 days: EICR due');
  assert.ok(phoneAlerts(entries, `${today()}T00:00`).length <= 60);
});

test('a backup can be put back, replacing what is there', async () => {
  const store = seedSampleStore();
  const api = createStoreApi(store, { role: 'landlord' });
  const backup = JSON.parse(JSON.stringify(await api.exportData()));
  await api.createProperty({ addressLine1: '1 New Street', addressLine2: null, town: 'York', postcode: 'YO1 1AA', nation: 'england', hasGas: false, isHmo: false });
  assert.equal((await api.listProperties()).length, 5);
  await api.restoreData(backup);
  assert.equal((await api.listProperties()).length, 4);
  assert.equal((await api.listLicences()).length, 3);

  await assert.rejects(api.restoreData({ app: 'lettly', version: 1, exportedAt: '', data: { nothing: true } }));
  await assert.rejects(createStoreApi(store, { role: 'tenant', tenancyIds: ['demo-tenancy-1'] }).exportData());
  // A backup made before newer features existed still restores.
  const old = JSON.parse(JSON.stringify(backup));
  delete old.data.licences;
  await api.restoreData(old);
  assert.deepEqual(await api.listLicences(), []);
});
