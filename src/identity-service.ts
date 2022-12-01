
import { Organizations, STS } from 'aws-sdk';
import { Organization } from 'aws-sdk/clients/organizations';

export default class IdentityService {
  constructor(
    private readonly sts: STS,
    private readonly organisations: Organizations
  ) {}

  async getOrg(): Promise<Organization> {
    const result = await this.organisations.describeOrganization().promise();
    return result.Organization!;
  }

  async listIds(): Promise<{ name: string, id: string }[]> {
    const roots = await this.organisations.listRoots().promise();
    const ous = await Promise.all((roots.Roots ?? []).map(root => this.organisations.listOrganizationalUnitsForParent({ ParentId: root.Id! }).promise()));
    const rootIds = (roots.Roots ?? []).map(r => ({ name: r.Name!, id: r.Id! }));
    const ouIds = ous.flatMap(it => it.OrganizationalUnits ?? []).map(it => ({ name: it.Name!, id: it.Id! }));
    return [...rootIds, ...ouIds];
  }

  async enabledTrustedAccess(): Promise<void> {
    await this.organisations.enableAWSServiceAccess({ ServicePrincipal: 'account.amazonaws.com' }).promise();
  }

  async getAccountIdentity(): Promise<string> {
    const identity = await this.sts.getCallerIdentity().promise();
    return identity.Account!;
  }

}