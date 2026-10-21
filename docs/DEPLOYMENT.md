# Hospedagem e operação

## Perfis

**Demo local:** Node 24, `npm ci --ignore-scripts`, `npm start`. PGlite usa memória por padrão; a demonstração é recriada ao reiniciar. Persistência é opcional via `DEMO_DATABASE_PATH` em disco local compatível. Não use o diretório PGlite simultaneamente em dois processos nem como banco compartilhado de produção. Prefira disco local, fora de sincronização OneDrive, para operação contínua.

**Homologação Microsoft:** copie `.env.example`, configure `APP_MODE=microsoft`, as credenciais e PostgreSQL. Com Docker Compose, defina também `POSTGRES_PASSWORD` e `DATABASE_URL=postgresql://atlas:SENHA_URL_ENCODED@postgres:5432/atlas`, `DATABASE_SSL=disable`, `NODE_ENV=development`. Execute `docker compose up --build`. O perfil utiliza um dono único do banco para facilitar homologação e não deve ser promovido sem separar papéis/rede/TLS.

**Produção proposta:** Azure Container Apps ou App Service for Containers, Azure Database for PostgreSQL com TLS, Key Vault para credenciais/certificados e conectividade restrita. Este repositório não cria infraestrutura Azure automaticamente e não houve implantação em uma assinatura real.

```powershell
docker build -t atlas:0.2.0 .
```

## Implantação

1. Registre as aplicações e configure consentimento/roles conforme [ONBOARDING.md](ONBOARDING.md).
2. Crie PostgreSQL com backup/PITR, TLS e rede privada. Use conta de migração separada da aplicação.
3. Execute `npm run migrate` como job administrativo. A aplicação Microsoft exige esquema já existente e não migra na inicialização de cada réplica.
4. Crie runtime com [infra/runtime-permissions.sql](../infra/runtime-permissions.sql). Ele não pode ser dono, superuser ou membro do papel de migração.
5. Injete `APP_MODE=microsoft`, `NODE_ENV=production`, `PUBLIC_ORIGIN=https://...`, `DATABASE_SSL=require`, credenciais e chaves HMAC via secret store. Configure a quantidade exata de proxies confiáveis em `TRUST_PROXY_HOPS`.
6. Configure probes `/health/live` e `/health/ready`. Readiness verifica banco/esquema, não todos os serviços Microsoft.
7. Mantenha pelo menos uma réplica ativa: coleta está no processo web e não executa com escala zero.
8. Faça a homologação por serviço e revise o volume antes de habilitar clientes adicionais.

A imagem roda como usuário `node`. Monte PEMs com leitura para esse usuário, sem incluí-los na imagem. `COLLECTOR_CERT_THUMBPRINT` é SHA-256; a validade/rotação do certificado é responsabilidade do operador. O web client atual usa segredo confidencial.

## Coleta e diagnóstico

- Intervalo padrão: 900 segundos. Orçamento: 100 páginas e 50.000 registros por job.
- Fontes Graph persistem cursor; demais fontes têm os limites descritos em [COVERAGE.md](COVERAGE.md).
- HTTP 429/5xx fazem repetição limitada com backoff. Retry-After longo não bloqueia o worker; o agendador respeita `retryAt` registrado.
- Se uma fonte ficar parcial, confira orçamento/escopo e progresso. Se cursor Graph expirar, reinicie o cursor por endpoint administrativo autenticado e execute nova coleta.
- Eventos têm sobreposição de 60 minutos por padrão. Aumente/realize backfill quando o atraso das fontes exigir.
- Cada erro HTTP tem `X-Request-ID`. Logs de erro evitam tokens/corpos externos; erros de coleta guardam códigos e correlação, não respostas arbitrárias.
- Monitore idade de `last_success`, quantidade de jobs, latência, duração de leases, consumo do PostgreSQL, 429/403 e crescimento de evidências.

## Backups, retenção e incidentes

O produto preserva evidências/eventos por padrão. Isso não substitui uma política de retenção: determine prazos por cliente e requisitos de privacidade, use exportação/arquivamento e planeje descarte sob procedimento administrativo revisado. Triggers append-only impedem exclusões comuns do runtime; um processo de retenção precisa ser externo e deliberado.

Faça backups com restauração testada, proteja-os e armazene cópias/heads fora do banco operacional para detecção de substituição da cadeia. Não há storage WORM automático, assinatura externa ou exportação contínua para SIEM nesta versão.

Para interromper a coleta de um tenant, desabilite-o no banco por procedimento administrativo e pare os jobs/reinicie workers se houver operação em voo. Desabilitar novas fontes pela UI impede novos jobs e jobs ainda não iniciados; não cancela necessariamente uma requisição Microsoft já em andamento.

Sessões duram no máximo 30 minutos, com 15 minutos de inatividade. Remoção de role/desabilitação no Entra não possui CAE/back-channel invalidation nesta versão. O operador pode invalidar sessões no PostgreSQL. Não há impersonação de suporte ou bypass de autenticação em produção.

## Verificações antes do lançamento

Valide pentest, privacidade/LGPD, residência de dados, escopo das permissões, isolamento, autenticação/consentimento, observabilidade, RTO/RPO, rotação, retenção e teste de carga. Rate limiting é por réplica; para SaaS use controle global em gateway/WAF. Dados de auditoria podem conter UPN, IP, nomes de arquivos e configurações sensíveis. PostgreSQL gerenciado/volumes devem oferecer criptografia em repouso; o aplicativo não implementa criptografia por cliente.
