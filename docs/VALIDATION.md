# Validação desta entrega

Verificações locais em 26 de outubro de 2026, com Node.js 24:

| Verificação                       | Resultado                                                                                 |
| --------------------------------- | ----------------------------------------------------------------------------------------- |
| Sintaxe JavaScript                | `npm run check` passou                                                                    |
| Testes automatizados              | 40 testes passaram, sem falhas                                                            |
| Banco dos testes                  | PostgreSQL via PGlite em memória                                                          |
| Graph/ARM/Management API          | Respostas controladas; sem credenciais externas                                           |
| Dependências de produção          | `npm audit --omit=dev --audit-level=high` executado no CI; consultar resultado do commit  |
| Coletores PowerShell              | Sintaxe validada sem executar comandos Microsoft                                          |
| Interface                         | Login demo, comparação antes/depois, alcance Intune e diagnóstico conferidos no navegador |
| Persistência de produção e Docker | Workflow CI incluído para PostgreSQL 17 e build; consultar resultado no GitHub Actions    |
| Tenant Microsoft real             | Não conectado nesta entrega; homologação depende do cliente                               |

Os testes exercitam API, RBAC, CSRF, isolamento entre organizações, negação de evidência de outro tenant, filtros parametrizados, HMAC/replay, fronteira de URLs, 403/429, payload de outro tenant, falta de subscription, limites, retomada de Graph entre jobs, snapshots por geração, grupos aninhados, escopo herdado e integridade do ledger. Também verificam que a URL de conexão não pode desligar a validação TLS em produção e que falhas de autenticação não são mascaradas como erros de rede.

A demonstração usa memória por padrão. Persistência PGlite em pasta sincronizada apresentou falha de reinicialização durante a verificação local; use disco local compatível caso opte por essa persistência. A configuração Microsoft exige PostgreSQL e não depende desse modo demo.

Capturas de tela em `docs/images/` contêm somente dados fictícios. Arquivos de dados locais, módulos instalados, arquivos `.env` e certificados não são incluídos no repositório.

Não foram executados pentest, teste de carga, autenticação/consentimento em tenant real, validação de todas as permissões Microsoft nem execução dos módulos Exchange/PnP com certificado real. Testes automatizados e dependências sem alertas conhecidos não equivalem a certificação de segurança ou garantia de auditoria universal.

A expansão v0.3 acrescenta testes de colunas dinâmicas de custos, reconsulta idempotente, moedas/cobranças sem ResourceId, paginação POST de custos com corpo preservado, bloqueio de redirecionamento de escopo, allowlist beta, negação de ações, exclusões/filtros Intune, retomada de conteúdo de scripts, membros paginados com nomes, planos de licença, isolamento e leitura ARM com seleção de versão estável. São respostas controladas, não homologação em tenant Microsoft real.

A v0.4 acrescenta testes de ausência versus null/tipos em JSON pointers, limites de comparação, valores extensos, filtros com lógica de três valores, operadores não suportados e sintaxe hostil, grupos aninhados/cíclicos, correlação deviceId/objectId, exclusões entre tipos distintos, resultados indeterminados, fontes antigas, relatórios paginados, RBAC/CSRF e fila de diagnóstico sem execução de chamadas Microsoft. O smoke test PostgreSQL exercita também histórico, alcance, relatórios e diagnóstico com fixtures fictícias em atlas_test. O perfil Reader é impedido de obter comparações de payloads históricos; diagnóstico e alcance de dados atuais continuam legíveis.
