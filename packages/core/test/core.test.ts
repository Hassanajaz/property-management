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

test('maintenance: each role can only make its own moves', () => {
  assert.equal(canTransition('agency_staff', 'reported', 'triaged'), true);
  assert.equal(canTransition('tenant', 'reported', 'triaged'), false);
  assert.equal(canTransition('tenant', 'reported', 'cancelled'), true);
  assert.equal(canTransition('tenant', 'completed', 'confirmed'), true);
  assert.equal(canTransition('tenant', 'completed', 'reopened'), true);
  assert.equal(canTransition('landlord', 'awaiting_landlord_approval', 'scheduled'), true);
  assert.equal(canTransition('landlord', 'reported', 'triaged'), false);
  assert.equal(canTransition('agency_owner', 'confirmed', 'reopened'), false);
});

test('plans: property limits', () => {
  const starter = planById('agency_starter')!;
  assert.equal(canAddProperty(starter, 19), true);
  assert.equal(canAddProperty(starter, 20), false);
  assert.equal(smallestPlanFor('agency', 21)?.id, 'agency_growth');
  assert.equal(smallestPlanFor('agency', 5000)?.id, 'agency_unlimited');
});
