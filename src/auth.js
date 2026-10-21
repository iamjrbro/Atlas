import { ConfidentialClientApplication } from "@azure/msal-node";
import { createRemoteJWKSet, decodeJwt, jwtVerify } from "jose";
import { createHash, randomBytes } from "node:crypto";
import {
  AppError,
  random,
  equal,
  uuidPattern,
  claimsIdentity,
} from "./security.js";
import { ensureTenant, ledger } from "./store.js";
import { transaction } from "./db.js";
const save = (s) =>
  new Promise((resolve, reject) => s.save((e) => (e ? reject(e) : resolve())));
export function createAuth(config, pool) {
  const jwks = new Map();
  const client = () =>
    new ConfidentialClientApplication({
      auth: {
        clientId: config.webClientId,
        authority: "https://login.microsoftonline.com/organizations",
        clientSecret: config.webClientSecret,
      },
    });
  return {
    async login(req, res) {
      if (config.mode !== "microsoft") return res.redirect("/");
      const t = {
        state: random(),
        nonce: random(),
        verifier: randomBytes(48).toString("base64url"),
        at: Date.now(),
      };
      req.session.transaction = t;
      const url = await client().getAuthCodeUrl({
        redirectUri: config.origin + "/auth/callback",
        scopes: ["openid", "profile", "email"],
        responseMode: "query",
        state: t.state,
        nonce: t.nonce,
        codeChallenge: createHash("sha256")
          .update(t.verifier)
          .digest("base64url"),
        codeChallengeMethod: "S256",
        prompt: "select_account",
      });
      await save(req.session);
      res.redirect(url);
    },
    async callback(req, res) {
      const t = req.session.transaction;
      delete req.session.transaction;
      await save(req.session);
      if (
        !t ||
        Date.now() - t.at > 300000 ||
        !equal(t.state, req.query.state) ||
        typeof req.query.code !== "string"
      )
        throw new AppError(
          401,
          "LOGIN_TRANSACTION",
          "Login expirado ou inválido. Inicie novamente.",
        );
      const tokens = await client().acquireTokenByCode({
        code: req.query.code,
        redirectUri: config.origin + "/auth/callback",
        scopes: ["openid", "profile", "email"],
        codeVerifier: t.verifier,
      });
      if (!tokens?.idToken) throw new AppError(401, "MISSING_ID_TOKEN");
      const tid = decodeJwt(tokens.idToken).tid;
      if (!uuidPattern.test(tid || ""))
        throw new AppError(401, "INVALID_TENANT");
      let keys = jwks.get(tid);
      if (!keys) {
        keys = createRemoteJWKSet(
          new URL(
            `https://login.microsoftonline.com/${tid}/discovery/v2.0/keys`,
          ),
        );
        if (jwks.size >= 200) jwks.delete(jwks.keys().next().value);
        jwks.set(tid, keys);
      }
      const { payload } = await jwtVerify(tokens.idToken, keys, {
        issuer: `https://login.microsoftonline.com/${tid}/v2.0`,
        audience: config.webClientId,
        algorithms: ["RS256"],
        requiredClaims: ["exp", "nbf", "iat", "tid", "oid", "nonce"],
        clockTolerance: 10,
      });
      const actor = claimsIdentity(payload, {
        tenant: tid,
        clientId: config.webClientId,
        nonce: t.nonce,
      });
      let tenant = (
        await pool.query("SELECT * FROM tenants WHERE id=$1", [tid])
      ).rows[0];
      if (!tenant && config.autoOnboard && actor.roles.includes("Atlas.Admin"))
        tenant = await ensureTenant(pool, tid, "Tenant " + tid.slice(0, 8));
      if (!tenant?.enabled)
        throw new AppError(
          403,
          "TENANT_NOT_ENROLLED",
          "Tenant não habilitado. Consulte o guia de onboarding.",
        );
      await new Promise((resolve, reject) =>
        req.session.regenerate((e) => (e ? reject(e) : resolve())),
      );
      req.session.actor = actor;
      req.session.started = Date.now();
      req.session.csrf = random();
      await transaction(pool, (db) =>
        ledger(db, tid, actor.oid, "session.login", actor.oid),
      );
      await save(req.session);
      res.redirect("/");
    },
    async consentStart(req, res) {
      if (!req.session.actor?.roles.includes("Atlas.Admin"))
        throw new AppError(403, "FORBIDDEN");
      const tenant = req.session.actor.tenant,
        resource =
          req.query.resource === "m365"
            ? "https://manage.office.com/.default"
            : "https://graph.microsoft.com/.default";
      req.session.consent = { state: random(), tenant, at: Date.now() };
      await save(req.session);
      const url = new URL(
        `https://login.microsoftonline.com/${tenant}/v2.0/adminconsent`,
      );
      url.search = new URLSearchParams({
        client_id: config.collectorClientId,
        scope: resource,
        redirect_uri: config.origin + "/auth/consent/callback",
        state: req.session.consent.state,
      });
      res.redirect(url);
    },
    async consentCallback(req, res) {
      const t = req.session.consent;
      delete req.session.consent;
      await save(req.session);
      if (
        !t ||
        Date.now() - t.at > 600000 ||
        !equal(t.state, req.query.state) ||
        req.session.actor?.tenant !== t.tenant ||
        String(req.query.tenant || "").toLowerCase() !== t.tenant ||
        (req.query.admin_consent !== "True" &&
          req.query.admin_consent !== "true")
      )
        throw new AppError(400, "CONSENT_TRANSACTION");
      await transaction(pool, (db) =>
        ledger(
          db,
          t.tenant,
          req.session.actor.oid,
          "collector.consent_returned",
          config.collectorClientId,
          { verifiedByCollection: false },
        ),
      );
      res.redirect("/#coverage");
    },
  };
}
export function authenticate(config, pool) {
  return async (req, res, next) => {
    const actor = req.session.actor;
    if (
      !actor ||
      !req.session.started ||
      Date.now() - req.session.started > 30 * 60 * 1000
    ) {
      req.session.destroy(() => {});
      throw new AppError(
        401,
        "LOGIN_REQUIRED",
        "Entre novamente para continuar.",
      );
    }
    const tenant = (
      await pool.query("SELECT * FROM tenants WHERE id=$1", [actor.tenant])
    ).rows[0];
    if (!tenant?.enabled) throw new AppError(403, "TENANT_DISABLED");
    req.actor = actor;
    req.tenant = tenant;
    next();
  };
}
