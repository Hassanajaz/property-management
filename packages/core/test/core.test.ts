import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  COMPLIANCE_RULES,
  addMonths,
  addWorkingDays,
  affordability,
  applicableRules,
  arrears,
  canAddProperty,
  canTransition,
  complianceScore,
  formatPence,
  generateRequirements,
  generateSchedule,
  monthlyEquivalentPence,
  offerWarnings,
  planById,
  smallestPlanFor,
  statusOf,
  today,
} from '../src/index.ts';

const rule = (id: string) => {
  const found = COMPLIANCE_RULES.find((r) => r.id === id);
  assert.ok(found, `rule ${id} exists`);
  return found;
};

test('dates: month arithmetic clamps to month end and does not drift', () => {
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonths('2026-01-31', 2), '2026-03-31');
  assert.equal(addMonths('2024-02-29', 12), '2025-02-28');
  assert.equal(addMonths('2026-11-15', 2), '2027-01-15');
});

test('dates: working days skip weekends', () => {
  // Friday 6 Nov 2026 + 1 working day = Monday 9 Nov 2026
  assert.equal(addWorkingDays('2026-11-06', 1), '2026-11-09');
  assert.equal(addWorkingDays('2026-11-02', 30), '2026-12-14');
});

test('compliance: rule ids are unique', () => {
  const ids = COMPLIANCE_RULES.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('compliance: gas safety applies only where there is gas', () => {
  const withGas = applicableRules({ nation: 'england', scope: 'property', facts: { hasGas: true } }, '2026-11-12');
  const noGas = applicableRules({ nation: 'england', scope: 'property', facts: { hasGas: false } }, '2026-11-12');
  assert.ok(withGas.some((r) => r.id === 'gas_safety.gb'));
  assert.ok(!noGas.some((r) => r.id === 'gas_safety.gb'));
});

test('compliance: every nation gets gas, EICR, EPC and alarms for a property with gas', () => {
  for (const nation of ['england', 'wales', 'scotland', 'northern_ireland'] as const) {
    const titles = applicableRules({ nation, scope: 'property', facts: { hasGas: true } }, '2026-11-12').map((r) => r.id);
    for (const prefix of ['gas_safety', 'eicr', 'epc', 'alarms']) {
      assert.ok(titles.some((id) => id.startsWith(prefix)), `${nation} has ${prefix}`);
    }
  }
});

test('compliance: Right to Rent is England only', () => {
  const ids = (nation: 'england' | 'wales' | 'scotland' | 'northern_ireland') =>
    applicableRules({ nation, scope: 'tenancy' }, '2026-11-12').map((r) => r.id);
  assert.ok(ids('england').includes('right_to_rent'));
  for (const nation of ['wales', 'scotland', 'northern_ireland'] as const) {
    assert.ok(!ids(nation).includes('right_to_rent'));
  }
});

test('compliance: rules respect their effective date', () => {
  const before = applicableRules({ nation: 'england', scope: 'tenancy' }, '2026-04-30').map((r) => r.id);
  const after = applicableRules({ nation: 'england', scope: 'tenancy' }, '2026-05-01').map((r) => r.id);
  assert.ok(!before.includes('written_statement.england'));
  assert.ok(after.includes('written_statement.england'));
});

test('compliance: deposit deadlines differ by nation', () => {
  const due = (nation: 'england' | 'scotland' | 'northern_ireland', ruleId: string) =>
    generateRequirements(
      { nation, scope: 'tenancy', facts: { depositTaken: true }, tenancyStart: '2026-11-02', depositReceived: '2026-11-02' },
      '2026-11-02',
    ).find((r) => r.ruleId === ruleId)?.dueDate;
  assert.equal(due('england', 'deposit_protect.ew'), '2026-12-02');
  assert.equal(due('scotland', 'deposit_protect.scotland'), '2026-12-14');
  assert.equal(due('northern_ireland', 'deposit_protect.ni'), '2026-11-30');
});

test('compliance: certificate status moves from valid to due soon to overdue', () => {
  const gas = rule('gas_safety.gb');
  assert.equal(statusOf({ rule: gas }, '2026-11-12'), 'missing');
  assert.equal(statusOf({ rule: gas, completedOn: '2026-06-01' }, '2026-11-12'), 'valid');
  assert.equal(statusOf({ rule: gas, completedOn: '2025-12-20' }, '2026-11-12'), 'due_soon');
  assert.equal(statusOf({ rule: gas, completedOn: '2025-11-01' }, '2026-11-12'), 'overdue');
  // An expiry date printed on the certificate wins over the rule interval.
  assert.equal(statusOf({ rule: gas, completedOn: '2025-11-01', expiresOn: '2027-01-31' }, '2026-11-12'), 'valid');
});

test('compliance: deadline items are overdue once the deadline passes undone', () => {
  const deposit = rule('deposit_protect.ew');
  assert.equal(statusOf({ rule: deposit, dueDate: '2026-12-02' }, '2026-11-12'), 'due_soon');
  assert.equal(statusOf({ rule: deposit, dueDate: '2026-12-02' }, '2026-12-03'), 'overdue');
  assert.equal(statusOf({ rule: deposit, dueDate: '2026-12-02', completedOn: '2026-11-20' }, '2026-12-03'), 'valid');
});

test('compliance: score counts met statutory items only', () => {
  const states = [
    { rule: rule('gas_safety.gb'), completedOn: '2026-06-01' },
    { rule: rule('eicr.england') },
    { rule: rule('legionella') }, // best practice: not scored
    { rule: rule('prs_database.england') }, // upcoming: not scored
  ];
  assert.equal(complianceScore(states, '2026-11-12'), 50);
  assert.equal(complianceScore([], '2026-11-12'), 100);
});

test('rent: monthly schedule on the 31st stays anchored to month end', () => {
  const charges = generateSchedule({ startDate: '2026-01-31', amountPence: 120000, frequency: 'monthly' }, '2026-04-30');
  assert.deepEqual(charges.map((c) => c.dueDate), ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  assert.equal(charges[1]!.periodEnd, '2026-03-30');
  assert.ok(charges.every((c) => c.amountPence === 120000 && !c.proRata));
});

test('rent: final period is charged pro rata when the tenancy ends early', () => {
  const charges = generateSchedule(
    { startDate: '2026-11-01', endDate: '2026-12-15', amountPence: 93000, frequency: 'monthly' },
    '2027-01-31',
  );
  assert.equal(charges.length, 2);
  assert.equal(charges[1]!.proRata, true);
  assert.equal(charges[1]!.amountPence, Math.round((93000 * 15) / 31));
});

test('rent: weekly schedule and monthly equivalent', () => {
  const charges = generateSchedule({ startDate: '2026-11-02', amountPence: 25000, frequency: 'weekly' }, '2026-11-23');
  assert.equal(charges.length, 4);
  assert.equal(monthlyEquivalentPence(25000, 'weekly'), 108333);
});

test('rent: payments clear the oldest charges first', () => {
  const charges = generateSchedule({ startDate: '2026-08-01', amountPence: 100000, frequency: 'monthly' }, '2026-11-12');
  const summary = arrears(charges, [{ date: '2026-08-01', amountPence: 100000 }, { date: '2026-09-05', amountPence: 60000 }], '2026-11-12');
  assert.equal(summary.chargedPence, 400000);
  assert.equal(summary.balancePence, 240000);
  assert.equal(summary.oldestUnpaidDueDate, '2026-09-01');
  assert.equal(summary.unpaid[0]!.outstandingPence, 40000);
  assert.equal(summary.daysInArrears, 72);
  assert.equal(formatPence(summary.balancePence), '£2,400.00');
});

test('rent: an account in credit has no arrears', () => {
  const charges = generateSchedule({ startDate: '2026-11-01', amountPence: 100000, frequency: 'monthly' }, '2026-11-12');
  const summary = arrears(charges, [{ date: '2026-10-28', amountPence: 150000 }], '2026-11-12');
  assert.equal(summary.balancePence, -50000);
  assert.equal(summary.daysInArrears, 0);
});

test('referencing: affordability and England offer warnings', () => {
  assert.equal(affordability({ monthlyRentPence: 100000, annualIncomePence: 3000000 }).passes, true);
  assert.equal(affordability({ monthlyRentPence: 100000, annualIncomePence: 2999900 }).passes, false);
  assert.equal(
    offerWarnings({ nation: 'england', advertisedRentPence: 100000, agreedRentPence: 105000, rentInAdvanceMonths: 6 }).length,
    2,
  );
  assert.equal(
    offerWarnings({ nation: 'scotland', advertisedRentPence: 100000, agreedRentPence: 105000, rentInAdvanceMonths: 6 }).length,
    0,
  );
});

test('compliance: landlord account requirements follow the nation, with no agency rules left', () => {
  assert.ok(!COMPLIANCE_RULES.some((r) => (r.scope as string) === 'agency'));
  const ids = (nation: 'england' | 'wales' | 'scotland' | 'northern_ireland') =>
    applicableRules({ nation, scope: 'landlord' }, '2026-11-12').map((r) => r.id);
  for (const nation of ['england', 'wales', 'scotland', 'northern_ireland'] as const) assert.ok(ids(nation).includes('ico_registration'));
  assert.ok(ids('wales').includes('landlord_registration.wales'));
  assert.ok(ids('scotland').includes('landlord_registration.scotland'));
});

test('maintenance: the landlord runs the repair; the tenant confirms or reopens', () => {
  assert.equal(canTransition('landlord', 'reported', 'triaged'), true);
  assert.equal(canTransition('landlord', 'reported', 'scheduled'), true);
  assert.equal(canTransition('landlord', 'scheduled', 'completed'), true);
  assert.equal(canTransition('landlord', 'completed', 'confirmed'), false); // only the tenant confirms
  assert.equal(canTransition('landlord', 'completed', 'reopened'), true);
  assert.equal(canTransition('landlord', 'confirmed', 'reopened'), false);
  assert.equal(canTransition('tenant', 'reported', 'triaged'), false);
  assert.equal(canTransition('tenant', 'reported', 'cancelled'), true);
  assert.equal(canTransition('tenant', 'completed', 'confirmed'), true);
  assert.equal(canTransition('tenant', 'completed', 'reopened'), true);
  assert.equal(canTransition('tenant', 'scheduled', 'completed'), false);
});

test('plans: property limits', () => {
  const solo = planById('solo')!;
  assert.equal(canAddProperty(solo, 2), true);
  assert.equal(canAddProperty(solo, 3), false);
  assert.equal(smallestPlanFor(1)?.id, 'free');
  assert.equal(smallestPlanFor(4)?.id, 'portfolio');
  assert.equal(smallestPlanFor(5000)?.id, 'unlimited');
});

test('demo: the landlord sees the whole account and the tenant only their own home', async () => {
  const { createDemoApi, resetDemo } = await import('../src/index.ts');
  resetDemo();
  const tenant = createDemoApi('tenant');
  const landlord = createDemoApi('landlord');

  assert.equal((await tenant.listProperties()).length, 1);
  assert.equal((await landlord.listProperties()).length, 4);
  await assert.rejects(() => tenant.listCompliance());
  await assert.rejects(() => tenant.listApplications());
  await assert.rejects(() => tenant.createProperty({ addressLine1: 'x', addressLine2: null, town: 'y', postcode: 'AB1 2CD', nation: 'england', hasGas: true, isHmo: false }));

  const compliance = await landlord.listCompliance();
  const statuses = new Set(compliance.items.map((i) => i.status));
  for (const status of ['valid', 'due_soon', 'overdue', 'missing']) assert.ok(statuses.has(status as never), `demo shows ${status}`);
  assert.ok(compliance.score > 0 && compliance.score < 100);

  // Tenant reports, landlord handles it, tenant confirms.
  const created = await tenant.reportMaintenance({ title: 'Kitchen tap dripping', description: 'Drips constantly', category: 'plumbing', urgency: 'routine' });
  assert.ok((await landlord.listMaintenance()).some((r) => r.id === created.id));
  await assert.rejects(() => tenant.updateMaintenance(created.id, { status: 'triaged' }));
  await landlord.updateMaintenance(created.id, { status: 'triaged', message: 'Plumber being arranged' });
  await landlord.updateMaintenance(created.id, { status: 'scheduled', appointmentAt: new Date().toISOString() });
  await landlord.updateMaintenance(created.id, { status: 'completed' });
  await assert.rejects(() => landlord.updateMaintenance(created.id, { status: 'confirmed' }));
  await tenant.updateMaintenance(created.id, { status: 'confirmed' });
  const final = await tenant.getMaintenance(created.id);
  assert.equal(final.status, 'confirmed');
  assert.equal(final.updates?.length, 5);

  // The landlord can log a repair themselves, against a chosen tenancy.
  await assert.rejects(() => landlord.reportMaintenance({ title: 'Gutter blocked', description: 'Overflowing', category: 'garden_exterior', urgency: 'routine' }));
  const logged = await landlord.reportMaintenance({ tenancyId: 'demo-tenancy-2', title: 'Gutter blocked', description: 'Overflowing', category: 'garden_exterior', urgency: 'routine' });
  assert.equal(logged.propertyId, 'demo-property-2');
  assert.ok(!(await tenant.listMaintenance()).some((r) => r.id === logged.id));
});

test('demo: rent, documents and applicants', async () => {
  const { createDemoApi, resetDemo, portfolioSummary } = await import('../src/index.ts');
  resetDemo();
  const landlord = createDemoApi('landlord');
  const tenant = createDemoApi('tenant');

  const tenancies = await landlord.listTenancies();
  assert.equal(tenancies.length, 3);
  assert.equal((await tenant.listTenancies()).length, 1);
  const inArrears = tenancies.find((t) => t.id === 'demo-tenancy-2')!;
  assert.equal(inArrears.balancePence, 39500);
  assert.ok(inArrears.daysInArrears >= 7 && inArrears.daysInArrears <= 13, 'about ten days in arrears');
  assert.equal(tenancies.find((t) => t.id === 'demo-tenancy-1')!.balancePence, 0);

  const ledger = await landlord.getLedger('demo-tenancy-2');
  assert.ok(ledger.charges.length >= 15);
  assert.equal(ledger.summary.balancePence, 39500);
  await assert.rejects(() => tenant.getLedger('demo-tenancy-2'));
  assert.equal((await tenant.getLedger('demo-tenancy-1')).summary.balancePence, 0);

  // The landlord sees every document; the tenant sees only their own home's, and no personal evidence.
  const landlordDocs = await landlord.listDocuments();
  assert.ok(landlordDocs.some((d) => d.type === 'right_to_rent_check'));
  const tenantDocs = await tenant.listDocuments();
  assert.ok(tenantDocs.length > 0);
  assert.ok(tenantDocs.every((d) => d.propertyId === 'demo-property-1' && d.type !== 'right_to_rent_check'));

  const before = landlordDocs.length;
  await landlord.requestUpload({ fileName: 'New gas record.jpg', contentType: 'image/jpeg', type: 'gas_safety_record', propertyId: 'demo-property-4' });
  assert.equal((await landlord.listDocuments()).length, before + 1);
  await assert.rejects(() => tenant.requestUpload({ fileName: 'x.jpg', contentType: 'image/jpeg', type: 'maintenance_photo', propertyId: 'demo-property-3' }));

  const applications = await landlord.listApplications();
  assert.equal(applications.length, 2);
  assert.equal(applications.find((a) => a.applicantName === 'Daniel Okafor')!.affordable, true);
  assert.equal(applications.find((a) => a.applicantName === 'Hannah Price')!.affordable, false);

  const summary = portfolioSummary({
    properties: await landlord.listProperties(),
    tenancies,
    compliance: (await landlord.listCompliance()).items,
    repairs: await landlord.listMaintenance(),
    applications,
  });
  assert.equal(summary.properties, 4);
  assert.equal(summary.let, 3);
  assert.equal(summary.vacant, 1);
  assert.equal(summary.monthlyRentPence, 276500);
  assert.equal(summary.arrearsPence, 39500);
  assert.equal(summary.tenanciesInArrears, 1);
  assert.equal(summary.repairsToReview, 1);
  assert.equal(summary.applicationsInProgress, 2);
  assert.ok(summary.complianceAttention > 0);
});

test('tools: tax year, mileage and finance summary', async () => {
  const { taxYearOf, mileageAllowancePence, financeSummary } = await import('../src/index.ts');
  assert.deepEqual(taxYearOf('2026-04-05'), { label: '2025-26', start: '2025-04-06', end: '2026-04-05' });
  assert.deepEqual(taxYearOf('2026-04-06'), { label: '2026-27', start: '2026-04-06', end: '2027-04-05' });
  assert.equal(taxYearOf('2026-11-15').label, '2026-27');
  assert.equal(mileageAllowancePence(100), 4500);
  assert.equal(mileageAllowancePence(10_500), 450000 + 12500);

  const summary = financeSummary(
    {
      payments: [{ date: '2026-05-01', amountPence: 100000 }, { date: '2026-06-01', amountPence: 100000 }, { date: '2026-03-01', amountPence: 999999 }],
      expenses: [
        { date: '2026-05-10', category: 'repairs', amountPence: 20000 },
        { date: '2026-05-12', category: 'insurance', amountPence: 10000 },
        { date: '2026-05-15', category: 'mortgage_interest', amountPence: 40000 },
        { date: '2025-12-01', category: 'repairs', amountPence: 77777 },
      ],
      mileage: [{ date: '2026-05-20', miles: 100 }],
    },
    taxYearOf('2026-11-15'),
  );
  assert.equal(summary.incomePence, 200000);
  assert.equal(summary.allowableExpensesPence, 30000);
  assert.equal(summary.mileagePence, 4500);
  assert.equal(summary.profitPence, 165500);
  assert.equal(summary.financeCostsPence, 40000);
  assert.equal(summary.financeCostTaxReductionPence, 8000);
});

test('tools: equity, loan to value, yield, occupancy and payment rate', async () => {
  const { propertyMoney, paymentRate } = await import('../src/index.ts');
  const money = propertyMoney(20000000, 15000000, 1200000);
  assert.equal(money.equityPence, 5000000);
  assert.equal(money.loanToValue, 0.75);
  assert.equal(money.grossYield, 0.06);
  assert.equal(propertyMoney(null, 100, 100).equityPence, null);

  const charges = generateSchedule({ startDate: '2026-07-01', amountPence: 100000, frequency: 'monthly' }, '2026-11-15');
  // July on time, August 10 days late, September on time, October unpaid, November unpaid.
  const payments = [{ date: '2026-07-01', amountPence: 100000 }, { date: '2026-08-11', amountPence: 100000 }, { date: '2026-09-02', amountPence: 100000 }];
  assert.equal(paymentRate(charges, payments, '2026-11-15'), 40);
  assert.equal(paymentRate(charges, charges.map((c) => ({ date: c.dueDate, amountPence: c.amountPence })), '2026-11-15'), 100);
  assert.equal(paymentRate([], [], '2026-11-15'), 100);
});

test('tools: rent reviews, inspection notice, reminders and CSV', async () => {
  const { rentReview, inspectionNotice, reminders, propertiesCsv, createDemoApi, resetDemo } = await import('../src/index.ts');
  const england = rentReview('england', '2026-03-01', '2026-11-15');
  assert.equal(england.earliestEffectiveDate, '2027-03-01');
  assert.equal(england.serveNoticeBy, '2027-01-01');
  assert.equal(england.canServeNow, false);
  assert.equal(rentReview('scotland', '2025-12-01', '2026-11-15').canServeNow, true);

  assert.equal(inspectionNotice('2026-11-20', null, '2026-11-15'), 'give_notice_now');
  assert.equal(inspectionNotice('2026-11-20', '2026-11-16', '2026-11-17'), 'ok');
  assert.equal(inspectionNotice('2026-11-15', null, '2026-11-15'), 'too_late');

  resetDemo();
  const landlord = createDemoApi('landlord');
  const compliance = (await landlord.listCompliance()).items;
  const ladder = reminders(compliance, today());
  assert.ok(ladder.length > 0);
  assert.ok(ladder.every((r) => r.daysLeft <= 60));
  assert.ok(ladder.some((r) => r.stage === 0), 'includes an overdue item');
  for (let i = 1; i < ladder.length; i += 1) assert.ok(ladder[i - 1]!.daysLeft <= ladder[i]!.daysLeft);

  const csv = propertiesCsv(await landlord.listProperties(), await landlord.listTenancies(), compliance);
  const lines = csv.split('\n');
  assert.equal(lines.length, 5);
  assert.ok(lines[0]!.startsWith('Address,Town,Postcode'));
  assert.ok(lines.some((l) => l.includes('"Flat 3, 22 Harbour Street"')), 'commas are quoted');
  assert.ok(lines.some((l) => l.includes('Vacant')));
});

test('demo: applicant decisions, payments, keys, contractors and inspections', async () => {
  const { createDemoApi, resetDemo } = await import('../src/index.ts');
  resetDemo();
  const landlord = createDemoApi('landlord');
  const tenant = createDemoApi('tenant');

  // Referencing decision, then make the applicant the tenant.
  await assert.rejects(() => landlord.convertApplication('demo-application-1', { startDate: today() }));
  await assert.rejects(() => landlord.decideApplication('demo-application-1', { status: 'passed', reason: ' ' }));
  await landlord.decideApplication('demo-application-1', { status: 'passed', reason: 'All references satisfactory' });
  const tenancy = await landlord.convertApplication('demo-application-1', { startDate: today() });
  assert.equal(tenancy.propertyId, 'demo-property-4');
  assert.equal((await landlord.listTenancies()).length, 4);
  assert.equal((await landlord.listApplications()).find((a) => a.id === 'demo-application-2')!.status, 'withdrawn');
  await assert.rejects(() => tenant.decideApplication('demo-application-2', { status: 'failed', reason: 'x' }));

  // Recording a payment clears arrears.
  await landlord.recordPayment('demo-tenancy-2', { date: today(), amountPence: 39500, method: 'bank_transfer' });
  assert.equal((await landlord.getLedger('demo-tenancy-2')).summary.balancePence, 0);
  await assert.rejects(() => tenant.recordPayment('demo-tenancy-1', { date: today(), amountPence: 100, method: 'cash' }));
  assert.ok((await landlord.listPayments()).length > 20);

  // Keys go out and come back, and every movement is logged.
  await assert.rejects(() => landlord.moveKey('demo-key-3', { action: 'issued', person: 'Someone else' }));
  const back = await landlord.moveKey('demo-key-3', { action: 'returned', person: '' });
  assert.equal(back.holder, null);
  assert.equal(back.movements.length, 2);
  const out = await landlord.moveKey('demo-key-3', { action: 'issued', person: 'Brightwire Electrical' });
  assert.equal(out.holder, 'Brightwire Electrical');
  await assert.rejects(() => tenant.listKeys());

  // Work order on a repair.
  const contractors = await landlord.listContractors();
  assert.equal(contractors.length, 3);
  const updated = await landlord.updateMaintenance('demo-repair-3', { contractorId: 'demo-contractor-3', quotePence: 18000 });
  assert.equal(updated.contractorName, 'Harper Property Care');
  assert.equal(updated.quotePence, 18000);
  await assert.rejects(() => tenant.updateMaintenance('demo-repair-1', { quotePence: 1 }));

  // Inspections.
  const planned = await landlord.planInspection({ propertyId: 'demo-property-4', date: addMonths(today(), 1) });
  const noticed = await landlord.updateInspection(planned.id, { noticeGivenOn: today() });
  assert.equal(noticed.noticeGivenOn, today());

  // Expenses and mileage.
  const before = (await landlord.listExpenses()).length;
  await landlord.addExpense({ propertyId: 'demo-property-1', date: today(), category: 'repairs', description: 'Tap washer', amountPence: 450 });
  assert.equal((await landlord.listExpenses()).length, before + 1);
  await assert.rejects(() => landlord.addMileage({ date: today(), miles: 0, purpose: 'x' }));
});
