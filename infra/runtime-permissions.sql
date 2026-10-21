-- Executar como dono da migração. Crie atlas_runtime por processo administrativo
-- separado; nunca coloque uma senha de produção neste arquivo.
GRANT CONNECT ON DATABASE atlas TO atlas_runtime;
GRANT USAGE ON SCHEMA public TO atlas_runtime;
GRANT SELECT,INSERT,UPDATE ON tenants,coverage,runs,resources,edges TO atlas_runtime;
GRANT SELECT,INSERT,UPDATE,DELETE ON session,collection_cursors TO atlas_runtime;
GRANT SELECT,INSERT ON evidence,resource_versions,audit_ledger,bridge_nonces,events TO atlas_runtime;
GRANT USAGE,SELECT ON SEQUENCE audit_ledger_id_seq TO atlas_runtime;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
-- O runtime não deve possuir as tabelas, ser superuser nem integrar o papel
-- da migração. Eventos/evidências são preservados; configure retenção externa.
