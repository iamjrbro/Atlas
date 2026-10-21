# Contribuir com o Atlas

Abra uma issue com o serviço, endpoint, permissão de leitura, dados disponíveis e limitações. Para novos conectores:

1. Use API documentada e registre a fonte em `src/sources.js`.
2. Mantenha o tenant derivado da sessão/job, sem aceitar sua troca pelo payload de consulta.
3. Inclua paginação, orçamento, erros explícitos, evidências e interpretação correta de horário/autor.
4. Não use permissões de escrita como atalho quando existir alternativa de leitura suficiente.
5. Crie fixtures fictícias com `example.test` e testes sem chamadas externas.
6. Atualize cobertura/onboarding e documente o que o endpoint não revela.
7. Execute `npm run check`, `npm test` e análise de dependências.

Nunca faça commit de `.env`, conteúdo de tenant, tokens, bancos, dumps, certificados ou chaves privadas. Alterações que coletam dados novos precisam descrever a finalidade e as permissões necessárias. Não acrescente execução arbitrária de consultas, comandos PowerShell ou mutações Microsoft expostas ao navegador.

Pull requests devem explicar o comportamento antes/depois, o serviço coberto, evidências de testes e limites de validação. Não descreva mocks como homologação em tenant real.
