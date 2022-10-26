#!/usr/bin/env npx ts-node
import { CUR, SharedIniFileCredentials, STS } from 'aws-sdk';
import { ConfigurationOptions } from 'aws-sdk/lib/config-base';
import { Command } from "commander";
import CostService from './cost-service';
import IdentityService from './identity-service';
import inquirer from 'inquirer';
import util from 'aws-sdk/lib/util';

function getProfiles(): string[] {
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
    });
  } catch(e) {
    throw new Error('Could not get profiles from ini file');
  }
}

async function checkBasicCreds(config?: ConfigurationOptions): Promise<ConfigurationOptions | undefined>{
  try {
    const identityService = new IdentityService(new STS(config));
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

async function getConfig(): Promise<ConfigurationOptions | undefined> {
  const config = await checkBasicCreds();
  if(config) return config;
  const {lookupProfiles} = await inquirer.prompt([{ type: 'confirm', name: 'lookupProfiles', message: `Would you like to select another profile from your local credentials?`}]);
  if(lookupProfiles) {
    const profiles = getProfiles();
    const {selectedProfile} = await inquirer.prompt([{ type: 'list', name: 'selectedProfile', choices: profiles}]);
    const config = { credentials: new SharedIniFileCredentials({profile: selectedProfile})};
    return checkBasicCreds(config);
  }
  return undefined;
}

async function run(command: {region: string}){
  const config = await getConfig();
  if(!config) process.exit(0);
  const costService = new CostService(new CUR({region: 'us-east-1', ...config}));
  const validReports = await costService.getValidReports();
  const reportOptions = validReports.map((it, index) => ({ name: `${index + 2}. Name: ${it.ReportName} S3 Bucket: ${it.S3Bucket} S3 Region: ${it.S3Region} Prefix: ${it.S3Prefix}`, value: it.ReportName}));
  const {selectedReport} = await inquirer.prompt([{ message: 'Select a report or choose Create New Report', loop: false, type: 'list', name: 'selectedReport', choices: [{name: '1. Create New Report', value: '#CreateNew'}, ...reportOptions]}]);
  console.log(selectedReport);
}


(async () => {
  const createCommand = new Command('Create')
    .command("create")
    .option('-r, --region <region>', 'AWS Region')
    .action(run);
  try {
    await createCommand.parseAsync(process.argv);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();