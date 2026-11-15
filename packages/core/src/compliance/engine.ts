import { addDays, addMonths, addWorkingDays, diffDays, type IsoDate } from '../dates.ts';
import type { ComplianceScope, ComplianceStatus, Nation, SubjectFacts } from '../types.ts';
import { COMPLIANCE_RULES, type ComplianceRule } from './rules.ts';

export interface Subject {
  nation: Nation;
  scope: ComplianceScope;
  facts?: SubjectFacts;
  /** Required for tenancy-scope deadline rules. */
  tenancyStart?: IsoDate;
  depositReceived?: IsoDate;
}

export interface Requirement {
  ruleId: string;
  title: string;
  severity: ComplianceRule['severity'];
  upcoming: boolean;
  /** When the requirement must next be met; undefined when it depends on evidence not yet recorded. */
  dueDate?: IsoDate;
}

function factsMatch(when: SubjectFacts | undefined, facts: SubjectFacts = {}): boolean {
  if (!when) return true;
  return (Object.keys(when) as (keyof SubjectFacts)[]).every((key) => !when[key] || facts[key] === true);
}

function inEffect(rule: ComplianceRule, onDate: IsoDate): boolean {
  if (rule.effectiveFrom && onDate < rule.effectiveFrom) return false;
  if (rule.effectiveTo && onDate > rule.effectiveTo) return false;
  return true;
}

/** Rules that apply to a subject on a given date. */
export function applicableRules(
  subject: Subject,
  onDate: IsoDate,
  rules: readonly ComplianceRule[] = COMPLIANCE_RULES,
): ComplianceRule[] {
  return rules.filter(
    (rule) =>
      rule.scope === subject.scope &&
      rule.nations.includes(subject.nation) &&
      factsMatch(rule.when, subject.facts) &&
      inEffect(rule, onDate),
  );
}

/** The date a deadline rule falls due for this subject, if the triggering date is known. */
function deadlineDate(rule: ComplianceRule, subject: Subject): IsoDate | undefined {
  if (rule.recurrence.kind !== 'deadline') return undefined;
  const from = rule.recurrence.from === 'deposit_received' ? subject.depositReceived : subject.tenancyStart;
  if (!from) return undefined;
  return rule.recurrence.workingDays
    ? addWorkingDays(from, rule.recurrence.days)
    : addDays(from, rule.recurrence.days);
}

/** The requirements to create when a property, tenancy or landlord account is added. */
export function generateRequirements(
  subject: Subject,
  onDate: IsoDate,
  rules: readonly ComplianceRule[] = COMPLIANCE_RULES,
): Requirement[] {
  return applicableRules(subject, onDate, rules).map((rule) => ({
    ruleId: rule.id,
    title: rule.title,
    severity: rule.severity,
    upcoming: rule.status === 'upcoming',
    dueDate: deadlineDate(rule, subject),
  }));
}

/** When an interval rule next falls due after being completed on `completedOn`. */
export function nextDue(rule: ComplianceRule, completedOn: IsoDate): IsoDate | undefined {
  return rule.recurrence.kind === 'interval' ? addMonths(completedOn, rule.recurrence.months) : undefined;
}

export interface RequirementState {
  rule: ComplianceRule;
  /** Date the current evidence was issued or the action was done. */
  completedOn?: IsoDate;
  /** Explicit expiry printed on the certificate; overrides the rule's interval. */
  expiresOn?: IsoDate;
  /** Deadline for one-off actions, from `generateRequirements`. */
  dueDate?: IsoDate;
}

export const DUE_SOON_DAYS = 60;

/** Status of one requirement on a given day. */
export function statusOf(state: RequirementState, onDate: IsoDate, dueSoonDays = DUE_SOON_DAYS): ComplianceStatus {
  const { rule, completedOn, dueDate } = state;

  if (rule.recurrence.kind === 'interval') {
    if (!completedOn && !state.expiresOn) return 'missing';
    const expires = state.expiresOn ?? nextDue(rule, completedOn!)!;
    const daysLeft = diffDays(onDate, expires);
    if (daysLeft < 0) return 'overdue';
    return daysLeft <= dueSoonDays ? 'due_soon' : 'valid';
  }

  // 'once' and 'deadline': done is done.
  if (completedOn) return 'valid';
  if (!dueDate) return 'missing';
  const daysLeft = diffDays(onDate, dueDate);
  if (daysLeft < 0) return 'overdue';
  return daysLeft <= dueSoonDays ? 'due_soon' : 'missing';
}

/**
 * Compliance score from 0 to 100: the share of in-force statutory requirements
 * that are currently met. Best-practice and upcoming rules are not scored.
 */
export function complianceScore(states: readonly RequirementState[], onDate: IsoDate): number {
  const scored = states.filter((s) => s.rule.severity === 'statutory' && s.rule.status === 'in_force');
  if (scored.length === 0) return 100;
  const met = scored.filter((s) => {
    const status = statusOf(s, onDate);
    return status === 'valid' || (status === 'due_soon' && (s.completedOn !== undefined || s.expiresOn !== undefined));
  }).length;
  return Math.round((met / scored.length) * 100);
}
