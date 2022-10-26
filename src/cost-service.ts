import { CUR } from 'aws-sdk';
import { ReportDefinition } from 'aws-sdk/clients/cur';

export default class CostService {
  constructor(private readonly costService: CUR) {
  }

  async getValidReports(): Promise<ReportDefinition[]> {
    const reports = await this.costService.describeReportDefinitions().promise();
    const validReports = (reports.ReportDefinitions ?? []).filter(it => it.TimeUnit === 'DAILY' && it.Format === 'textORcsv' && it.Compression === 'GZIP' && it.AdditionalSchemaElements?.includes('RESOURCES'))
    console.log('Found', validReports.length, 'daily gzipped csv reports with resource ids enabled out of a total of', reports.ReportDefinitions?.length ?? 0,' reports');
    return validReports;
  }
}