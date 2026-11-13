#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { PlatformStack } from '../lib/platform-stack';

const app = new cdk.App();

const alertEmail = app.node.tryGetContext('alertEmail');
if (!alertEmail) {
  throw new Error('Pass your email for budget alerts:  npx cdk deploy -c alertEmail=you@example.co.uk');
}

new PlatformStack(app, 'LettlyDev', {
  // London: tenant data stays in the UK.
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: 'eu-west-2' },
  alertEmail,
  emailFrom: app.node.tryGetContext('emailFrom'),
});
