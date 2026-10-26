import { randomUUID } from "node:crypto";
import { costRows } from "./costs.js";
import { ensureTenant, ingest } from "./store.js";
export const DEMO_TENANTS = [
  { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Aurora Labs" },
  { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "Horizonte Educação" },
];
export async function seedDemo(pool) {
  for (const tenant of DEMO_TENANTS) {
    await ensureTenant(pool, tenant.id, tenant.name);
    if (
      (
        await pool.query("SELECT 1 FROM resources WHERE tenant_id=$1 LIMIT 1", [
          tenant.id,
        ])
      ).rowCount
    )
      continue;
    const ana = "11111111-1111-4111-8111-111111111111",
      lucas = "22222222-2222-4222-8222-222222222222",
      group = "33333333-3333-4333-8333-333333333333",
      app = "44444444-4444-4444-8444-444444444444",
      sub = "55555555-5555-4555-8555-555555555555",
      sku = "66666666-6666-4666-8666-666666666666",
      rg = `/subscriptions/${sub}/resourceGroups/rg-atlas-production`,
      vm = rg + "/providers/Microsoft.Compute/virtualMachines/vm-api-prod",
      role =
        "/subscriptions/" +
        sub +
        "/providers/Microsoft.Authorization/roleDefinitions/8e3af657-a8ff-443c-a75c-2fe8c4bcb635",
      now = Date.now(),
      records = {
        "entra.users": [
          {
            id: ana,
            displayName: "Ana Beatriz",
            userPrincipalName: "ana@example.test",
            accountEnabled: true,
            userType: "Member",
            department: "Engenharia",
            createdDateTime: "2025-03-15T12:30:00Z",
            assignedLicenses: [{ skuId: sku, disabledPlans: [] }],
          },
          {
            id: lucas,
            displayName: "Lucas Oliveira",
            userPrincipalName: "lucas@example.test",
            accountEnabled: true,
            userType: "Member",
            department: "Produto",
            createdDateTime: "2026-01-10T14:00:00Z",
            assignedLicenses: [],
          },
          {
            id: "77777777-7777-4777-8777-777777777777",
            displayName: "Mariana Costa",
            userPrincipalName: "mariana@example.test",
            accountEnabled: true,
            userType: "Guest",
            department: "Financeiro",
            assignedLicenses: [],
          },
        ],
        "entra.groups": [
          {
            id: group,
            displayName: "Engenharia · Produção",
            description: "Grupo de acesso aos ambientes de produção",
            securityEnabled: true,
            groupTypes: [],
            createdDateTime: "2025-04-10T12:00:00Z",
          },
        ],
        "entra.applications": [
          {
            id: app,
            appId: app,
            displayName: "Atlas Deployment Agent",
            createdDateTime: "2025-05-02T08:14:00Z",
            passwordCredentials: [
              {
                keyId: ana,
                displayName: "CI deploy",
                endDateTime: new Date(now + 12 * 86400000).toISOString(),
              },
            ],
            keyCredentials: [],
          },
        ],
        "entra.servicePrincipals": [
          {
            id: app,
            appId: app,
            displayName: "Atlas Deployment Agent",
            servicePrincipalType: "Application",
            accountEnabled: true,
          },
        ],
        "entra.roles": [
          {
            id: "62e90394-69f5-4237-9190-012177145e10",
            displayName: "Global Administrator",
            rolePermissions: [{ allowedResourceActions: ["*"] }],
          },
        ],
        "entra.roleAssignments": [
          {
            id: "role-demo",
            principalId: ana,
            roleDefinitionId: "62e90394-69f5-4237-9190-012177145e10",
            directoryScopeId: "/",
          },
        ],
        "entra.conditionalAccess": [
          {
            id: "ca-001",
            displayName: "MFA · Contas administrativas",
            state: "enabled",
            createdDateTime: "2025-04-20T08:00:00Z",
          },
          {
            id: "ca-002",
            displayName: "Dispositivo gerenciado · Aplicações sensíveis",
            state: "disabled",
          },
        ],
        "entra.organization": [
          {
            id: tenant.id,
            displayName: tenant.name,
            verifiedDomains: [{ name: "example.test", isDefault: true }],
            securityComplianceNotificationMails: [],
          },
        ],
        "m365.licenses": [
          {
            id: tenant.id + "_" + sku,
            skuId: sku,
            skuPartNumber: "SPE_E5",
            consumedUnits: 156,
            prepaidUnits: { enabled: 180, suspended: 0, warning: 0 },
            capabilityStatus: "Enabled",
            servicePlans: [
              {
                servicePlanName: "EXCHANGE_S_ENTERPRISE",
                provisioningStatus: "Success",
              },
              {
                servicePlanName: "SHAREPOINTENTERPRISE",
                provisioningStatus: "Success",
              },
            ],
          },
        ],
        "intune.devices": [
          {
            id: "device-001",
            deviceName: "NB-ENG-023",
            operatingSystem: "Windows",
            osVersion: "11",
            complianceState: "noncompliant",
            userPrincipalName: "ana@example.test",
            enrolledDateTime: "2026-01-12T12:00:00Z",
          },
          {
            id: "device-002",
            deviceName: "NB-PROD-014",
            operatingSystem: "macOS",
            complianceState: "compliant",
            userPrincipalName: "lucas@example.test",
          },
        ],
        "intune.compliance": [
          {
            id: "compliance-01",
            displayName: "Windows · Baseline corporativa",
            passwordRequired: true,
            storageRequireEncryption: true,
          },
        ],
        "intune.configuration": [
          {
            id: "config-01",
            displayName: "Windows · Proteção de endpoint",
            createdDateTime: "2026-01-01T12:00:00Z",
          },
        ],
        "intune.apps": [
          {
            id: "app-001",
            displayName: "Microsoft 365 Apps",
            publisher: "Microsoft",
          },
        ],
        "sharepoint.sites": [
          {
            id: "example.sharepoint.com,site01,web01",
            displayName: "Financeiro",
            webUrl: "https://example.sharepoint.com/sites/financeiro",
            createdDateTime: "2025-09-01T10:00:00Z",
          },
          {
            id: "example.sharepoint.com,site02,web02",
            displayName: "Engenharia",
            webUrl: "https://example.sharepoint.com/sites/engenharia",
          },
        ],
        "teams.teams": [
          {
            id: group,
            displayName: "Engenharia",
            description: "Equipe de engenharia",
          },
        ],
        "azure.resources": [
          {
            id: `/subscriptions/${sub}`,
            name: "Atlas · Produção",
            type: "microsoft.resources/subscriptions",
            subscriptionId: sub,
            properties: { state: "Enabled" },
          },
          {
            id: rg,
            name: "rg-atlas-production",
            type: "microsoft.resources/subscriptions/resourcegroups",
            subscriptionId: sub,
            location: "brazilsouth",
            properties: { provisioningState: "Succeeded" },
          },
          {
            id: vm,
            name: "vm-api-prod",
            type: "microsoft.compute/virtualmachines",
            subscriptionId: sub,
            resourceGroup: "rg-atlas-production",
            location: "brazilsouth",
            systemData: {
              createdBy: "ana@example.test",
              createdAt: "2026-10-15T14:32:10Z",
            },
            tags: { environment: "production", owner: "Engenharia" },
            properties: { provisioningState: "Succeeded" },
          },
          {
            id: rg + "/providers/Microsoft.KeyVault/vaults/kv-atlas-prod",
            name: "kv-atlas-prod",
            type: "microsoft.keyvault/vaults",
            subscriptionId: sub,
            resourceGroup: "rg-atlas-production",
            location: "brazilsouth",
            systemData: { createdBy: app, createdAt: "2026-10-12T09:45:00Z" },
            properties: { enableRbacAuthorization: true },
          },
          {
            id: rg + "/providers/Microsoft.Storage/storageAccounts/statlasprod",
            name: "statlasprod",
            type: "microsoft.storage/storageaccounts",
            subscriptionId: sub,
            resourceGroup: "rg-atlas-production",
            location: "brazilsouth",
            properties: {
              allowBlobPublicAccess: false,
              minimumTlsVersion: "TLS1_2",
            },
          },
        ],
        "azure.rbac": [
          {
            id: role,
            name: "Owner",
            type: "microsoft.authorization/roledefinitions",
            properties: {
              roleName: "Owner",
              permissions: [
                {
                  actions: ["*"],
                  notActions: [],
                  dataActions: [],
                  notDataActions: [],
                },
              ],
            },
          },
          {
            id: rg + "/providers/Microsoft.Authorization/roleAssignments/demo",
            type: "microsoft.authorization/roleassignments",
            properties: {
              principalId: group,
              principalType: "Group",
              scope: rg,
              roleDefinitionId: role,
              condition: null,
            },
          },
        ],
        "bridge.exchange": [
          {
            id: "mb-001",
            recordType: "resource",
            key: "mailbox:financeiro@example.test",
            name: "Financeiro · Caixa compartilhada",
            kind: "mailbox",
            primarySmtpAddress: "financeiro@example.test",
            recipientTypeDetails: "SharedMailbox",
            forwardingAddress: null,
          },
          {
            id: "mb-perm-001",
            recordType: "permission",
            principalKey: "entra:" + ana,
            resourceKey: "mailbox:financeiro@example.test",
            role: "FullAccess",
            relation: "mailbox_permission",
            inherited: false,
          },
        ],
      };
    const deviceGroup = "88888888-8888-4888-8888-888888888888";
    records["entra.groups"].push({
      id: deviceGroup,
      displayName: "Windows · Dispositivos corporativos",
      securityEnabled: true,
      groupTypes: [],
      membershipRule: '(device.deviceOSType -eq "Windows")',
    });
    records["azure.subscriptions"] = [
      {
        id: "/subscriptions/" + sub,
        subscriptionId: sub,
        displayName: "Azure · Produção",
        tenantId: tenant.id,
        state: "Enabled",
        subscriptionPolicies: { spendingLimit: "Off" },
      },
    ];
    records["azure.configurations"] = [
      {
        id: vm,
        name: "vm-api-prod",
        type: "Microsoft.Compute/virtualMachines",
        configurationStatus: "observed",
        collectedApiVersion: "2024-07-01",
        properties: {
          hardwareProfile: { vmSize: "Standard_D2s_v5" },
          osProfile: {
            computerName: "vm-api-prod",
            adminUsername: "atlas-admin",
          },
          storageProfile: {
            osDisk: { managedDisk: { storageAccountType: "Premium_LRS" } },
          },
        },
      },
    ];
    records["intune.catalog"] = [
      {
        id: "catalog-001",
        name: "Windows · Defender e BitLocker",
        platforms: "windows10",
        technologies: "mdm",
        settingCount: 2,
        templateReference: { templateFamily: "endpointSecurityDiskEncryption" },
      },
    ];
    records["intune.powershell"] = [
      {
        id: "ps-001",
        displayName: "Inventário de agentes corporativos",
        fileName: "inventory.ps1",
        runAsAccount: "system",
        enforceSignatureCheck: true,
      },
    ];
    records["intune.remediations"] = [
      {
        id: "health-001",
        displayName: "Verificar criptografia",
        runAsAccount: "system",
        description: "Fixture: detecção e remediação",
      },
    ];
    records["intune.filters"] = [
      {
        id: "filter-001",
        displayName: "Apenas máquinas corporativas",
        platform: "windows10AndLater",
        rule: '(device.deviceOwnership -eq "Corporate")',
      },
    ];
    const period = {
        from: new Date(
          new Date(now).getUTCFullYear(),
          new Date(now).getUTCMonth(),
          1,
        ).toISOString(),
        to: new Date(now).toISOString(),
      },
      day = Number(
        new Date(now).toISOString().slice(0, 10).replaceAll("-", ""),
      );
    records["azure.costs"] = costRows(
      {
        properties: {
          columns: [
            { name: "Currency" },
            { name: "PreTaxCost" },
            { name: "ResourceId" },
            { name: "UsageDate" },
          ],
          rows: [
            ["BRL", 312.48, vm, day],
            [
              "BRL",
              42.15,
              rg + "/providers/Microsoft.Storage/storageAccounts/atlasprod",
              day,
            ],
            ["BRL", 8.99, "", day],
          ],
        },
      },
      sub,
      period,
    );
    Object.assign(records["intune.devices"][0], {
      azureADDeviceId: "entra-device-001",
      managedDeviceOwnerType: "company",
      lastSyncDateTime: new Date(now - 60000).toISOString(),
      manufacturer: "Contoso",
      model: "AtlasBook",
    });
    Object.assign(records["intune.devices"][1], {
      azureADDeviceId: "entra-device-002",
      managedDeviceOwnerType: "personal",
      lastSyncDateTime: new Date(now - 120000).toISOString(),
    });
    records["intune.devices"].push(
      {
        id: "device-003",
        deviceName: "NB-EXCECAO-031",
        azureADDeviceId: "entra-device-003",
        managedDeviceOwnerType: "company",
        operatingSystem: "Windows",
      },
      {
        id: "device-004",
        deviceName: "NB-SEM-DADOS-041",
        azureADDeviceId: "entra-device-004",
        operatingSystem: "Windows",
      },
    );
    records["entra.groups"].push({
      id: "device-exceptions",
      displayName: "Máquinas · Exceções de implantação",
      securityEnabled: true,
      groupTypes: [],
    });
    for (let i = 0; i < 70; i++) {
      const at = new Date(now - i * 2.3 * 3600000).toISOString();
      const which = i % 4;
      if (which === 0)
        (records["entra.signins"] ??= []).push({
          id: "signin-" + i,
          createdDateTime: at,
          userId: i % 3 ? ana : lucas,
          userPrincipalName: i % 3 ? "ana@example.test" : "lucas@example.test",
          appDisplayName: [
            "Azure Portal",
            "Exchange Online",
            "Microsoft Teams",
          ][i % 3],
          resourceDisplayName: "Microsoft 365",
          status: { errorCode: i % 13 === 0 ? 53003 : 0 },
          ipAddress: "192.0.2." + (10 + i),
          correlationId: randomUUID(),
        });
      else if (which === 1)
        (records["azure.activity"] ??= []).push({
          eventDataId: "azure-" + i,
          eventTimestamp: at,
          caller: "ana@example.test",
          operationName: {
            value: "Microsoft.Compute/virtualMachines/write",
            localizedValue: "Atualizar máquina virtual",
          },
          resourceId: vm,
          status: { value: "Succeeded" },
          correlationId: randomUUID(),
        });
      else if (which === 2)
        (records["audit.sharepoint"] ??= []).push({
          Id: "sp-" + i,
          CreationTime: at,
          OrganizationId: tenant.id,
          UserId: "lucas@example.test",
          Operation: "FileAccessed",
          Workload: "SharePoint",
          ObjectId:
            "https://example.sharepoint.com/sites/financeiro/Relatorio.xlsx",
          ResultStatus: "Succeeded",
        });
      else
        (records["entra.audit"] ??= []).push({
          id: "directory-" + i,
          activityDateTime: at,
          activityDisplayName: "Atualizar propriedades de grupo",
          initiatedBy: {
            user: { id: ana, userPrincipalName: "ana@example.test" },
          },
          targetResources: [
            {
              id: group,
              displayName: "Engenharia · Produção",
              modifiedProperties: [
                {
                  displayName: "Description",
                  oldValue: "Engenharia",
                  newValue: "Engenharia · Produção",
                },
              ],
            },
          ],
          result: "success",
          correlationId: randomUUID(),
        });
    }
    for (const [source, items] of Object.entries(records)) {
      const id = randomUUID();
      await pool.query(
        "INSERT INTO runs(id,tenant_id,source,status,started_at,finished_at,records,requested_by) VALUES($1,$2,$3,'success',now(),now(),$4,'demo-fixture')",
        [id, tenant.id, source, items.length],
      );
      await ingest(pool, {
        tenant: tenant.id,
        source,
        runId: id,
        records: items.map((record) => ({ record })),
      });
      await pool.query(
        "INSERT INTO coverage(tenant_id,source,status,last_success,last_attempt,records,detail) VALUES($1,$2,'success',now(),now(),$3,'{\"fixture\":true}') ON CONFLICT DO NOTHING",
        [tenant.id, source, items.length],
      );
    }
    const extras = [
      [
        "intune.catalog.assignments",
        {
          id: "a1",
          target: {
            "@odata.type": "#microsoft.graph.groupAssignmentTarget",
            groupId: deviceGroup,
            deviceAndAppManagementAssignmentFilterId: "filter-001",
            deviceAndAppManagementAssignmentFilterType: "include",
          },
        },
        { parent: "catalog-001", relation: "assignments" },
      ],
      [
        "intune.catalog.assignments",
        {
          id: "a2",
          target: {
            "@odata.type": "#microsoft.graph.exclusionGroupAssignmentTarget",
            groupId: group,
          },
        },
        { parent: "catalog-001", relation: "assignments" },
      ],
      [
        "intune.catalog.details",
        {
          id: "setting-001",
          settingInstance: {
            settingDefinitionId:
              "device_vendor_msft_bitlocker_requiredeviceencryption",
            choiceSettingValue: { value: "required" },
          },
        },
        { parent: "catalog-001", relation: "settings" },
      ],
      [
        "intune.powershell.details",
        {
          id: "ps-001",
          displayName: "inventory.ps1",
          scriptContent: Buffer.from(
            "# Fixture fictícia\nGet-Service | Select-Object Name, Status",
          ).toString("base64"),
          runAsAccount: "system",
        },
        { parent: "ps-001", relation: "" },
      ],
      [
        "intune.powershell.assignments",
        {
          id: "ps-a1",
          target: {
            "@odata.type": "#microsoft.graph.groupAssignmentTarget",
            groupId: deviceGroup,
          },
        },
        { parent: "ps-001", relation: "assignments" },
      ],
      [
        "entra.memberships",
        {
          id: "directory-device-001",
          displayName: "DESKTOP-ATLAS-01",
          "@odata.type": "#microsoft.graph.device",
        },
        { parent: deviceGroup, relation: "members" },
      ],
    ];
    records["entra.devices"] = [
      {
        id: "directory-device-001",
        deviceId: "entra-device-001",
        displayName: "DESKTOP-ATLAS-01",
        operatingSystem: "Windows",
        accountEnabled: true,
      },
    ];
    for (let i = 2; i <= 4; i++) {
      records["entra.devices"].push({
        id: "directory-device-00" + i,
        deviceId: "entra-device-00" + i,
        displayName: records["intune.devices"][i - 1].deviceName,
        operatingSystem: records["intune.devices"][i - 1].operatingSystem,
      });
      extras.push([
        "entra.memberships",
        {
          id: "directory-device-00" + i,
          "@odata.type": "#microsoft.graph.device",
        },
        { parent: deviceGroup, relation: "members" },
      ]);
    }
    extras.push(
      [
        "entra.memberships",
        {
          id: "directory-device-003",
          "@odata.type": "#microsoft.graph.device",
        },
        { parent: "device-exceptions", relation: "members" },
      ],
      [
        "intune.catalog.assignments",
        {
          id: "a3",
          target: {
            "@odata.type": "#microsoft.graph.exclusionGroupAssignmentTarget",
            groupId: "device-exceptions",
          },
        },
        { parent: "catalog-001", relation: "assignments" },
      ],
      [
        "intune.configuration.assignments",
        {
          id: "config-assignment",
          target: {
            "@odata.type": "#microsoft.graph.groupAssignmentTarget",
            groupId: deviceGroup,
          },
        },
        { parent: "config-01", relation: "assignments" },
      ],
      [
        "intune.configuration.deployment",
        {
          id: "report-001",
          deviceDisplayName: "NB-ENG-023",
          status: "compliant",
          lastReportedDateTime: new Date(now - 300000).toISOString(),
          userPrincipalName: "ana@example.test",
        },
        { parent: "config-01", relation: "deviceStatuses" },
      ],
      [
        "intune.configuration.deployment",
        {
          id: "report-002",
          deviceDisplayName: "NB-PROD-014",
          status: "error",
          lastReportedDateTime: new Date(now - 600000).toISOString(),
          userPrincipalName: "lucas@example.test",
        },
        { parent: "config-01", relation: "deviceStatuses" },
      ],
    );
    for (const [source, record, context] of extras) {
      const runId = randomUUID();
      await pool.query(
        "INSERT INTO runs(id,tenant_id,source,status) VALUES($1,$2,$3,'success')",
        [runId, tenant.id, source],
      );
      await ingest(pool, {
        tenant: tenant.id,
        source,
        runId,
        records: [{ record, context }],
      });
      await pool.query(
        "INSERT INTO coverage(tenant_id,source,status,last_success,last_attempt,records,detail) VALUES($1,$2,'success',now(),now(),1,'{\"fixture\":true}') ON CONFLICT(tenant_id,source) DO UPDATE SET records=coverage.records+1",
        [tenant.id, source],
      );
    }
    // The additional directory device is a normal inventory record.
    {
      const runId = randomUUID();
      await pool.query(
        "INSERT INTO runs(id,tenant_id,source,status) VALUES($1,$2,'entra.devices','success')",
        [runId, tenant.id],
      );
      await ingest(pool, {
        tenant: tenant.id,
        source: "entra.devices",
        runId,
        records: records["entra.devices"].map((record) => ({ record })),
      });
    }
    await pool.query(
      "INSERT INTO coverage(tenant_id,source,status,last_success,last_attempt,records,detail) VALUES($1,'entra.devices','success',now(),now(),4,'{\"fixture\":true}') ON CONFLICT DO NOTHING",
      [tenant.id],
    );
    // Two distinct transitions exercise the visual comparison and reversions.
    for (const [index, settingCount] of [3, 2].entries()) {
      const runId = randomUUID(),
        record = {
          ...records["intune.catalog"][0],
          settingCount,
          ...(index === 0
            ? { description: "Baseline revisada pela equipe de segurança" }
            : {}),
        };
      await pool.query(
        "INSERT INTO runs(id,tenant_id,source,status) VALUES($1,$2,'intune.catalog','success')",
        [runId, tenant.id],
      );
      await ingest(pool, {
        tenant: tenant.id,
        source: "intune.catalog",
        runId,
        records: [{ record }],
      });
    }
    const id = randomUUID();
    await pool.query(
      "INSERT INTO runs(id,tenant_id,source,status,requested_by) VALUES($1,$2,'entra.memberships','success','demo-fixture')",
      [id, tenant.id],
    );
    await ingest(pool, {
      tenant: tenant.id,
      source: "entra.memberships",
      runId: id,
      records: [
        {
          record: { id: ana, "@odata.type": "#microsoft.graph.user" },
          context: { parent: group, relation: "members" },
        },
        {
          record: { id: lucas, "@odata.type": "#microsoft.graph.user" },
          context: { parent: group, relation: "members" },
        },
      ],
    });
    await pool.query(
      "INSERT INTO coverage(tenant_id,source,status,last_success,last_attempt,records) VALUES($1,'entra.memberships','success',now(),now(),2) ON CONFLICT DO NOTHING",
      [tenant.id],
    );
    await pool.query(
      "INSERT INTO coverage(tenant_id,source,status,last_attempt,detail) VALUES($1,'azure.dataAccess','needs_setup',now(),'{\"code\":\"WORKSPACE_REQUIRED\"}') ON CONFLICT DO NOTHING",
      [tenant.id],
    );
    await pool.query(
      "INSERT INTO coverage(tenant_id,source,status,last_attempt,detail) VALUES($1,'sharepoint.appGrants','forbidden',now(),'{\"code\":\"PROVIDER_403\"}') ON CONFLICT DO NOTHING",
      [tenant.id],
    );
  }
}
