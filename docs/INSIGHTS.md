# Histórico, alcance Intune e diagnóstico

## Comparar alterações

Auditor/Admin abre um recurso e seleciona **Comparar alterações**. A comparação usa os eventos de transição persistidos pelo collector; não reconstrói uma linha do tempo a partir de hashes únicos. Assim, voltar de A para B e depois A continua produzindo duas transições.

Novas transições preservam links para a evidência anterior e posterior; transições antigas podem ter apenas a evidência posterior. Cada tabela mostra JSON pointers e valores antes/depois, distinguindo propriedade ausente de `null`, valores numéricos de texto e posições de arrays. Os estados são dados observados, sem execução de conteúdo de scripts. A primeira coleta constitui uma linha de base e não gera uma alteração fictícia.

Paginação padrão de dez transições, máximo de vinte por consulta. A visualização limita cada comparação a 200 campos, profundidade 32 e mil caracteres por valor extenso; abreviações são indicadas e o conteúdo completo permanece na evidência. Alterações apenas em metadados do recurso podem não produzir diferenças de propriedades. Eventos nativos do mesmo recurso aparecem em uma seção independente, limitada aos últimos vinte eventos. Um ator de evento próximo no tempo não é automaticamente atribuído a um snapshot. Horário de detecção e ocorrência são distintos.

## Analisar alcance Intune

A tela separa três perguntas:

1. Quais destinos estão configurados nas atribuições coletadas?
2. Quais dispositivos observados parecem estar no escopo desses destinos?
3. Quais resultados a Microsoft declarou nos relatórios coletados?

A análise é local, somente de leitura. Ela usa dispositivos gerenciados, objetos de dispositivo Entra e relações de alias por **deviceId**, sem confundir esse ID com o **objectId**. Grupos e membros observados permitem percorrer associações aninhadas, com proteção contra ciclos e limite de profundidade oito. Grupos dinâmicos usam os membros do snapshot; o Atlas não executa suas regras de associação.

Exclusões de grupos de dispositivos prevalecem sobre inclusões de dispositivos. Uma exclusão de usuários não remove uma inclusão direcionada a dispositivos. Atribuições por usuário, grupos mistos, destinos desconhecidos, identidade não correlacionada e filtros não avaliáveis ficam indeterminados. Não se presume que o usuário principal representa todos os contextos de entrada na máquina. Intents de aplicativos permanecem declarados nas trilhas; conflitos de implantação não são resolvidos pelo avaliador.

Resultados são **incluído no escopo estimado**, **excluído no escopo estimado**, **fora do escopo observado** ou **indeterminado**. Nenhum deles é confirmação de implantação. Compatibilidade de plataforma, pré-requisitos, conflitos, licenciamento, sincronização e contexto do usuário devem ser conferidos no Intune. Propriedades de dispositivo também podem ter mudado depois do snapshot.

São necessárias coletas concluídas há menos de 24 horas das fontes da política/atribuições, grupos, membros, dispositivos Entra e Intune; filtros também precisam estar recentes quando utilizados. Lacunas e limites tornam a conclusão indeterminada. A consulta pagina os dispositivos e os relatórios separadamente, e apresenta contagens apenas da página. O grafo local é limitado a 50 mil relações e 50 mil objetos auxiliares, e a 500 atribuições por política. O limite é explícito; não é evidência de cobertura completa em tenants maiores.

### Filtros suportados

Parser sem execução de código, com `-and`, `-or`, `-not`, parênteses, strings JSON e listas de strings. Operadores: `-eq`, `-ne`, `-in`, `-notIn`, `-contains`, `-notContains`, `-startsWith`, `-notStartsWith`, `-endsWith` e `-notEndsWith`. Comparação textual sem distinção de maiúsculas/minúsculas. Versões com operadores de ordenação, expressões regulares e outras construções ficam indeterminadas.

Propriedades mapeadas: deviceName, manufacturer, model, osVersion, deviceCategory (deviceCategoryDisplayName), enrollmentProfileName e deviceOwnership (company → Corporate, personal → Personal). Campo ausente não vira string vazia nem comparação verdadeira sob negação. Regras limitadas a 8.192 caracteres, 512 tokens e profundidade 32. Filtros de apps e plataformas incompatíveis não são tratados como filtro de dispositivo resolvido. Workloads com semântica diferente exigem validação no Intune.

### Resultados de implantação

Nesta versão os conectores `intune.configuration.deployment` e `intune.compliance.deployment` coletam `deviceStatuses` de políticas clássicas via Graph v1.0. O status e `lastReportedDateTime` são declarações da fonte e ficam separados da estimativa local. Nome igual ou ID opaco de relatório não comprova correspondência única com um managedDevice. Settings Catalog, apps e scripts não recebem um relatório de implantação universal fictício; sem fonte suportada/coletada, o resultado permanece não verificado.

## Diagnosticar conexão

**Diagnóstico de conexão** agrupa fontes por serviço e mostra habilitação, permissão exigida, último sucesso, erro, correlação, nova tentativa e ação sugerida. Collector configurado não significa credencial válida. Coleta bem-sucedida não significa cobertura de todo o serviço. Uma consulta bem-sucedida com zero registros também não comprova tenant vazio.

Sucessos de fixtures são sempre simulados. Uma coleta real fica antiga depois de três intervalos configurados ou uma hora, o que for maior. Falhas 403 não são diagnosticadas automaticamente como falta de uma permissão específica: licença, consentimento, credencial e restrições do serviço podem estar envolvidos. O diagnóstico não concede acesso.

Admin pode enfileirar coletas representativas já habilitadas: Entra (organization/users), Intune (devices/configuration/catalog), Azure (subscriptions), Microsoft 365 (licenses), SharePoint (sites), Teams (teams) e Exchange (feed audit.exchange). O worker normal executa as coletas e a tela de Coletas apresenta o resultado. O botão não inicia feed, não altera permissões e não valida todas as APIs do workload. Aguarde os jobs e atualize o diagnóstico. Em demo, a ação é recusada no servidor.

## Homologação em tenant real

Compare uma mudança conhecida e uma reversão com as evidências; confirme separadamente eventos com autor. Prepare uma política com grupo de máquinas, exclusão e filtro; confira uma máquina incluída, uma excluída e uma sem dados suficientes. Repita com grupo dinâmico, atribuição por usuário e filtro não suportado, esperando indicação de incerteza. Compare relatórios clássicos com o Intune e timestamps de última sincronização.

Teste consentimento ausente, credencial inválida, assinatura Azure inacessível, feed não iniciado e worker parado. Valide dois tenants separados e os três papéis Atlas. Testes com fixtures não substituem essa homologação.

Referências Microsoft: [atribuição de políticas e exclusões](https://learn.microsoft.com/intune/device-configuration/assign-device-profile), [grupos aninhados para apps](https://learn.microsoft.com/intune/app-management/deployment/assign-groups), [propriedades de filtros](https://learn.microsoft.com/en-us/intune/fundamentals/filters/ref-device-properties), [resultados de configuração](https://learn.microsoft.com/en-us/graph/api/intune-deviceconfig-deviceconfigurationdevicestatus-list?view=graph-rest-1.0), [resultados de conformidade](https://learn.microsoft.com/en-us/graph/api/intune-deviceconfig-devicecompliancedevicestatus-list?view=graph-rest-1.0).
