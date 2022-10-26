
import { STS } from 'aws-sdk';

export default class IdentityService {
  constructor(
    private readonly sts: STS) {}


  async getAccountIdentity(): Promise<string> {
    const identity = await this.sts.getCallerIdentity().promise();
    return identity.Account!;
  }

}