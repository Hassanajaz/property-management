import type { TemplateDto } from './client.ts';
import type { Nation } from './types.ts';

/**
 * Ready-made documents. They are plain-English starting points written from
 * general knowledge, not reviewed by a solicitor. Text in [square brackets] is
 * for the landlord to complete before sending.
 *
 * Some notices only have legal effect when given on the official prescribed
 * form for the nation (rent increases and notices seeking possession are the
 * main ones). For those, the document here is a covering letter that goes
 * with the official form, and says so.
 */
export interface BuiltInTemplate extends TemplateDto {
  description: string;
  /** Nations the wording is written for. */
  nations: readonly Nation[];
}

const ALL: readonly Nation[] = ['england', 'wales', 'scotland', 'northern_ireland'];

export const BUILT_IN_TEMPLATES: readonly BuiltInTemplate[] = [
  {
    id: 'builtin-tenancy-agreement-england',
    name: 'Tenancy agreement (England)',
    description: 'A periodic assured tenancy agreement in plain English. Wales and Scotland publish their own model agreements with terms the law requires there; use those for properties in those nations.',
    nations: ['england'],
    body: `TENANCY AGREEMENT

Assured periodic tenancy of a home in England

Date of this agreement: {{today}}

THE PARTIES

Landlord: {{landlord_name}}
Landlord's address for notices: [landlord's address in England or Wales]
Tenant(s): {{tenant_names}}

Where there is more than one tenant, each is responsible for all of the tenant's obligations, including the whole of the rent.

THE PROPERTY

{{property_address}}

The property is let [furnished / unfurnished]. The contents are listed in the inventory signed at the start of the tenancy.

THE TENANCY

The tenancy begins on {{start_date}}. It is a periodic tenancy with no fixed end date. It continues from one rent period to the next until it is ended as set out below.

RENT

The rent is {{rent}}, payable {{rent_frequency}} in advance.
The first payment is due on {{start_date}}. Later payments are due on the same day of each rent period.
Rent is paid by [standing order / bank transfer] to: [account name, sort code, account number].

The landlord may increase the rent no more than once a year, by giving the notice the law requires on the official form. The tenant may challenge an increase they think is above the market rent at the First-tier Tribunal.

DEPOSIT

The tenant pays a deposit of {{deposit}}. The landlord will protect it in a government-approved tenancy deposit scheme within 30 days of receiving it and give the tenant the required information about the scheme.

At the end of the tenancy the deposit is returned, less any agreed or awarded deductions for unpaid rent, damage beyond fair wear and tear, missing items, or cleaning needed to return the property to its condition at the start.

THE TENANT AGREES TO

- Pay the rent on time.
- Pay council tax, water, gas, electricity, telephone, broadband and television licence charges for the property during the tenancy, unless this agreement says otherwise.
- Live in the property as their only or main home, and not sublet it or take in a lodger without the landlord's written consent.
- Keep the inside of the property and its contents clean and in good condition, allowing for fair wear and tear.
- Report repairs and any damage to the landlord promptly.
- Not make alterations, redecorate or change locks without the landlord's written consent.
- Not cause, or allow visitors to cause, nuisance or annoyance to neighbours.
- Not use the property for any illegal purpose or run a business from it that brings customers to the property.
- Test smoke and carbon monoxide alarms regularly and tell the landlord if one is not working.
- Allow the landlord or their contractors to enter to inspect or carry out repairs, on at least 24 hours' written notice, or immediately in an emergency.
- Ask the landlord in writing before keeping a pet. The landlord will not unreasonably refuse and will reply within 28 days.
- Return all keys and leave the property clean and empty of the tenant's belongings when the tenancy ends.

THE LANDLORD AGREES TO

- Let the tenant live in the property without unnecessary interference.
- Keep the structure and exterior in repair, and keep in repair and working order the installations for water, gas, electricity, sanitation, heating and hot water.
- Make sure the property is fit to live in at the start of the tenancy and throughout it.
- Arrange a gas safety check every year and give the tenant a copy of the record.
- Keep the electrical installation inspected at least every five years and give the tenant a copy of the report.
- Provide working smoke alarms on each storey, and carbon monoxide alarms where required.
- Give the tenant a copy of the energy performance certificate.
- Insure the building. The tenant is responsible for insuring their own belongings.

ENDING THE TENANCY

The tenant may end the tenancy by giving the landlord at least two months' written notice, ending at the end of a rent period.

The landlord may only end the tenancy by obtaining a court order on one of the grounds for possession set out in law, after serving the notice the law requires.

NOTICES

Notices to the landlord must be sent to the landlord's address above. Notices to the tenant may be delivered to the property.
The landlord and tenant agree that notices and documents may also be sent by email to: [landlord's email] and [tenant's email].

SIGNED

Landlord: ______________________________   Date: ______________

Tenant: ________________________________   Date: ______________

Tenant: ________________________________   Date: ______________`,
  },
  {
    id: 'builtin-deposit-information',
    name: 'Deposit information for the tenant',
    description: 'The information a tenant must be given about their protected deposit. Send it with the scheme\'s own leaflet, within the deadline for the nation.',
    nations: ALL,
    body: `INFORMATION ABOUT YOUR TENANCY DEPOSIT

Date: {{today}}

To: {{tenant_names}}
Property: {{property_address}}

1. THE DEPOSIT
Amount of deposit: {{deposit}}
Date the deposit was received: [date]

2. THE SCHEME PROTECTING IT
Scheme name: {{deposit_scheme}}
Scheme address: [scheme address]
Scheme telephone: [scheme telephone]
Scheme email and website: [scheme email and website]
Scheme reference or certificate number: [reference]

3. THE LANDLORD
Name: {{landlord_name}}
Address: [landlord's address]
Telephone and email: [landlord's telephone and email]

4. THE TENANT
Name(s): {{tenant_names}}
Address: {{property_address}}
Telephone and email: [tenant's telephone and email]
Contact details to use at the end of the tenancy: [forwarding address, telephone or email]

5. ANYONE ELSE WHO PAID TOWARDS THE DEPOSIT
[Name and contact details, or "None"]

6. WHEN ALL OR PART OF THE DEPOSIT MAY BE KEPT
The deposit may be used, in whole or part, for unpaid rent, damage to the property or its contents beyond fair wear and tear, missing items, and cleaning needed to return the property to its condition at the start of the tenancy, as set out in the tenancy agreement.

7. GETTING THE DEPOSIT BACK
At the end of the tenancy the landlord will tell you in writing of any deductions proposed. Any amount not in dispute will be returned promptly once you and the landlord have agreed it.

8. IF WE CANNOT AGREE, OR YOU CANNOT CONTACT THE LANDLORD
The scheme offers a free dispute resolution service. The enclosed scheme leaflet explains how the deposit is protected, how to apply for its release, and what to do if there is a dispute or if either of us cannot be contacted at the end of the tenancy.

9. CONFIRMATION
The landlord confirms that the information given here is accurate to the best of their knowledge, and that the tenant has been given the opportunity to check it and to sign this document.

Landlord: ______________________________   Date: ______________

Tenant: ________________________________   Date: ______________

Enclosed: the scheme's leaflet for tenants.`,
  },
  {
    id: 'builtin-rent-increase-letter',
    name: 'Rent increase: covering letter',
    description: 'A letter to go with the official rent increase notice. The increase only takes effect if the official form for the nation is completed and served with the right notice period.',
    nations: ALL,
    body: `{{landlord_name}}
[landlord's address]

{{today}}

Dear {{tenant_names}},

Rent for {{property_address}}

I am writing to let you know that I propose to increase the rent for your home.

Current rent: {{rent}} {{rent_frequency}}
Proposed new rent: [new rent] {{rent_frequency}}
Date the new rent would start: [date, giving at least the notice period required]

The rent has not changed since [date of last change or start of tenancy]. I have looked at rents for similar homes in the area and believe the new figure is in line with them.

The formal notice of this increase is enclosed on the official form. Please read it carefully: it explains your right to challenge the increase if you think it is more than the market rent, and the deadline for doing so.

If you pay by standing order, please change the amount to the new rent from the date above. If the increase would cause you difficulty, please get in touch so we can talk about it.

Yours sincerely,

{{landlord_name}}

Enclosed: official notice of rent increase.`,
  },
  {
    id: 'builtin-possession-covering-letter',
    name: 'Notice seeking possession: covering letter',
    description: 'A letter to go with the official notice seeking possession. A landlord can only recover possession through the court or tribunal, on a ground allowed by law, after serving the official notice.',
    nations: ALL,
    body: `{{landlord_name}}
[landlord's address]

{{today}}

Dear {{tenant_names}},

{{property_address}}

I am sorry to have to write to you in these terms. Enclosed is a formal notice that I intend to apply for possession of your home.

The reason is: [reason, for example rent arrears of {{arrears}}, or the ground relied on].

The notice sets out the ground or grounds I am relying on and the earliest date on which I can apply to the court or tribunal. You do not have to leave on that date, and you cannot be made to leave without an order.

I would much prefer to resolve this without going further. If the reason is rent arrears, paying what is owed or agreeing a realistic plan to clear it may mean I do not need to take the next step. Please contact me as soon as you can.

You may wish to get free, independent advice. Shelter, Citizens Advice and your local council's housing team can all help, and you should contact them quickly.

Yours sincerely,

{{landlord_name}}

Enclosed: official notice seeking possession.`,
  },
  {
    id: 'builtin-arrears-first',
    name: 'Rent arrears: first reminder',
    description: 'A polite first letter when rent has been missed.',
    nations: ALL,
    body: `{{landlord_name}}

{{today}}

Dear {{tenant_names}},

Rent for {{property_address}}

My records show that {{arrears}} of rent is currently outstanding.

This may simply be an oversight, or a payment that has crossed with this letter. If you have already paid, thank you, and please let me know the date so I can check.

If not, please pay the outstanding amount within the next seven days. If you are having difficulty paying, please tell me now. It is much easier to agree a way forward early on.

Yours sincerely,

{{landlord_name}}`,
  },
  {
    id: 'builtin-arrears-final',
    name: 'Rent arrears: final reminder',
    description: 'A firmer letter when earlier reminders have not been answered.',
    nations: ALL,
    body: `{{landlord_name}}

{{today}}

Dear {{tenant_names}},

Rent arrears for {{property_address}}

I wrote to you on [date of earlier letter] about unpaid rent and have not received payment or heard from you. The amount outstanding is now {{arrears}}.

Please pay this in full by [date, at least 7 days ahead], or contact me before then to agree a repayment plan that you can keep to.

If I do not hear from you, I will have to consider serving formal notice and applying for possession of the property and a judgment for the money owed. That would add costs and could affect your ability to rent in future, and I would rather avoid it.

If you are struggling with money, free advice is available from Citizens Advice, StepChange and National Debtline. If you may be entitled to help with housing costs, your local council or Universal Credit can advise.

Yours sincerely,

{{landlord_name}}`,
  },
  {
    id: 'builtin-inspection-notice',
    name: 'Notice of inspection visit',
    description: 'Written notice of a routine visit, to be given at least 24 hours beforehand.',
    nations: ALL,
    body: `{{landlord_name}}

{{today}}

Dear {{tenant_names}},

Visit to {{property_address}}

I would like to visit the property to carry out a routine inspection on [date] at [time]. I expect it to take about [30 minutes].

The purpose is to check the condition of the property and to see whether any repairs or maintenance are needed. Please let me know if there is anything you would like me to look at.

If this time is not convenient, please tell me and suggest another. You are welcome to be present, but you do not need to be.

Yours sincerely,

{{landlord_name}}`,
  },
  {
    id: 'builtin-welcome-letter',
    name: 'Welcome letter and key information',
    description: 'What a new tenant needs to know on moving in.',
    nations: ALL,
    body: `{{landlord_name}}

{{today}}

Dear {{tenant_names}},

Welcome to {{property_address}}

I hope you settle in quickly. Here is the key information for your tenancy.

YOUR TENANCY
Start date: {{start_date}}
Rent: {{rent}}, payable {{rent_frequency}}
Deposit: {{deposit}}, protected with {{deposit_scheme}}

DOCUMENTS
With this letter, or already sent to you: the tenancy agreement, the gas safety record, the electrical safety report, the energy performance certificate, the deposit information and the inventory. Please check the inventory and return it signed within seven days, noting anything you disagree with.

REPAIRS
Please report any repair as soon as you notice it, using the app or by contacting me on [telephone / email]. For a gas leak, leave the property and call the gas emergency line: 0800 111 999 in England, Wales and Scotland, or 0800 002 001 in Northern Ireland.

USEFUL LOCATIONS
Stopcock (to turn off the water): [location]
Fuse box: [location]
Gas meter and electricity meter: [location]
Bin collection day: [day]

MOVING IN
Please take meter readings today and register for council tax, water, gas and electricity in your own name.

If anything is unclear, please ask.

Yours sincerely,

{{landlord_name}}`,
  },
  {
    id: 'builtin-end-of-tenancy',
    name: 'End of tenancy: what happens next',
    description: 'Sent when a tenant gives notice, explaining check-out and the deposit.',
    nations: ALL,
    body: `{{landlord_name}}

{{today}}

Dear {{tenant_names}},

End of your tenancy at {{property_address}}

Thank you for letting me know that you will be leaving. Your tenancy will end on [end date].

BEFORE YOU LEAVE
- Rent is payable up to and including the last day of the tenancy.
- Please leave the property clean and in the condition recorded in the inventory, allowing for fair wear and tear.
- Remove all your belongings and any rubbish.
- Take final meter readings and tell your suppliers and the council you are moving.
- Arrange for your post to be redirected.

CHECK-OUT
I would like to carry out the check-out inspection on [date] at [time]. You are welcome to attend. Please return all keys then.

YOUR DEPOSIT
Your deposit of {{deposit}} is held with {{deposit_scheme}}. After the check-out I will write to you within [10 working days] with any deductions I propose and the reasons. Any amount not in dispute will be released promptly. Please give me a forwarding address and email for this.

Thank you for looking after the property.

Yours sincerely,

{{landlord_name}}`,
  },
  {
    id: 'builtin-landlord-reference-request',
    name: 'Reference request to a previous landlord',
    description: 'Asks an applicant\'s previous landlord for a reference.',
    nations: ALL,
    body: `{{landlord_name}}

{{today}}

Dear [previous landlord or agent],

Reference request for [applicant's name]

[Applicant's name] has applied to rent a property from me and has given your name as their current or previous landlord. They have agreed to my contacting you. I would be grateful if you could answer the questions below.

1. What address did they rent from you, and between which dates?
2. What was the rent, and was it paid on time?
3. Were there any rent arrears when they left, or are there any now?
4. Did they keep the property in good condition?
5. Were there any complaints from neighbours, or any breach of the tenancy?
6. Was any of the deposit retained, and if so why?
7. Would you let to them again?

Please reply to [email or address] by [date] if you can. Thank you for your help.

Yours sincerely,

{{landlord_name}}`,
  },
];

/** Ready-made documents written for a nation. */
export function builtInTemplatesFor(nation: Nation): BuiltInTemplate[] {
  return BUILT_IN_TEMPLATES.filter((template) => template.nations.includes(nation));
}
