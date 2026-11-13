import * as path from 'node:path';
import * as cdk from 'aws-cdk-lib';
import * as apigw from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as budgets from 'aws-cdk-lib/aws-budgets';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secrets from 'aws-cdk-lib/aws-secretsmanager';
import type { Construct } from 'constructs';

export interface PlatformStackProps extends cdk.StackProps {
  /** Where budget alerts are sent. */
  alertEmail: string;
  /** Verified SES sender address; leave empty to disable emails. */
  emailFrom?: string;
}

const REPO_ROOT = path.join(__dirname, '..', '..');
const DB_NAME = 'lettly';

/**
 * Everything the platform runs on. Cost guardrails:
 *  - no NAT gateway and no public IPv4 addresses (the API reaches the database
 *    over the RDS Data API, so Lambda stays outside the private network);
 *  - the database pauses when idle;
 *  - a budget emails you at $10, $25 and $50 of gross monthly spend.
 */
export class PlatformStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: PlatformStackProps) {
    super(scope, id, props);

    // ------------------------------------------------------------- database
    const vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [{ name: 'database', subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 }],
    });

    const database = new rds.DatabaseCluster(this, 'Database', {
      engine: rds.DatabaseClusterEngine.auroraPostgres({ version: rds.AuroraPostgresEngineVersion.VER_16_6 }),
      writer: rds.ClusterInstance.serverlessV2('writer'),
      serverlessV2MinCapacity: 0, // pauses when idle; the first request after a pause takes a few seconds
      serverlessV2MaxCapacity: 2,
      serverlessV2AutoPauseDuration: cdk.Duration.minutes(10),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      enableDataApi: true,
      defaultDatabaseName: DB_NAME,
      credentials: rds.Credentials.fromGeneratedSecret('lettly_admin'),
      storageEncrypted: true,
      backup: { retention: cdk.Duration.days(7) },
      deletionProtection: true,
      removalPolicy: cdk.RemovalPolicy.SNAPSHOT,
    });

    // The API signs in as app_user, which owns no tables, so row-level security always applies.
    const appUserSecret = new secrets.Secret(this, 'AppUserSecret', {
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'app_user' }),
        generateStringKey: 'password',
        excludePunctuation: true,
        passwordLength: 32,
      },
    });

    // -------------------------------------------------------------- sign-in
    const userPool = new cognito.UserPool(this, 'Users', {
      selfSignUpEnabled: false, // people are invited by an agency
      signInAliases: { email: true },
      signInCaseSensitive: false,
      customAttributes: {
        org_id: new cognito.StringAttribute({ mutable: true }),
        role: new cognito.StringAttribute({ mutable: true }),
      },
      passwordPolicy: { minLength: 10, requireDigits: true, requireLowercase: true, requireUppercase: false, requireSymbols: false },
      mfa: cognito.Mfa.OPTIONAL,
      mfaSecondFactor: { otp: true, sms: false },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      userInvitation: {
        emailSubject: 'Your lettings account',
        emailBody: 'Hello,<br><br>An account has been created for you. Sign in with your email address {username} and this temporary password: <b>{####}</b><br><br>You will be asked to choose your own password.',
      },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const userPoolClient = userPool.addClient('Apps', {
      authFlows: { userPassword: true },
      generateSecret: false,
      preventUserExistenceErrors: true,
      idTokenValidity: cdk.Duration.hours(1),
      refreshTokenValidity: cdk.Duration.days(30),
      readAttributes: new cognito.ClientAttributes().withStandardAttributes({ email: true, fullname: true }).withCustomAttributes('org_id', 'role'),
      // Users must never be able to change their own organisation or role.
      writeAttributes: new cognito.ClientAttributes().withStandardAttributes({ fullname: true }),
    });

    // ------------------------------------------------------------ documents
    const documents = new s3.Bucket(this, 'Documents', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      cors: [{ allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.GET], allowedOrigins: ['*'], allowedHeaders: ['*'], maxAge: 3000 }],
      lifecycleRules: [{ noncurrentVersionExpiration: cdk.Duration.days(90), abortIncompleteMultipartUploadAfter: cdk.Duration.days(1) }],
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // ------------------------------------------------------------------ api
    const apiFunction = new NodejsFunction(this, 'ApiFunction', {
      entry: path.join(REPO_ROOT, 'apps', 'api', 'src', 'lambda.ts'),
      projectRoot: REPO_ROOT,
      depsLockFilePath: path.join(REPO_ROOT, 'package-lock.json'),
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 512,
      timeout: cdk.Duration.seconds(29),
      environment: {
        DB_NAME,
        DB_CLUSTER_ARN: database.clusterArn,
        DB_SECRET_ARN: appUserSecret.secretArn,
        USER_POOL_ID: userPool.userPoolId,
        USER_POOL_CLIENT_ID: userPoolClient.userPoolClientId,
        DOCUMENTS_BUCKET: documents.bucketName,
        EMAIL_FROM: props.emailFrom ?? '',
      },
    });

    appUserSecret.grantRead(apiFunction);
    apiFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['rds-data:ExecuteStatement', 'rds-data:BatchExecuteStatement', 'rds-data:BeginTransaction', 'rds-data:CommitTransaction', 'rds-data:RollbackTransaction'],
        resources: [database.clusterArn],
      }),
    );
    documents.grantReadWrite(apiFunction);
    userPool.grant(apiFunction, 'cognito-idp:AdminCreateUser');
    apiFunction.addToRolePolicy(new iam.PolicyStatement({ actions: ['ses:SendEmail'], resources: ['*'] }));

    const api = new apigw.HttpApi(this, 'Api', {
      defaultIntegration: new HttpLambdaIntegration('ApiIntegration', apiFunction),
      corsPreflight: {
        allowOrigins: ['*'],
        allowMethods: [apigw.CorsHttpMethod.ANY],
        allowHeaders: ['Authorization', 'Content-Type'],
      },
    });

    // ------------------------------------------------------------------ web
    const webBucket = new s3.Bucket(this, 'Web', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });
    const web = new cloudfront.Distribution(this, 'WebDistribution', {
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(webBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      defaultRootObject: 'index.html',
      // Single-page app: unknown paths serve the app, which handles routing.
      errorResponses: [403, 404].map((httpStatus) => ({ httpStatus, responseHttpStatus: 200, responsePagePath: '/index.html' })),
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
    });

    // --------------------------------------------------------------- budget
    new budgets.CfnBudget(this, 'MonthlyBudget', {
      budget: {
        budgetName: `${this.stackName}-monthly`,
        budgetType: 'COST',
        timeUnit: 'MONTHLY',
        budgetLimit: { amount: 50, unit: 'USD' },
        // Show gross spend: do not let credits hide what is being used.
        costTypes: { includeCredit: false, includeRefund: false },
      },
      notificationsWithSubscribers: [20, 50, 100].map((threshold) => ({
        notification: { notificationType: 'ACTUAL', comparisonOperator: 'GREATER_THAN', threshold, thresholdType: 'PERCENTAGE' },
        subscribers: [{ subscriptionType: 'EMAIL', address: props.alertEmail }],
      })),
    });

    // -------------------------------------------------------------- outputs
    const outputs: Record<string, string> = {
      ApiUrl: api.apiEndpoint,
      WebUrl: `https://${web.distributionDomainName}`,
      WebBucketName: webBucket.bucketName,
      WebDistributionId: web.distributionId,
      UserPoolId: userPool.userPoolId,
      UserPoolClientId: userPoolClient.userPoolClientId,
      DbName: DB_NAME,
      DbClusterArn: database.clusterArn,
      DbAdminSecretArn: database.secret!.secretArn,
      DbAppSecretArn: appUserSecret.secretArn,
      DocumentsBucketName: documents.bucketName,
    };
    for (const [name, value] of Object.entries(outputs)) new cdk.CfnOutput(this, name, { value });
  }
}
