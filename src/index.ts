#!/usr/bin/env node

import { CUR, IAM, Organizations, S3, SharedIniFileCredentials, SNS, SsoCredentials, STS } from 'aws-sdk';
import { ConfigurationOptions } from 'aws-sdk/lib/config-base';
import { Command } from "commander";
import { randomUUID } from 'crypto';
import CostService from './cost-service';
import IdentityService from './identity-service';
import inquirer from 'inquirer';
import util from 'aws-sdk/lib/util';

function getProfiles(): {profile: string, type: 'sso' | 'ini'}[] {
  try {
    const now = new Date().getDate();
    const profiles = util.getProfilesFromSharedConfig(util.iniLoader);
    return Object.keys(profiles).filter(profile => {
      const expiry = profiles[profile].aws_expiry_token ?? profiles[profile].aws_expiration;
      if (expiry) {
        const expiration = new Date(expiry).getDate();
        if (expiration < now) {
          console.log(profile, ' has expired')
          return false;
        }
      }
      return true;
    }).map(profile => {
      if(profiles[profile].sso_account_id) return { profile, type: 'sso'};
      return {profile, type: 'ini'};
    });
  } catch(e) {
    throw new Error('Could not get profiles from ini file');
  }
}

async function checkBasicCreds(config?: ConfigurationOptions): Promise<ConfigurationOptions | undefined>{
  try {
    const identityService = new IdentityService(new STS(config), new Organizations(config));
    const awsAccountId = await identityService.getAccountIdentity();
    const {accountCorrect} = await inquirer.prompt([{
      type: 'confirm',
      name: 'accountCorrect',
      message: `Found Credentials for AWS Account ${awsAccountId}, Continue?`
    }]);
    if(accountCorrect) {
      return config ?? {};
    }
  } catch (e) {
   //Do nothing
  }
  return undefined;
}

async function getConfig(initial: ConfigurationOptions): Promise<ConfigurationOptions | undefined> {
  const config = await checkBasicCreds(initial);
  if(config) return config;
  const {lookupProfiles} = await inquirer.prompt([{ type: 'confirm', name: 'lookupProfiles', message: `Would you like to select another profile from your local credentials?`}]);
  if(lookupProfiles) {
    const profiles = getProfiles();
    const {selectedProfile} = await inquirer.prompt([{ type: 'list', name: 'selectedProfile', choices: profiles.map(profile => profile.profile)}]);
    const profile = profiles.find(it => it.profile === selectedProfile)!;
    const config = { credentials: profile.type === 'ini' ? new SharedIniFileCredentials({profile: selectedProfile}) : new SsoCredentials({profile: selectedProfile})};
    return checkBasicCreds(config);
  }
  return undefined;
}

function connectorUrl(handshake: string, reportName: string, reportBucket: string, reportPrefix: string, reportRegion: string, region?: string, environment?: string): string {
  const actualRegion = region ?? 'us-east-1';
  const uniqueId = randomUUID().replace(/-/g, '').substring(0, 8);
  if(environment === 'dev') {
    return `https://${actualRegion}.console.aws.amazon.com/cloudformation/home?region=${actualRegion}#/stacks/quickcreate?templateUrl=https%3A%2F%2Fklouds-user-template.s3.eu-west-1.amazonaws.com%2Fend-to-end-manual.json&stackName=klouds-connector&param_ConnectorEndpoint=arn%3Aaws%3Asns%3Aus-east-1%3A662158168835%3Aklouds-connection-connector-dev&param_ConnectorExternalId=741bef1f-594a-40a5-99b3-8fe3cf29e9a0&param_ConnectorPrincipalId=AROAZUK5T2MB6I655JA67&param_KloudsUserIdentifier=${handshake}&param_UniqueId=${uniqueId}&param_ReportBucket=${reportBucket}&param_ReportBucketRegion=${reportRegion}&param_ReportPrefix=${reportPrefix}&param_ReportName=${reportName}`
  }
  return `https://${actualRegion}.console.aws.amazon.com/cloudformation/home?region=${actualRegion}#/stacks/quickcreate?templateUrl=https%3A%2F%2Fklouds-user-template.s3.eu-west-1.amazonaws.com%2Fend-to-end-manual.json&stackName=klouds-connector&param_ConnectorEndpoint=arn%3Aaws%3Asns%3Aus-east-1%3A051442910996%3Aklouds-connection-connector-prod&param_ConnectorExternalId=741bef1f-594a-40a5-99b3-8fe3cf29e9a0&param_ConnectorPrincipalId=AROAQX6R4Q4KCQSNZ62HA&param_KloudsUserIdentifier=${handshake}&param_UniqueId=${uniqueId}&param_ReportBucket=${reportBucket}&param_ReportBucketRegion=${reportRegion}&param_ReportPrefix=${reportPrefix}&param_ReportName=${reportName}`;
}

function stackSetUrl(ouIds: string[], handshake: string, reportName: string, reportBucket: string, reportPrefix: string, reportRegion: string, region?: string, environment?: string): string {
  const actualRegion = region ?? 'us-east-1';
  const uniqueId = randomUUID().replace(/-/g, '').substring(0, 8);
  if(environment === 'dev') {
    return `https://${actualRegion}.console.aws.amazon.com/cloudformation/home?region=${actualRegion}#/stacks/quickcreate?templateUrl=https%3A%2F%2Fklouds-user-template.s3.eu-west-1.amazonaws.com%2Fklouds-stack-set-with-cost-reports.json&param_OrganizationalUnitIds=${ouIds.join(',')}&stackName=klouds-connector&param_ConnectorEndpoint=arn%3Aaws%3Asns%3Aus-east-1%3A662158168835%3Aklouds-connection-connector-dev&param_ConnectorExternalId=741bef1f-594a-40a5-99b3-8fe3cf29e9a0&param_ConnectorPrincipalId=AROAZUK5T2MB6I655JA67&param_KloudsUserIdentifier=${handshake}&param_UniqueId=${uniqueId}&param_ReportBucketArn=${reportBucket}&param_ReportBucketRegion=${reportRegion}&param_ReportPrefix=${reportPrefix}&param_ReportName=${reportName}`
  }
  return `https://${actualRegion}.console.aws.amazon.com/cloudformation/home?region=${actualRegion}#/stacks/quickcreate?templateUrl=https%3A%2F%2Fklouds-user-template.s3.eu-west-1.amazonaws.com%2Fklouds-stack-set-with-cost-reports.json&param_OrganizationalUnitIds=${ouIds.join(',')}&stackName=klouds-connector&param_ConnectorEndpoint=arn%3Aaws%3Asns%3Aus-east-1%3A051442910996%3Aklouds-connection-connector-prod&param_ConnectorExternalId=741bef1f-594a-40a5-99b3-8fe3cf29e9a0&param_ConnectorPrincipalId=AROAQX6R4Q4KCQSNZ62HA&param_KloudsUserIdentifier=${handshake}&param_UniqueId=${uniqueId}&param_ReportBucketArn=${reportBucket}&param_ReportBucketRegion=${reportRegion}&param_ReportPrefix=${reportPrefix}&param_ReportName=${reportName}`;
}


async function createStack(identityService: IdentityService, costService: CostService, handshake: string, reportName: string, reportBucket: string, reportPrefix: string, reportRegion: string, region?: string, environment?: string) {
  const {allAccounts} = await inquirer.prompt([{ type: 'list', name: 'allAccounts', message: `Would you like to connect full AWS Organisation (This will enable Trusted Access) or just this Account.`, choices: ['Organisation', 'This Account']}]);
  if(allAccounts) {
    console.log('Ensuring Trusted Access is enabled');
    await identityService.enabledTrustedAccess();
    console.log('Looking for Organisational Identifiers');
    const ids = await identityService.listIds();
    const {orgIds} = await inquirer.prompt([{ type: 'checkbox', name: 'orgIds', message: `Select from the list of Organisation Roots or Organisational units to connect to`, validate: (result) => result.length === 0 ? 'You must select at lest one option' : true, choices: ids.map(it => ({name: `${it.name} (${it.id})`, value: it.id}))}]);
    console.log('Please login to the AWS Console and click the link below to create the CloudFormation Stack');
    console.log(stackSetUrl(orgIds, handshake, reportName, reportBucket, reportPrefix, reportRegion, region, environment));
  }
  else {
    const {choice} = await inquirer.prompt([{
      type: 'list',
      name: 'choice',
      message: `Would you like to use CloudFormation or this cli to create the cross account IAM role`,
      choices: ['CloudFormation', 'CLI']
    }]);
    if (choice === 'CloudFormation') {
      console.log('Please login to the AWS Console and click the link below to create the CloudFormation Stack');
      console.log(connectorUrl(handshake, reportName, reportBucket, reportPrefix, reportRegion, region, environment));
    } else {
      const externalId = '741bef1f-594a-40a5-99b3-8fe3cf29e9a0';
      const principalId = environment === 'dev' ? 'AROAZUK5T2MB6I655JA67' : 'AROAQX6R4Q4KCQSNZ62HA';
      const topic = environment === 'dev' ? 'arn:aws:sns:us-east-:662158168835:klouds-connection-connector-dev' : 'arn:aws:sns:us-east-1:051442910996:klouds-connection-connector-prod';
      const roleArn = await costService.createRole(principalId, externalId, reportBucket);
      await costService.publishEvent(topic, roleArn, handshake, reportBucket, reportRegion, reportName, reportPrefix, region ?? 'us-east-1');
      console.log('Return to klouds.io to see new connection');
    }
  }
}

async function run(command: {region?: string, environment?: string, handshake: string}){
  const config = await getConfig({region: command.region});
  if(!config) process.exit(0);
  const costService = new CostService(new S3({...config, region: 'us-east-1'}), new IAM({...config, region: 'us-east-1'}), new SNS({...config, region: 'eu-west-1'}), new CUR({...config, region: 'us-east-1'}));
  const identityService = new IdentityService(new STS(config), new Organizations({...config, region: 'us-east-1'}));
  const validReports = await costService.getValidReports();
  const reportOptions = validReports.map((it, index) => ({ name: `${index + 2}. Name: ${it.ReportName} S3 Bucket: ${it.S3Bucket} S3 Region: ${it.S3Region} Prefix: ${it.S3Prefix}`, value: it.ReportName}));
  const {selectedReport} = await inquirer.prompt([{ message: 'Select a report or choose Create New Report', loop: false, type: 'list', name: 'selectedReport', choices: [{name: '1. Create New Report', value: '#CreateNew'}, ...reportOptions]}]);
  if(selectedReport === '#CreateNew') {
    const {createS3Bucket} = await inquirer.prompt([{ type: 'confirm', name: 'createS3Bucket', message: `Would you like to create an S3 bucket for the reports?`}]);
    const {bucketName} = await inquirer.prompt([{ type: 'input', name: 'bucketName', message: `S3 Bucket Name`}]);
    if(createS3Bucket) {
      console.log('Creating S3 Bucket and Policy');
      await costService.createBucket(bucketName, command.region ?? 'us-east-1');
    }
    const {reportName, reportPrefix} = await inquirer.prompt([{ type: 'input', name: 'reportName', message: `Report Name`, default: 'cost-and-usage-reports'}, { type: 'input', name: 'reportPrefix', message: `Report Prefix`, default: 'costs'}]);
    console.log('Creating Cost and Usage Report');
    await costService.createReport(reportName, bucketName, command.region ?? 'us-east-1', reportPrefix);
    await createStack(identityService, costService, command.handshake, reportName, bucketName, reportPrefix, command.region ?? 'us-east-1', command.region, command.environment);
  } else {
    const report = validReports.find(it => it.ReportName === selectedReport)!;
    await createStack(identityService, costService, command.handshake, report.ReportName, report.S3Bucket, report.S3Prefix, report.S3Region, command.region, command.environment);
  }
}

(async () => {
  const createCommand = new Command('Create')
    .command("create")
    .option('-r, --region <region>', 'AWS Region', 'us-east-1')
    .option('-e, --environment <environment>', 'Production or Development', 'prod')
    .requiredOption('-h, --handshake <handshake>', 'Handshake ID to link klouds.io account user')
    .action(run);
  try {
    await createCommand.parseAsync(process.argv);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();