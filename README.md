# Lettly (working name)

UK lettings platform: compliance, rent, referencing, documents and maintenance,
for letting agencies and self-managing landlords. One sign-in for agency staff,
landlords and tenants, on web and mobile.

The design document is in [docs/DESIGN.md](docs/DESIGN.md).

## What is here

| Folder | What it is | State |
| --- | --- | --- |
| `packages/core` | Shared rules: compliance rules for all four nations, rent schedule and arrears, affordability, maintenance workflow, plans, sign-in, API client and demo data | **Tested** (20 tests) and type-checked |
| `apps/api` | API (Hono on AWS Lambda), database schema (Drizzle, PostgreSQL), row-level security, invites, maintenance, documents, rent ledger, GoCardless webhook | Written, **not yet run** |
| `apps/web` | Web app (React, Vite): sign-in, compliance table, repairs, add property | Written, **not yet run** |
| `apps/mobile` | iOS and Android app (Expo): sign-in, home, report a repair with photos, repair timeline | Written, **not yet run** |
| `infra` | AWS CDK stack for London (`eu-west-2`) with a budget alarm | Written, **not yet deployed** |

Only `packages/core` could be executed where this was written, because package
installs were blocked there. Expect to fix small type or version errors in the
other folders on the first `npm install` and `npm run typecheck`. Package
versions were chosen from memory and may need bumping.

## Try it on your iPhone (demo mode, no backend)

The mobile app runs on sample data whenever no API address is configured, so
you can try it before anything is deployed to AWS. From this folder on your Mac:

```bash
./run-on-iphone.sh            # builds with Xcode and installs on the plugged-in iPhone
./run-on-iphone.sh expo-go    # no Xcode: scan a QR code and run inside Expo Go
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

In the app, choose Tenant, Agency staff or Landlord. Data is shared between
the three while the app stays open: report a repair as the tenant, tap
"Switch person", and handle it as agency staff.

This script has not been run by its author: package installs were blocked
where the code was written. Send any error it prints and it can be fixed.

## First run

You need Node 22.6 or later and an AWS account (choose the Paid plan; the
sign-up credits still apply).

```bash
npm install
npm test                # shared rules: should print 20 passing tests
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
npm run org:create -- "Your Agency" you@example.co.uk "Your Name" agency england
```

You receive an email with a temporary password. The database pauses when idle,
so the first request after a quiet spell can take several seconds or fail once;
retry it.

### Run the apps

```bash
cp .env.example apps/web/.env.local   # keep the VITE_ lines, fill them in
npm run dev:web

cp .env.example apps/mobile/.env      # keep the EXPO_PUBLIC_ lines
npm run dev:mobile                    # scan the QR code with Expo Go on your iPhone
```

## How the logins work

- Staff create a tenancy with its tenants, then invite each tenant
  (`POST /tenants/:id/invite`). Landlords are invited the same way
  (`POST /landlords/:id/invite`).
- The invite creates a Cognito user whose organisation and role are set by the
  API and cannot be changed by the user.
- Tenants see only their own tenancy; landlords see only their own properties;
  the database additionally refuses rows from any other organisation.
- Tenants report a repair with photos; staff triage, book and complete it;
  each update emails the tenant (and sends a push notification once the app
  registers push tokens); the tenant confirms the fix or reopens it.

## Known gaps (next work, in order)

1. Install, type-check and deploy; fix what the first run shows.
2. Web screens for landlords, tenancies and invites (the API routes exist).
3. Email sending needs a verified SES sender: pass `-c emailFrom=...` on deploy.
4. Push notifications: add `expo-notifications` and call `api.registerPushToken`.
5. Rent: GoCardless mandates and payment creation (webhook handling exists but
   is untested); Stripe subscriptions for plans.
6. Referencing screens (tables and affordability logic exist).
7. Reminder job for certificates due in 60, 30 and 7 days.

## Important

`packages/core/src/compliance/rules.ts` is a seed rule set written from general
knowledge. It is not legal advice. Have a lettings solicitor review it before
other agencies rely on it.
