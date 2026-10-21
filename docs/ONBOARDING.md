# Integrar seu tenant ao Atlas

Há dois cenários: **instância própria**, na qual você configura os aplicativos, e **plataforma hospedada**, na qual cada cliente consente aplicativos multitenant já registrados pelo operador. Este repositório entrega o software; não oferece um SaaS público já hospedado.

## 1. Aplicação web

Registre no Microsoft Entra uma aplicação para contas de diretórios organizacionais (**multitenant / Organizations**). Configure plataforma **Web** com redirect URIs exatas:

- `http://localhost:3000/auth/callback` na homologação;
- `https://SEU_DOMINIO/auth/callback` na produção.

Não habilite implicit grant/public client. Configure os app roles de `infra/app-roles.json`, mesclando com outros existentes se necessário. No aplicativo empresarial de cada cliente, exija atribuição e atribua Reader, Auditor ou Admin aos usuários/grupos autorizados. O login solicita `openid profile email`; ele não precisa conceder escrita no Graph.

Configure `WEB_CLIENT_ID`, `WEB_CLIENT_SECRET` e uma chave aleatória `SESSION_SECRET` (mínimo 43 caracteres). O segredo web deve ficar em Key Vault/secret store. O cliente web desta implementação usa segredo; migração para credenciais por certificado/federação é uma evolução separada.

## 2. Aplicação collector

Registre uma segunda aplicação multitenant, **Atlas Collector**, com redirect URI web `https://SEU_DOMINIO/auth/consent/callback` ou a equivalente localhost. Use os Application permissions descritos em [COVERAGE.md](COVERAGE.md), habilitando somente os serviços desejados. Toda permissão de aplicação requer consentimento administrativo no tenant cliente.

Configure `COLLECTOR_CLIENT_ID` e uma das credenciais:

- `COLLECTOR_CERT_PATH` com PEM da chave privada e `COLLECTOR_CERT_THUMBPRINT` com thumbprint **SHA-256** do certificado registrado no Entra; ou
- `COLLECTOR_CLIENT_SECRET` em homologação/secret store.

Nunca distribua a chave privada ou segredo da plataforma aos clientes. A mesma aplicação multitenant recebe consentimento em cada organização e obtém tokens app-only na autoridade do tenant correspondente. Permissões Graph de aplicação são amplas no tenant; não confunda um filtro do Atlas com redução do escopo do token no provedor.

**O opcional `sharepoint.appGrants` requer Sites.FullControl.All.** Essa permissão tem capacidade de escrita na Microsoft, embora o collector só envie GET. Ela fica desabilitada por padrão. Avalie uma identidade separada/restrita e só habilite se a organização aceitar esse privilégio. `Sites.Read.All` também permite ler conteúdo dos sites; o Atlas consulta metadados, mas a credencial continua sensível.

## 3. Banco e inicialização

Copie `.env.example` para `.env`; configure `APP_MODE=microsoft`, PostgreSQL, credenciais e origem pública. Gere o segredo de sessão, por exemplo:

```powershell
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
npm ci --ignore-scripts
npm run migrate
npm start
```

Produção exige `NODE_ENV=production`, HTTPS e `DATABASE_SSL=require`. Migrações usam conta proprietária; servidor usa runtime restrito (`infra/runtime-permissions.sql`). `ALLOW_SELF_ONBOARDING=true` permite que um **Atlas.Admin com token validado** cadastre seu próprio tenant. Isso não é inscrição anônima. Com essa opção desativada, o operador cadastra previamente:

```powershell
npm run tenant:add -- --id TENANT_UUID --name "Minha organização"
```

Um tenant desabilitado no banco não é reativado automaticamente pelo login. Roles e status da conta não são reconsultados no Graph a cada API; sessões existentes duram no máximo 30 minutos e podem ser invalidadas no banco pelo operador. Revogação imediata/CAE não estão implementados.

## 4. Azure

No tenant cliente, identifique o service principal do Atlas Collector. Atribua **Reader** aos recursos/assinaturas/management groups a auditar. Para Activity Log/Log Analytics, conceda as funções de leitura de monitoramento/logs nos escopos necessários. O Atlas não atribui esses papéis por conta própria.

Em **Conectar meu tenant**, defina UUIDs das assinaturas. Lista vazia significa assinaturas que a credencial consegue enumerar e ler — não todas as assinaturas que existem na empresa. Resource Graph respeita o acesso do principal e pode ter consistência eventual.

Para auditar acessos ao plano de dados, habilite previamente diagnostic settings e tabelas no Log Analytics. Configure workspaces como:

```json
[
  {
    "id": "WORKSPACE_UUID",
    "tables": ["AzureDiagnostics", "StorageBlobLogs", "AZKVAuditLogs"]
  }
]
```

Use somente tabelas existentes e com dados no workspace. Acesso ao control plane não significa que todos os logs de leitura de dados estarão disponíveis.

## 5. Microsoft 365 Unified Audit

Habilite Unified Audit na organização conforme as políticas da empresa. Consinta **Office 365 Management APIs → ActivityFeed.Read (Application)** para o collector. Configure `PUBLISHER_TENANT_ID` com o tenant do publicador para cota dedicada.

O helper abaixo **inicia quatro subscriptions de feed**. Execute conscientemente no tenant correto; não há criação automática pelo worker:

```powershell
node scripts/start-m365-feeds.js --tenant TENANT_UUID --confirm
```

Ele ativa Audit.Exchange, Audit.SharePoint, Audit.General e Audit.AzureActiveDirectory, sem configurar webhook. O Atlas usa polling. Conteúdo pode demorar a surgir; não há recuperação arbitrária de logs anteriores à disponibilidade do feed. As janelas de listagem são menores que 24h e a coleta respeita o limite histórico do conteúdo disponível na Management API.

## 6. Bridges Exchange e SharePoint

Configure uma identidade/certificado de leitura específica para cada workload e os módulos PowerShell apropriados. Exchange requer o procedimento app-only e RBAC Exchange que permita os cmdlets de leitura; SharePoint/PnP requer acesso aos sites e à leitura de permissões. Não adote Global Administrator como atalho permanente.

No servidor, configure `BRIDGE_HMAC_KEYS_JSON` com um segredo aleatório diferente por tenant. No secret store do collector correspondente, configure o mesmo segredo em `ATLAS_BRIDGE_HMAC_KEY`. Habilite `bridge.exchange` ou `bridge.sharepoint` na interface.

```powershell
./scripts/Collect-Exchange.ps1 -TenantId TENANT_UUID -AppId APP_UUID -Organization tenant.onmicrosoft.com -CertificateThumbprint THUMBPRINT -AtlasUrl https://SEU_ATLAS
./scripts/Collect-SharePoint.ps1 -TenantId TENANT_UUID -AppId APP_UUID -TenantDomain tenant.onmicrosoft.com -CertificateThumbprint THUMBPRINT -SiteUrls https://tenant.sharepoint.com/sites/financeiro -AtlasUrl https://SEU_ATLAS
```

Scripts requerem PowerShell 7 e módulos oficiais/comunitários de origem verificada (`ExchangeOnlineManagement`, `PnP.PowerShell`). Agende em Azure Automation ou runner corporativo com os módulos/certificados e rede necessários; o Atlas não cria agendamentos externos automaticamente. HMAC valida o collector, não a autenticidade Microsoft do payload. Os bridges são marcados como `collector_asserted`.

Mantenha constante a lista SiteUrls de cada snapshot. `complete=true` significa coleta completa **do escopo configurado**, não de todos os sites do tenant. Uma falha de leitura marca o snapshot parcial e impede que objetos ausentes sejam retirados por inferência. O bridge SharePoint coleta ACLs no nível de webs/subsites; não enumera listas, itens e links de compartilhamento em todos os documentos.

## 7. Aceite em homologação

Valide dois tenants reais separados, contas com cada papel, consentimentos ausentes, dados de uma alteração conhecida em cada serviço, paginação, recurso com papel herdado, grupos aninhados, licenças, throttling, recuperação do banco e os bridges. Compare com os portais/PowerShell Microsoft. Registre quais APIs, regiões, licenças e versões dos módulos foram efetivamente validadas antes de produção.

Referências: [OAuth/PKCE](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow), [MSAL Node](https://learn.microsoft.com/en-us/entra/msal/javascript/node/acquire-token-requests), [Management Activity API](https://learn.microsoft.com/en-us/office/office-365-management-api/office-365-management-activity-api-reference), [Exchange app-only](https://learn.microsoft.com/en-us/powershell/exchange/app-only-auth-powershell-v2), [PnP SubWeb](https://pnp.github.io/powershell/cmdlets/Get-PnPSubWeb.html).

## Atualizar uma instalação v0.2

A atualização não amplia consentimentos Microsoft automaticamente nem adiciona fontes às configurações já salvas. Em **Conectar meu tenant**, habilite explicitamente as novas fontes e salve. Configure na aplicação collector as permissões de leitura adicionais necessárias: Device.Read.All, LicenseAssignment.Read.All, DeviceManagementScripts.Read.All e DeviceManagementServiceConfig.Read.All, além das permissões Intune já usadas. Refaça o consentimento administrativo após atualizar as permissões da aplicação.

Para Azure, habilite azure.subscriptions e azure.resources, execute uma coleta completa do inventário e então habilite azure.configurations. Dê ao collector acesso **Cost Management Reader** nas assinaturas desejadas e confira a política de acesso a custos do contrato antes de habilitar azure.costs. Compare os totais do mês UTC e moeda com Cost Analysis; o custo pode ter atraso e ajustes. Lista de assinaturas vazia enumera todas as acessíveis; não descobre assinaturas que negam acesso ao collector.

Valide uma política com inclusão/exclusão e filtro, um script cujo conteúdo possa ser lido, um grupo com dispositivos e um usuário com licenças. Compare atribuições/configurações com o portal Intune. Conteúdo de scripts é armazenado em evidências e exibido como texto, sem execução; revise os papéis Atlas e a retenção caso scripts contenham informação sensível. Execute `npm run migrate` para adicionar índices idempotentes de navegação. A atualização reutiliza as tabelas de recursos, relações, evidências e cursores existentes.
