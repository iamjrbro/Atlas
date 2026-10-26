# Modelo de segurança

## Fronteiras

1. **Web client e browser:** o browser recebe cookie opaco, CSRF e os dados autorizados. Tokens e chaves não ficam em localStorage.
2. **Entra:** identidade vem de ID token verificado (RS256, emissor de tenant, destinatário, nonce e validade). O claim tid não é aceito isoladamente antes da validação.
3. **Tenant no Atlas:** roles Atlas.Reader, Atlas.Auditor e Atlas.Admin são verificadas no servidor. Admin de um cliente não configura outro cliente.
4. **Collector:** aplicação separada do login, app-only por tenant, com permissões administrativas consentidas pelo cliente. O collector normal não oferece ferramenta de alteração de usuários/grupos/recursos.
5. **Bridges:** chave HMAC por tenant, assinatura do corpo UTF-8, timestamp de cinco minutos, nonce persistido e tenant validado antes de ingestão.
6. **Banco e operador:** runtime com permissões reduzidas; operadores/migração e credencial do collector continuam altamente privilegiados e precisam de controles externos.

## O que os testes cobrem

Negação sem sessão; RBAC; origem/CSRF; tentativa de selecionar outro tenant no payload/query; evidência de outro tenant; SQL injection via filtros parametrizados; replay/alteração de snapshot; URL de paginação fora da origem; feed de outro tenant; 403/429; coleta parcial; hashes; bloqueio de alterações comuns no ledger/evidência.

Os testes não são um pentest e não comprovam isolamento imposto pelo próprio provedor. Não há RLS, chaves de banco por tenant, CAE, OIDC logout federado, trilha criptograficamente assinada por terceiro, SSO homologado em tenant real, residência geográfica automática ou conformidade certificada.

## Precisão e atribuição

Ator desconhecido permanece desconhecido. Data de primeira observação não vira data de criação. Uma mudança entre snapshots comprova diferença observada, não quem a realizou ou exatamente quando. Um caminho de permissão observado não comprova autorização efetiva. Algumas fontes podem conter informações de aplicação/serviço/IP, e não de uma pessoa identificada.

A evidência JSON normalizada preserva os valores que o parser recebeu; não é arquivo bruto byte a byte do transporte nem prova forense certificada. Hash local detecta divergência do armazenamento esperado; o administrador do banco pode remover triggers ou substituir toda a cadeia se não houver âncora externa. HMAC atesta o collector que conhece a chave, não a assinatura de cada comando Microsoft.

## Superfícies sensíveis

- Tenha processos de revisão/rotação para credenciais, certificados, permissões Graph e Azure RBAC.
- `Sites.FullControl.All` opcional possui escrita no provedor mesmo com uso de GET no Atlas. Não o habilite sem análise de privilégio e escopo.
- Restrinja exposição de auditoria e exportações: UPN/IP/caminhos de arquivo podem ser dados pessoais/sensíveis de negócio.
- Self-onboarding exige Admin token-validado; configure `ALLOW_SELF_ONBOARDING=false` quando a plataforma precisar de aprovação comercial/operacional prévia.
- Proxies reversos só devem ser confiados na quantidade e rede reais; não exponha caminhos alternativos que contornem o gateway.

## Consultas da v0.4

Comparações de payloads históricos exigem Auditor/Admin, assim como o acesso a evidências originais. Os endpoints de histórico, alcance, relatórios e diagnóstico filtram o tenant da sessão verificada. A solicitação de diagnóstico exige Admin, origem e CSRF válidos, aceita somente um serviço da lista fixa e enfileira apenas fontes habilitadas em uma transação com ledger. O endpoint não aceita tenant, URL de provedor, credenciais nem código enviados pelo cliente.

O avaliador de filtros é um parser limitado, sem eval, Function, execução de scripts ou expressões regulares fornecidas pelo usuário. Valores ausentes, propriedades não mapeadas e sintaxe não suportada permanecem desconhecidos, inclusive sob negação. A tela não transforma escopo estimado em autorização efetiva ou implantação confirmada. Diagnóstico nunca retorna valores de segredos/certificados, apenas indicadores de configuração e resultados de coleta.
