# Cobertura por fonte

As 98 entradas do catálogo são **definições de coleta implementadas**, não 98 conexões já homologadas no seu tenant. Credenciais, permissões, versões do serviço, licenças e escopos devem ser validados em homologação.

## APIs e permissões

Permissões Graph abaixo são do tipo **Application**. A fonte funciona por leitura; isso não torna uma credencial com privilégios amplos inofensiva.

| Fontes                                                       | API / coleta                                            | Permissão / requisito                                          |
| ------------------------------------------------------------ | ------------------------------------------------------- | -------------------------------------------------------------- |
| entra.users                                                  | `/users` e propriedades de licenças                     | User.Read.All                                                  |
| entra.groups                                                 | `/groups`                                               | Group.Read.All                                                 |
| entra.memberships                                            | membros/proprietários por grupo                         | GroupMember.Read.All + Group.Read.All                          |
| entra.applications                                           | `/applications`                                         | Application.Read.All                                           |
| entra.servicePrincipals                                      | `/servicePrincipals`                                    | Application.Read.All                                           |
| entra.appPermissions                                         | appRoleAssignments, appRoleAssignedTo e owners por SP   | Application.Read.All                                           |
| entra.consents                                               | `/oauth2PermissionGrants`                               | Directory.Read.All                                             |
| entra.roles, entra.roleAssignments                           | `/roleManagement/directory/*`                           | RoleManagement.Read.Directory                                  |
| entra.conditionalAccess                                      | `/identity/conditionalAccess/policies`                  | Policy.Read.All; disponibilidade do serviço                    |
| entra.organization                                           | `/organization`                                         | Organization.Read.All                                          |
| m365.licenses                                                | `/subscribedSkus`                                       | LicenseAssignment.Read.All                                     |
| entra.audit, entra.signins                                   | `/auditLogs/directoryAudits`, `/auditLogs/signIns`      | AuditLog.Read.All; acesso/retenção conforme licença            |
| intune.devices                                               | `/deviceManagement/managedDevices`                      | DeviceManagementManagedDevices.Read.All                        |
| intune.compliance, intune.configuration                      | deviceCompliancePolicies, deviceConfigurations          | DeviceManagementConfiguration.Read.All                         |
| intune.apps, intune.audit                                    | mobileApps, auditEvents                                 | DeviceManagementApps.Read.All; Intune ativo                    |
| sharepoint.sites                                             | `/sites/getAllSites`                                    | Sites.Read.All                                                 |
| sharepoint.appGrants                                         | permissões por site                                     | **Sites.FullControl.All**, opcional/desabilitada inicialmente  |
| teams.teams, teams.members                                   | grupos provisionados como Teams e `/teams/{id}/members` | Group.Read.All; TeamMember.Read.All                            |
| azure.resources                                              | Resource Graph: Resources e ResourceContainers          | Azure RBAC Reader nos escopos selecionados                     |
| azure.rbac                                                   | Resource Graph: AuthorizationResources                  | Microsoft.Authorization/*/read nos escopos                     |
| azure.activity                                               | Activity Logs por assinatura                            | Leitura de monitoramento no Azure                              |
| azure.dataAccess                                             | Log Analytics, tabelas configuradas                     | Leitura dos workspaces; diagnostic settings e ingestão prévios |
| audit.exchange, audit.sharepoint, audit.general, audit.entra | Office 365 Management Activity API                      | ActivityFeed.Read; Unified Audit e subscriptions ativas        |
| bridge.exchange                                              | PowerShell Exchange Online, snapshot HMAC               | Certificado/app-only + RBAC de leitura dos cmdlets             |
| bridge.sharepoint                                            | PowerShell PnP, webs/subsites/grupos                    | Certificado + acesso à leitura de ACLs nos sites definidos     |

## O significado de “completo” em um job

`success` significa que **o escopo daquela consulta** foi percorrido sem erro ou limite detectado. Não significa que todos os recursos do tenant foram autorizados ao collector, nem que todas as ações possíveis daquele serviço são registradas pela Microsoft.

- `forbidden`: a credencial foi recusada; não significa que não existem dados.
- `needs_setup`: assinatura/feed/workspace não está configurado.
- `partial`: há dados preservados, mas o ciclo não terminou ou atingiu limite.
- `gap`: a janela ultrapassou a disponibilidade histórica tratada pelo connector.
- `failed`: falha de transporte, formato, consulta ou consistência a investigar.
- `never`: nenhuma coleta registrada.

A UI mostra a data da última coleta OK. Um sucesso antigo não é evidência de conectividade atual. O índice “fontes OK/total” mede fontes e não uma porcentagem de todas as atividades auditadas.

## Limites técnicos e de atribuição

**Criação de recursos.** `created_at` é preenchido somente quando o objeto coletado contém uma data explícita de criação. `created_by` depende de metadado explícito; na prática, Resource Graph não fornece systemData para todos os tipos e o inventário padrão não garante esse campo. Eventos podem informar o autor de uma operação, mas `write` em Azure pode representar criação ou atualização. O Atlas não infere criador a partir do último operador.

**Plano de controle e dados.** Activity Log registra operações do plano de controle. Leituras de arquivos, blobs, segredos e outros dados dependem dos logs específicos do recurso, que precisam estar habilitados e acessíveis. Log Analytics nesta versão consulta somente AzureDiagnostics, StorageBlobLogs, StorageFileLogs, StorageQueueLogs, StorageTableLogs, AppServiceHTTPLogs e AZKVAuditLogs, quando selecionados. Tabelas/serviços adicionais exigem um connector correspondente.

**Azure RBAC.** Resource Graph retorna os escopos legíveis pelo principal e pode ter atraso. Atribuições herdadas de escopos superiores não estão universalmente garantidas pela consulta atual; inclua/valide os escopos pais e compare com ARM/portal. O grafo mostra atribuições observadas e herança por prefixo de escopo com fronteira de caminho. Não calcula efeitos finais de deny assignments, condições ABAC, notActions, dataActions, PIM elegível, ACLs de plano de dados, permissões por chave ou tokens já emitidos.

**Entra.** Grupos são expandidos até oito níveis, com prevenção de ciclos e limite explícito de caminhos. PIM elegível, access packages, administrative units completas, authentication methods e risk detections não são coletados nesta versão. Consentimentos OAuth delegados mantêm o contexto de consentType/principalId; um grant não é prova de que o aplicativo o utilizou.

**SharePoint.** `/sites/{id}/permissions` é usado para grants de aplicações, não como inventário de todas as ACLs humanas. O bridge coleta webs/subsites e membros dos grupos SharePoint do conjunto SiteUrls informado. ACLs de bibliotecas/listas/itens, links de compartilhamento e cada arquivo não estão enumerados pelo bridge atual. Claims não resolvidos ficam com identificador de origem, sem inventar um usuário Entra.

**Exchange.** Auditoria de operações vem do feed, quando disponível. O bridge cobre o conjunto de cmdlets do script, sem leitura de mensagens, e não inclui todas as políticas possíveis do Exchange. SendOnBehalf é preservado como metadado da caixa; sua expansão para todos os caminhos de acesso ainda não está implementada. SID/nomes Exchange sem UPN podem exigir resolução complementar.

**Intune/Teams/Admin Center.** Intune inclui políticas clássicas, Settings Catalog/endpoint security, groupPolicyConfigurations, intents, políticas de inscrição, configuração/proteção de apps, PowerShell, shell macOS, atributos macOS e remediações. Cada família tem fonte de atribuições e de conteúdo/configuração (GET individual; settings ou definitionValues quando aplicável). Assignment filters são inventariados. Não cobre todos os relatórios de implantação, RBAC interno, modelos ainda não expostos nessas coleções ou funcionalidades futuras. Teams inclui equipes e membros diretos, sem todos os canais privados/compartilhados ou permissões de arquivos. “Admin Center” não é uma fonte universal: mudanças aparecem no feed/Entra/workload que as registra; páginas/configurações adicionais precisam de conectores específicos.

**Licenças.** Contadores vêm de subscribedSkus e relações de atribuição de users. Não há preço contratado, recomendação automática de remoção nem medição completa de uso das aplicações. Dados podem ter atraso de propagação.

## Paginação, retomada e retenção

Graph percorre páginas e fanout por pais/relações. Estado de retomada fica em `collection_cursors`; limite por job não descarta as páginas seguintes. Um ciclo completo utiliza uma mesma geração de snapshot para evitar retirar objetos observados em jobs anteriores. Se uma página exceder o orçamento de registros do job, aumente `MAX_RECORDS_PER_RUN`. Para cursor inválido/expirado, um Atlas.Admin pode reiniciá-lo pelo endpoint `POST /api/sources/{source}/reset` com sessão e CSRF; não reinicie enquanto houver job ativo.

Resource Graph, Activity API e Cost Management percorrem paginação dentro do job, mas **não têm retomada durável entre jobs nesta versão**. Configurações ARM possuem cursor durável por recurso e geração de snapshot; a descoberta de versões por provider pode ser repetida ao retomar. Ao atingir limites, ficam parciais; aumente orçamento/reduza escopo. Log Analytics usa limite de linhas, sem particionamento automático de consultas densas. Ajuste workspaces/escopos/orçamento antes de afirmar cobertura operacional em ambientes grandes.

Eventos começam com 24 horas na primeira coleta, avançam checkpoint apenas no sucesso e consultam uma sobreposição configurável (60 minutos por padrão). Eventos que chegarem depois dessa sobreposição podem ser perdidos sem backfill adicional. A API aceita `backfillDays` de 1 a 6 ao solicitar coleta; valide o período disponível na fonte. Para Management Activity, as listagens são divididas em janelas inferiores a 24 horas e o código detecta janelas antigas incompatíveis com o feed.

Referências oficiais: [Azure Resource Graph](https://learn.microsoft.com/rest/api/azureresourcegraph/resourcegraph/resources/resources), [Activity Logs](https://learn.microsoft.com/en-us/rest/api/monitor/activity-logs/list), [Log Analytics](https://learn.microsoft.com/en-us/azure/azure-monitor/logs/api/request-format), [Management Activity](https://learn.microsoft.com/en-us/office/office-365-management-api/office-365-management-activity-api-reference), [SharePoint getAllSites](https://learn.microsoft.com/en-us/graph/api/site-getallsites), [permissões de site](https://learn.microsoft.com/en-us/graph/api/site-list-permissions), [Intune Audit](https://learn.microsoft.com/en-us/graph/api/intune-auditing-auditevent-list), [SKUs](https://learn.microsoft.com/en-us/graph/api/subscribedsku-list), [grants OAuth](https://learn.microsoft.com/en-us/graph/api/oauth2permissiongrant-list).

## Expansão v0.3: Intune, identidades e Azure

| Fontes                                                                                                                             | Escopo/API                                                                                          | Permissão de aplicação ou Azure RBAC                                            |
| ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| entra.devices                                                                                                                      | Dispositivos Entra e correlação por deviceId                                                        | Device.Read.All                                                                 |
| entra.licenseDetails                                                                                                               | /users/{id}/licenseDetails, incluindo estados dos planos                                            | LicenseAssignment.Read.All                                                      |
| intune.catalog, templates, intents e suas .details/.assignments                                                                    | configurationPolicies, groupPolicyConfigurations, intents                                           | DeviceManagementConfiguration.Read.All                                          |
| intune.powershell, shell, attributes, remediations e suas .details/.assignments                                                    | deviceManagementScripts, deviceShellScripts, deviceCustomAttributeShellScripts, deviceHealthScripts | DeviceManagementScripts.Read.All                                                |
| intune.enrollment e suas .details/.assignments                                                                                     | deviceEnrollmentConfigurations                                                                      | DeviceManagementServiceConfig.Read.All                                          |
| intune.appConfiguration, androidProtection, iosProtection, windowsProtection, managedAppConfiguration e suas .details/.assignments | Coleções correspondentes em deviceAppManagement                                                     | DeviceManagementApps.Read.All                                                   |
| intune.filters                                                                                                                     | assignmentFilters                                                                                   | DeviceManagementConfiguration.Read.All                                          |
| intune.compliance/configuration/apps.details e .assignments                                                                        | GET individual e assignments das coleções existentes                                                | As mesmas permissões da família                                                 |
| azure.subscriptions                                                                                                                | ARM subscriptions, com tenantId quando fornecido e allowlist configurada                            | subscriptions/read                                                              |
| azure.configurations                                                                                                               | GET individual de recursos já inventariados, versão anunciada pelo provider                         | Reader dos recursos                                                             |
| azure.costs                                                                                                                        | Cost Management Query ActualCost, mês UTC atual, diário por ResourceId                              | Cost Management Reader + acesso a custos conforme contrato/política de cobrança |

As famílias Intune adicionais usam **Graph beta**. O guard de URLs permite beta somente nas coleções Intune declaradas; Graph v1 permanece padrão para outras fontes. Use o catálogo executável em `src/intune-sources.js` para os nomes exatos. Fontes independentes deixam clara a falha de uma família sem mascarar as outras. APIs podem mudar ou ser descontinuadas; um 403/404 aparece na cobertura e deve ser homologado por plataforma/licença.

Atribuições mostram grupo, exclusão, intent, alvo global, filtro e tipo do filtro. Uma atribuição não comprova implantação nem a aplicabilidade final. Grupos podem conter usuários e dispositivos. Membros diretos vêm de entra.memberships, dispositivos do diretório de entra.devices; dados Intune usam deviceId para correlação, sem confundir esse identificador com o objectId do Entra. Grupos ocultos podem requerer Member.Read.Hidden, consentido separadamente. Usuários mostram licenças atribuídas, planos desabilitados e licenseAssignmentStates; a fonte licenseDetails acrescenta estados por plano. Relações são paginadas em 50 registros, sem cortar silenciosamente em 5 mil.

Configurações ARM requerem um inventário azure.resources anterior. A consulta usa GET individual na primeira versão estável anunciada pelo provider (ou preview quando só houver preview). O resultado é um filho do recurso com a API utilizada e configurationStatus. Recurso 403/404 ou versão não encontrada produz lacuna explícita e mantém a fonte parcial. Não inclui chaves, segredos, ações listKeys, todos os sub-recursos de cada provider nem configuração do plano de dados. Não existe API que devolva universalmente toda configuração de todos os serviços.

Custos usam query POST de leitura, com paginação restrita à mesma assinatura e reaproveitamento do corpo. Linhas são identificadas por mês/dia/assinatura/ResourceId/moeda; novas coletas atualizam o valor, sem somar snapshots duplicados. Totais não misturam moedas; cobranças sem ResourceId são preservadas na assinatura. Um snapshot completo retira linhas não observadas do estado atual; evidências anteriores permanecem. A tela mostra mês UTC atual até a consulta e horário observado; períodos anteriores não são uma série histórica contábil pronta. Custos têm latência e ajustes, podem não estar disponíveis para determinado contrato ou política, e não são previsão nem fatura final. Ausência de dados não significa zero. Se a coleta ficar parcial, valores de momentos distintos podem coexistir e o aviso fica visível.

Referências adicionais: [Intune scripts: GET e permissão Read.All](https://learn.microsoft.com/en-us/graph/api/intune-devices-devicemanagementscript-get?view=graph-rest-beta), [remediações](https://learn.microsoft.com/en-us/graph/api/intune-devices-devicehealthscript-list?view=graph-rest-beta), [exportador Microsoft e famílias Intune](https://github.com/microsoft/intune-tenant-doc/blob/main/Export-IntuneTenantDoc.ps1), [Cost Management Query 2025-03-01](https://learn.microsoft.com/en-us/rest/api/cost-management/query/usage?view=rest-cost-management-2025-03-01).

Autopilot e atualizações também têm inventário, GET individual e atribuições: `intune.autopilot` usa windowsAutopilotDeploymentProfiles (DeviceManagementServiceConfig.Read.All); `intune.featureUpdates`, `qualityUpdates` e `driverUpdates` usam os perfis Windows correspondentes (DeviceManagementConfiguration.Read.All). Drivers incluem driverInventories. Anéis de atualização clássicos continuam em deviceConfigurations. Referências: [Autopilot](https://learn.microsoft.com/en-us/graph/api/resources/intune-enrollment-windowsautopilotdeploymentprofile?view=graph-rest-beta), [atribuições de drivers](https://learn.microsoft.com/en-us/graph/api/intune-softwareupdate-windowsdriverupdateprofileassignment-list?view=graph-rest-beta), [quality updates](https://learn.microsoft.com/en-us/graph/api/intune-softwareupdate-windowsqualityupdateprofile-list?view=graph-rest-beta).

`intune.complianceScripts` e `.details` leem scripts de conformidade personalizada com DeviceManagementScripts.Read.All. A atribuição ocorre pela política de conformidade; não é criada uma chamada fictícia /assignments para esses scripts. A referência ao script permanece nas propriedades da política quando fornecida. [Documentação Microsoft](https://learn.microsoft.com/en-us/graph/api/intune-devices-devicecompliancescript-list?view=graph-rest-beta).
