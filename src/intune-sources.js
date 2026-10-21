// Beta is restricted to these Intune collections by the provider URL guard.
export const intuneFamilies = [
  [
    "complianceScripts",
    "Scripts de conformidade personalizada",
    "deviceManagement/deviceComplianceScripts",
    "DeviceManagementScripts.Read.All",
  ],
  [
    "autopilot",
    "Perfis Windows Autopilot",
    "deviceManagement/windowsAutopilotDeploymentProfiles",
    "DeviceManagementServiceConfig.Read.All",
  ],
  [
    "featureUpdates",
    "Atualizações de versão Windows",
    "deviceManagement/windowsFeatureUpdateProfiles",
    "DeviceManagementConfiguration.Read.All",
  ],
  [
    "qualityUpdates",
    "Atualizações de qualidade Windows",
    "deviceManagement/windowsQualityUpdateProfiles",
    "DeviceManagementConfiguration.Read.All",
  ],
  [
    "driverUpdates",
    "Atualizações de drivers Windows",
    "deviceManagement/windowsDriverUpdateProfiles",
    "DeviceManagementConfiguration.Read.All",
    "driverInventories",
  ],

  [
    "catalog",
    "Catálogo e segurança de endpoints",
    "deviceManagement/configurationPolicies",
    "DeviceManagementConfiguration.Read.All",
    "settings",
  ],
  [
    "powershell",
    "Scripts PowerShell",
    "deviceManagement/deviceManagementScripts",
    "DeviceManagementScripts.Read.All",
  ],
  [
    "shell",
    "Scripts macOS",
    "deviceManagement/deviceShellScripts",
    "DeviceManagementScripts.Read.All",
  ],
  [
    "remediations",
    "Remediações e detecções",
    "deviceManagement/deviceHealthScripts",
    "DeviceManagementScripts.Read.All",
  ],
  [
    "attributes",
    "Scripts de atributos macOS",
    "deviceManagement/deviceCustomAttributeShellScripts",
    "DeviceManagementScripts.Read.All",
  ],
  [
    "templates",
    "Modelos administrativos",
    "deviceManagement/groupPolicyConfigurations",
    "DeviceManagementConfiguration.Read.All",
    "definitionValues?$expand=definition,presentationValues",
  ],
  [
    "intents",
    "Baselines e intenções legadas",
    "deviceManagement/intents",
    "DeviceManagementConfiguration.Read.All",
    "settings",
  ],
  [
    "enrollment",
    "Restrições e políticas de inscrição",
    "deviceManagement/deviceEnrollmentConfigurations",
    "DeviceManagementServiceConfig.Read.All",
  ],
  [
    "appConfiguration",
    "Configuração de aplicativos em dispositivos",
    "deviceAppManagement/mobileAppConfigurations",
    "DeviceManagementApps.Read.All",
  ],
  [
    "androidProtection",
    "Proteção de aplicativos Android",
    "deviceAppManagement/androidManagedAppProtections",
    "DeviceManagementApps.Read.All",
  ],
  [
    "iosProtection",
    "Proteção de aplicativos iOS",
    "deviceAppManagement/iosManagedAppProtections",
    "DeviceManagementApps.Read.All",
  ],
  [
    "windowsProtection",
    "Proteção de aplicativos Windows",
    "deviceAppManagement/windowsManagedAppProtections",
    "DeviceManagementApps.Read.All",
  ],
  [
    "managedAppConfiguration",
    "Configuração de aplicativos gerenciados",
    "deviceAppManagement/targetedManagedAppConfigurations",
    "DeviceManagementApps.Read.All",
  ],
];
export const intuneKey = (family, id) =>
  family === "compliance" || family === "configuration"
    ? "intune-policy:" + id
    : family === "apps"
      ? "intune-app:" + id
      : "intune:" + family + ":" + id;
const existing = [
  [
    "compliance",
    "Conformidade",
    "deviceManagement/deviceCompliancePolicies",
    "DeviceManagementConfiguration.Read.All",
  ],
  [
    "configuration",
    "Configuração clássica",
    "deviceManagement/deviceConfigurations",
    "DeviceManagementConfiguration.Read.All",
  ],
  [
    "apps",
    "Aplicativos",
    "deviceAppManagement/mobileApps",
    "DeviceManagementApps.Read.All",
  ],
];
export const intuneSources = [
  ...intuneFamilies.map(([family, name, path, permission]) => ({
    id: "intune." + family,
    name,
    path,
    permission,
    family,
    provider: "graph",
    service: "Intune",
    type: "snapshot",
    beta: true,
    limitation:
      "API beta: disponibilidade depende da plataforma, licença e versão do serviço.",
  })),
  {
    id: "intune.filters",
    name: "Filtros de atribuição",
    path: "deviceManagement/assignmentFilters",
    permission: "DeviceManagementConfiguration.Read.All",
    family: "filters",
    provider: "graph",
    service: "Intune",
    type: "snapshot",
    beta: true,
  },
  ...[...existing, ...intuneFamilies].flatMap(
    ([family, name, path, permission, settings]) => [
      {
        id: `intune.${family}.assignments`,
        name: name + " · atribuições",
        permission,
        family,
        fanout: path,
        parentPath: path + "?$select=id",
        relations: ["assignments"],
        provider: "graph",
        service: "Intune",
        type: "snapshot",
        beta: true,
        assignment: true,
        limitation:
          "Atribuição configurada; não comprova implantação. Grupos podem conter usuários e dispositivos; filtros e exclusões precisam ser considerados.",
      },
      ...[
        {
          id: `intune.${family}.details`,
          name: name + " · conteúdo e parâmetros",
          permission,
          family,
          fanout: path,
          parentPath: path + "?$select=id",
          relations: settings ? ["", settings] : [""],
          provider: "graph",
          service: "Intune",
          type: "snapshot",
          beta: true,
          detail: true,
        },
      ],
    ],
  ),
].filter(
  (source) => !(source.family === "complianceScripts" && source.assignment),
);
