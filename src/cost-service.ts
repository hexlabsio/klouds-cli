import { CUR, IAM, S3, SNS } from 'aws-sdk';
import { ReportDefinition } from 'aws-sdk/clients/cur';
import { randomUUID } from 'crypto';

export default class CostService {
  constructor(
    private readonly s3: S3,
    private readonly iam: IAM,
    private readonly sns: SNS,
    private readonly costService: CUR
  ) {
  }

  policyForBucket(name: string) {
    return {
      Version: "2012-10-17",
      Statement: [
        {
          Effect: 'Allow',
          Principal: {Service: ['billingreports.amazonaws.com']},
          Action: ['s3:GetBucketAcl', 's3:GetBucketPolicy'],
          Resource: `arn:aws:s3:::${name}`
        },
        {
          Effect: 'Allow',
          Principal: {Service: ['billingreports.amazonaws.com']},
          Action: ['s3:PutObject'],
          Resource: `arn:aws:s3:::${name}/*`
        }
      ]
    };
  }

  async getValidReports(): Promise<ReportDefinition[]> {
    const reports = await this.costService.describeReportDefinitions().promise();
    const validReports = (reports.ReportDefinitions ?? []).filter(it => it.TimeUnit === 'DAILY' && it.Format === 'textORcsv' && it.Compression === 'GZIP' && it.AdditionalSchemaElements?.includes('RESOURCES'))
    console.log('Found', validReports.length, 'daily gzipped csv reports with resource ids enabled out of a total of', reports.ReportDefinitions?.length ?? 0,' reports');
    return validReports;
  }

  async listBuckets(): Promise<string[]> {
    try {
      const result = await this.s3.listBuckets().promise();
      return (result.Buckets ?? []).map(it => it.Name!).sort();
    } catch(e) {
      console.error('Could not list buckets');
      return [];
    }
  }

  async createBucket(name: string, region?: string): Promise<void> {
    await this.s3.createBucket({
      Bucket: name,
     ...(region ? { CreateBucketConfiguration: { LocationConstraint: region } } : {}),
    }).promise();
    await this.s3.putBucketPolicy({Bucket: name, Policy: JSON.stringify(this.policyForBucket(name))}).promise();
  }

  async createReport(reportName: string, bucket: string, region: string, prefix: string): Promise<void> {
    await this.costService.putReportDefinition({
      ReportDefinition: {
        "ReportName": reportName,
        "TimeUnit": "DAILY",
        "Format": "textORcsv",
        "Compression": "GZIP",
        "AdditionalSchemaElements": [
          "RESOURCES"
        ],
        "S3Bucket": bucket,
        "S3Prefix": prefix,
        "S3Region": region,
        "AdditionalArtifacts": [],
        "RefreshClosedReports": true,
        "ReportVersioning": "OVERWRITE_REPORT"
      }
    }).promise();
  }

  async createRole(principalId: string, externalId: string, bucket: string): Promise<string> {
    const uniqueId = randomUUID().replace(/-/g, '').substring(0, 8);
    console.log('Creating Role named', `klouds-connector-${uniqueId}`)
    const role = await this.iam.createRole({
      RoleName: `klouds-connector-${uniqueId}`,
      AssumeRolePolicyDocument: JSON.stringify({
        Statement: [{ Effect: 'Allow', Principal: { AWS: [principalId]}, Action: 'sts:AssumeRole', Condition: { StringEquals: { 'sts:ExternalId': externalId } } }]
      })
    }).promise();
    console.log('Creating role policy');
    await this.iam.attachRolePolicy({RoleName: `klouds-connector-${uniqueId}`, PolicyArn: 'arn:aws:iam::aws:policy/SecurityAudit'}).promise();
    const policy = await this.iam.createPolicy({
      PolicyName: `klouds-connector-${uniqueId}-read-policy`,
      PolicyDocument: JSON.stringify({
        Version: '2012-10-17',
        Statement: [{Action: 'apigateway:GET', Effect: 'Allow', Resource: [
            "arn:aws:apigateway:*::/domainnames",
            "arn:aws:apigateway:*::/domainnames/*",
            "arn:aws:apigateway:*::/domainnames/*/basepathmappings",
            "arn:aws:apigateway:*::/domainnames/*/basepathmappings/*"
          ]}, {Action: ['s3:ListBucket', 's3:GetObject'], Effect: 'Allow', Resource: [
            `arn:aws:s3:::${bucket}`,
            `arn:aws:s3:::${bucket}/*`
          ]}]
      })
    }).promise();
    await this.iam.attachRolePolicy({RoleName: `klouds-connector-${uniqueId}`, PolicyArn: policy.Policy!.Arn! }).promise();
    console.log('Waiting for policies to attach');
    await new Promise(resolve => setTimeout(resolve, 10000));
    return role.Role.Arn;
  }

  async publishEvent(topic: string, roleArn: string, userId: string, reportBucket: string, reportRegion: string, reportName: string, prefix: string, region: string) {
      const event = {
        RequestType: 'Create',
        ResponseURL: '',
        StackId: 'cli',
        RequestId: 'cli',
        ResourceType: 'cli',
        LogicalResourceId: 'cli',
        ResourceProperties: {
          RoleArn: roleArn,
          UserIdentifier: userId,
          ReportBucket: reportBucket,
          ReportBucketRegion: reportRegion,
          ReportName: reportName,
          ReportPrefix: prefix,
          StackId: 'cli',
          Region: region
        }
      };
      console.log('Sending event to klouds.io');
      await this.sns.publish({TopicArn: topic, Message: JSON.stringify(event)}).promise();
  }
}