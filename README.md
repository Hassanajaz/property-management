# Lettly (working name)

UK lettings platform for landlords: compliance, rent, referencing, documents and
maintenance. There are two kinds of login only: a landlord, who owns the account
and manages everything in it, and the tenants they invite. There is no agency
or staff role.

It is one app: the same screens run on iPhone, in a web browser and (later) on
Android, so every feature reaches all three at once.

The design document is in [docs/DESIGN.md](docs/DESIGN.md).

## What is here

| Folder | What it is | State |
| --- | --- | --- |
| `packages/core` | Shared rules: compliance rules for all four nations, rent schedule and arrears, affordability, maintenance workflow, plans, sign-in, API client and demo data | **Tested** (27 tests) and type-checked |
| `apps/api` | API (Hono on AWS Lambda), database schema (Drizzle, PostgreSQL), row-level security, invites, maintenance, documents, rent ledger, GoCardless webhook | Written, **not yet run** |
| `apps/server` | Local server and database (SQLite file, no installs) with accounts, tenant sign-ins and file uploads | **Tested** end to end |
| `apps/mobile` | The app for iPhone, web and Android (Expo): landlord dashboard and tools, tenant home, demo mode | Runs on iPhone; **web not yet run** |
| `infra` | AWS CDK stack for London (`eu-west-2`) with a budget alarm | Written, **not yet deployed** |

Only `packages/core` could be executed where this was written, because package
installs were blocked there. Expect to fix small type or version errors in the
other folders on the first `npm install` and `npm run typecheck`. Package
versions were chosen from memory and may need bumping.

## Run it on your own computer (local database)

This is the way to use the app with real, saved data and real logins without
any cloud account:

```bash
bash run-local.sh
```

It starts a small server on your Mac with its data in one database file
(`data/lettly.db`), then opens the app in your browser. Choose "Create a
landlord account" the first time. Leave the Terminal window open while you use
it; Ctrl+C stops everything, and your data is still there next time.

- **iPhone:** keep `run-local.sh` running, then in a second Terminal window run
  `bash run-on-iphone.sh`. The installed app talks to the server on your Mac,
  so the phone must be on the same Wi-Fi, and it stops working if the Mac is
  asleep or its Wi-Fi address changes (rebuild to fix).
- **Tenant logins:** open a property with a tenancy and use "Give a tenant a
  sign-in". No email is sent from a local server, so the app shows a temporary
  password for you to pass on.
- **Backups:** copy the `data` folder. Delete it to start again from nothing.
- **Back to demo mode:** delete `apps/mobile/.env`.

The local server needs Node 22.13 or later and no other installs. It keeps
each landlord account's data as one document, which is right for testing and
for one landlord's own use, not for hosting many customers. The AWS setup in
`infra/` and `apps/api/` remains the route to a hosted service.

## Try it on your iPhone (demo mode, no backend)

The mobile app runs on sample data whenever no API address is configured, so
you can try it before anything is deployed to AWS. From this folder on your Mac:

```bash
./run-on-iphone.sh            # builds with Xcode and installs on the plugged-in iPhone
./run-on-iphone.sh expo-go    # no Xcode: scan a QR code and run inside Expo Go
./run-on-iphone.sh web        # opens the same app in your browser on this Mac
```

**Install with Xcode (default).** Needs Xcode from the Mac App Store, the
iPhone connected by cable, and your Apple ID added in Xcode > Settings >
Accounts (a free Apple ID works). On the iPhone, turn on Settings > Privacy &
Security > Developer Mode, and after the install trust your Apple ID under
Settings > General > VPN & Device Management. With a free Apple ID the app
stops opening after 7 days; run the script again to renew it.

**Expo Go.** Install Expo Go from the App Store and keep the phone and Mac on
the same Wi-Fi. The project targets Expo SDK 54, the version the App Store
Expo Go supported when this was written. If Expo Go reports that the project
is incompatible, run `EXPO_SDK=58 ./run-on-iphone.sh expo-go`.

In the app, choose Landlord or Tenant. The landlord home is a portfolio
dashboard with sections for properties, rent, compliance, repairs, documents,
applicants and tools. From it the landlord can:

- add a property, record its value and mortgage (equity, loan to value, yield),
  and share the properties table as CSV;
- open a rent statement, record a payment, share a receipt, preview an arrears
  reminder, and see a paid-on-time score and the next rent review date;
- run a repair, assign a contractor and record the quote and final cost;
- mark compliance items done, and see the 60, 30 and 7 day reminder ladder;
- decide an applicant's referencing and make them the tenant;
- start a tenancy on a vacant property, and log a repair themselves;
- keep an inventory with check-in and check-out conditions and share the report;
- record a rent change, end a tenancy, and share a compliance summary;
- share every report (inventory, compliance summary, accountant pack, properties
  table, receipts, arrears reminders, adverts) as a PDF or as text;
- use the tools: finance and tax-year figures with mileage and an accountant
  pack, rent reviews, inspections with the 24-hour notice check, contractors,
  the key register, the deposit register, Right to Rent checks with follow-up
  dates, adverts and viewings, a notices log and possession tracker, ready-made
  documents and their own templates (filled in from a tenancy and shared as a
  PDF), importing properties from a spreadsheet, and their
  account and password. Data is shared between
the two while the app stays open: report a repair as the tenant, tap
"Switch person", and handle it as the landlord.

This script has not been run by its author: package installs were blocked
where the code was written. Send any error it prints and it can be fixed.

## First run

You need Node 22.6 or later and an AWS account (choose the Paid plan; the
sign-up credits still apply).

```bash
npm install
npm test                # shared rules and local server: all tests should pass
npm run typecheck       # fix anything reported before going further

```

### Deploy the backend

```bash
aws configure                                   # credentials for your AWS account
cd infra && npx cdk bootstrap aws://ACCOUNT_ID/eu-west-2
npx cdk deploy -c alertEmail=you@example.co.uk  # prints the outputs used below
```

Then, with the outputs exported in your shell (see `.env.example`):

```bash
cd apps/api
npm run db:generate      # writes SQL migrations from the schema
npm run db:migrate       # applies them and turns on row-level security
npm run org:create -- "Your Lettings" you@example.co.uk "Your Name" england
```

You receive an email with a temporary password. The database pauses when idle,
so the first request after a quiet spell can take several seconds or fail once;
retry it.

### Run the apps

```bash
cp .env.example apps/mobile/.env      # keep the EXPO_PUBLIC_ lines, fill them in
npm run dev:web                       # the app in your browser
npm run dev:mobile                    # or scan the QR code with Expo Go
```

## How the logins work

- A landlord account is created with `npm run org:create` (self-service sign-up
  comes later). The landlord sees and manages everything on their account.
- The landlord creates a tenancy with its tenants, then invites each tenant
  (`POST /tenants/:id/invite`). The invite creates a sign-in whose account and
  role are set by the API and cannot be changed by the user.
- A tenant sees only their own tenancy: rent, documents and repairs. The
  database additionally refuses rows from any other landlord's account.
- A tenant reports a repair with photos; the landlord reviews, books and
  completes it; each update emails the tenant (and sends a push notification
  once the app registers push tokens); the tenant confirms the fix or reopens it.

## Not in the AWS backend yet

Every feature works on the local server and in demo mode. The landlord tools added most recently (contractors and work orders, keys,
inspections, expenses, mileage, applicant decisions, property value and
mortgage, the all-payments list, inventories, Right to Rent records, deposit
scheme, rent changes, adverts, viewings, notices, possession cases, templates,
spreadsheet import) have API methods
defined in `packages/core/src/client.ts`, but the matching AWS routes and
database tables are **not written yet**, so they will fail against a deployed
AWS backend until those are added.

## Not built, and why

- Direct Debit collection: needs GoCardless partner approval.
- Making Tax Digital submissions to HMRC: needs HMRC recognition as a software
  provider. The finance tool gives tax-year figures to copy across instead.
- Xero, e-signatures, SMS reminders: each needs an account with that provider.
- The official prescribed notice forms themselves (for example Form 4 for a
  rent increase, Form 3 for possession in England). The law requires the
  official form, so the app supplies covering letters that go with it. The
  other ready-made documents (tenancy agreement for England, deposit
  information, arrears letters, inspection notice, welcome and end of tenancy
  letters, reference request) are built in. They are plain-English starting
  points and have not been checked by a solicitor.
- Reading dates off certificates automatically, and the AI advisor: each needs
  an AI service connected.
- Read-only access for an accountant: left out because there are only two kinds
  of login. The finance tool shares an accountant pack instead.

## Known gaps (next work, in order)

1. Install, type-check and deploy; fix what the first run shows.
2. Screens for adding tenancies and inviting tenants (the API routes exist).
3. Email sending needs a verified SES sender: pass `-c emailFrom=...` on deploy.
4. Push notifications: add `expo-notifications` and call `api.registerPushToken`.
5. Rent: GoCardless mandates and payment creation (webhook handling exists but
   is untested); Stripe subscriptions for plans.
6. Referencing screens (tables and affordability logic exist).
7. Reminder job for certificates due in 60, 30 and 7 days.

## Important

`packages/core/src/compliance/rules.ts` is a seed rule set written from general
knowledge. It is not legal advice. Have a lettings solicitor review it before
other landlords rely on it.
