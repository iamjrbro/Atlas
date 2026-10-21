const $ = (s) => document.querySelector(s),
  esc = (v) =>
    String(v ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
const drawings = {
  overview: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  events: "M3 12h4l3-8 4 16 3-8h4",
  inventory: "M3 7 12 2l9 5v10l-9 5-9-5z M3 7l9 5 9-5 M12 12v10",
  permissions: "M5 12h14 M12 5v14 M12 5 5 12l7 7 7-7z",
  licenses: "M4 5h16v14H4z M4 9h16 M8 14h3",
  findings: "M12 3 2 21h20z M12 9v5 M12 17h.01",
  coverage: "M12 3 3 7v5c0 5 9 10 9 10s9-5 9-10V7z M8 12l3 3 5-6",
  runs: "M12 8v5l3 2 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
  ledger:
    "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M8 13h8 M8 17h5",
  settings:
    "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z",
  search: "M21 21l-6-6 M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0",
  arrow: "M5 12h14 M13 6l6 6-6 6",
  download: "M12 3v12 M7 10l5 5 5-5 M4 16v5h16v-5",
  external: "M14 3h7v7 M21 3 10 14 M10 3H3v18h18v-7",
  close: "M6 6l12 12 M18 6 6 18",
  refresh: "M20 7v5h-5 M4 17v-5h5 M6 6a8 8 0 0 1 14 6 M18 18A8 8 0 0 1 4 12",
  menu: "M3 6h18 M3 12h18 M3 18h18",
  connect:
    "M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2 M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2",
  check: "M4 12l5 5L20 6",
  user: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
};
const icon = (n) =>
  `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${drawings[n] || drawings.coverage}"/></svg>`;
const mark = `<svg viewBox="0 0 36 36" fill="none" aria-hidden="true"><path d="M18 3 32 11v14l-14 8-14-8V11z" stroke="currentColor" stroke-width="1.5"/><path d="m18 9 7 18-7-4-7 4z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><circle cx="18" cy="18" r="13" stroke="currentColor" stroke-opacity=".25"/></svg>`;
const brand = `<div class="brand">${mark}atlas<small>OBSERVATORY</small></div>`;
const btn = (text, action, cls = "", attrs = "") =>
  `<button class="${cls}" data-action="${action}" ${attrs}>${text}</button>`;
const statuses = {
  success: ["Conectada", ""],
  partial: ["Coleta parcial", "warn"],
  forbidden: ["Sem permissão", "bad"],
  needs_setup: ["Configurar", "warn"],
  failed: ["Falha", "bad"],
  gap: ["Lacuna histórica", "bad"],
  never: ["Não coletada", "gray"],
  queued: ["Na fila", "violet"],
  running: ["Coletando", "violet"],
  high: ["Alta", "bad"],
  medium: ["Média", "warn"],
  info: ["Informativa", "gray"],
};
const pill = (value, cls) => {
  const [name, color] = statuses[value] || [value, "gray"];
  return `<span class="pill ${cls ?? color}">${esc(name)}</span>`;
};
const initials = (n) =>
  String(n || "?")
    .split(" ")
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();
const serviceIcon = (s) =>
  `<span class="service-icon">${esc({ "Entra ID": "EN", "Microsoft 365": "365", Azure: "AZ", SharePoint: "SP", "Exchange Online": "EX", Intune: "IN", Teams: "T" }[s] || s.slice(0, 2))}</span>`;
let me = null,
  sessionInfo = {},
  state = {
    page: "overview",
    offset: 0,
    q: "",
    service: "",
    kind: "",
    source: "",
    category: "",
    from: "",
    to: "",
  },
  cache = {},
  generation = 0,
  timezone =
    Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Sao_Paulo";
const isAdmin = () => me?.actor.roles.includes("Atlas.Admin"),
  isAuditor = () =>
    me?.actor.roles.some((r) => ["Atlas.Admin", "Atlas.Auditor"].includes(r));
const menu = () => [
  ["overview", "Visão geral"],
  ["events", "Linha do tempo"],
  ["inventory", "Inventário de recursos"],
  ["users", "Usuários"],
  ["groups", "Grupos e membros"],
  ["intune", "Intune · políticas e scripts"],
  ["azure", "Azure · assinaturas e recursos"],
  ["costs", "Custos Azure"],
  ["permissions", "Caminhos de acesso"],
  ["licenses", "Licenças e capacidade"],
  ["findings", "Pontos de atenção"],
  ["coverage", "Fontes e cobertura"],
  ["runs", "Coletas"],
  ...(isAuditor() ? [["ledger", "Evidências e integridade"]] : []),
  ["settings", "Conectar meu tenant"],
];
const fmt = (value) =>
  value
    ? new Date(value).toLocaleString("pt-BR", { timeZone: timezone })
    : "Não informado pela fonte";
const num = (value) => Number(value || 0).toLocaleString("pt-BR");
function toast(message) {
  $("#toast").textContent = message;
  $("#toast").style.display = "block";
  clearTimeout(window.toastId);
  window.toastId = setTimeout(() => ($("#toast").style.display = "none"), 6000);
}
async function api(path, { method = "GET", body } = {}) {
  const response = await fetch("/api" + path, {
    method,
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(method !== "GET" ? { "x-csrf-token": me?.csrf || "" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error("Resposta inválida do servidor.");
  }
  if (response.status === 401) {
    me = null;
    await login();
    throw new Error("Sua sessão expirou. Entre novamente.");
  }
  if (!response.ok)
    throw new Error(
      `${result.message || result.code || "Operação indisponível"}${result.requestId ? " · ID " + result.requestId : ""}`,
    );
  return result;
}
function title(name, desc, actions = "") {
  return `<div class="page-head"><div><div class="eyebrow">IDENTITY, ACCESS & CHANGE INTELLIGENCE</div><h1>${name}</h1><p>${desc}</p></div><div class="actions">${actions}</div></div>`;
}
function shell() {
  const current = menu().find(([p]) => p === state.page)?.[1] || "Atlas";
  document.title = current + " · Atlas";
  $("#app").innerHTML =
    `<aside>${brand}<div class="workspace"><span class="avatar">${esc(initials(me.tenant.name))}</span><span><b>${esc(me.tenant.name)}</b><small>${me.mode === "demo" ? "Workspace demonstrativo" : "Microsoft Entra ID"}</small></span></div><nav><div class="nav-label">EXPLORAR</div>${menu()
      .map(
        ([p, label], i) =>
          `${i === 6 ? '<div class="nav-label">VISIBILIDADE & CONTROLE</div>' : ""}${btn(icon(p) + label, "nav", state.page === p ? "active" : "", `data-page="${p}"`)}`,
      )
      .join(
        "",
      )}</nav><div class="sidebar-bottom"><div class="collection-state"><b><span class="dot"></span> Evidência antes de conclusões</b>Conheça suas fontes.<br>Enxergue também as lacunas.</div><div class="profile"><span class="avatar">${esc(initials(me.actor.name))}</span><span><b>${esc(me.actor.name)}</b><small>${esc(me.actor.roles.map((r) => r.replace("Atlas.", "")).join(" · "))}</small></span></div></div></aside><main><header><div class="breadcrumbs">${btn(icon("menu"), "menu", "ghost menu-toggle", 'aria-label="Abrir menu"')}Workspace <span>/</span><b>${current}</b></div><div class="header-actions">${btn(icon("search") + ' Buscar em seu ambiente <span class="key">⌘ K</span>', "search", "search-trigger")}<span class="tag">${me.mode === "demo" ? "DEMONSTRAÇÃO" : "TENANT ISOLADO"}</span>${btn(icon("refresh"), "refresh", "ghost", 'aria-label="Atualizar dados"')}${btn("Sair", "logout", "ghost")}</div></header><div class="content">${me.mode === "demo" ? `<div class="demo-banner">${icon("coverage")} Dados fictícios de demonstração. Nenhuma conexão Microsoft está ativa. ${btn("Conectar meu tenant ↗", "nav", "ghost small", 'data-page="settings"')}</div>` : ""}<div id="view"><div class="empty">Consultando evidências do seu ambiente…</div></div><div class="footer"><span>Atlas Identity Observatory <span>·</span> Azure & Microsoft 365</span><span>Horários: ${esc(timezone)} ${btn("Alternar UTC", "timezone", "ghost small")}</span></div></div></main>`;
}
async function login() {
  sessionInfo = await fetch("/api/session").then((r) => r.json());
  document.title = "Atlas · Entrar";
  $("#app").innerHTML =
    `<div class="login"><section class="login-story">${brand}<div><div class="eyebrow">YOUR TENANT. EVERY CONNECTION. THE EVIDENCE.</div><h1>Visibilidade que<br>conecta os pontos.</h1><p>Identidades, recursos, permissões e mudanças.<br>Um observatório para entender o seu ambiente Microsoft, com evidências que você pode verificar.</p><div class="login-features"><span>Azure</span><span>Microsoft 365</span><span>Microsoft Entra</span></div></div><span class="login-foot">IDENTITY OBSERVATORY &nbsp; / &nbsp; OPEN SOURCE</span><svg class="art" viewBox="0 0 400 400" fill="none"><circle cx="200" cy="200" r="150" stroke="#b6a3da"/><circle cx="200" cy="200" r="100" stroke="#b6a3da"/><path d="m200 40 140 240-140-50L60 280Z" stroke="#b6a3da" stroke-width="2"/><path d="M20 200h360M200 20v360" stroke="#b6a3da" stroke-dasharray="3 9"/></svg></section><section class="login-panel"><div class="login-box"><div class="eyebrow">BEM-VINDO AO ATLAS</div><h2>O seu próximo nível<br>de visibilidade.</h2><p>Acesse o observatório com sua identidade corporativa. Os dados de cada organização permanecem separados.</p>${sessionInfo.mode === "demo" ? `<form id="demo-form"><label for="demo-tenant">Workspace demonstrativo</label><select id="demo-tenant">${sessionInfo.demoTenants.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join("")}</select><label for="demo-role">Perfil</label><select id="demo-role"><option value="Atlas.Admin">Administrador</option><option value="Atlas.Auditor">Auditor</option><option value="Atlas.Reader">Leitor</option></select><button class="primary" type="submit">Explorar demonstração ${icon("arrow")}</button></form><div class="notice">Ambiente local com dados fictícios de Azure e Microsoft 365. A demonstração não realiza chamadas à Microsoft.</div>` : `<a class="primary" href="/auth/login">Entrar com Microsoft ${icon("arrow")}</a><div class="notice">Primeiro acesso? O administrador deve consentir o aplicativo e atribuir um papel Atlas. A coleta é configurada após o login.</div>`}<div class="tiny">Transparência por padrão: o Atlas mostra a origem, o período coletado e os pontos que ainda não consegue enxergar.</div><p class="error-text" id="login-error"></p></div></section></div>`;
}
async function load(page = state.page, { preserve = false } = {}) {
  if (!me) return;
  clearTimeout(searchTimer);
  state.page = page;
  if (!preserve)
    Object.assign(state, {
      offset: 0,
      q: "",
      service: "",
      kind: "",
      source: "",
      category: "",
      from: "",
      to: "",
    });
  if (!preserve) {
    if (page === "users") state.kind = "user";
    if (page === "groups") state.kind = "group";
    if (page === "intune") state.service = "Intune";
    if (page === "azure") state.service = "Azure";
  }
  const id = ++generation;
  shell();
  try {
    if (!cache.coverage) cache.coverage = (await api("/coverage")).items;
    if (page === "overview") {
      const [overview, events, findings] = await Promise.all([
        api("/overview"),
        api("/events?limit=5"),
        api("/findings"),
      ]);
      cache.overview = overview;
      cache.recent = events.items;
      cache.findings = findings.items;
    }
    if (
      [
        "inventory",
        "events",
        "users",
        "groups",
        "intune",
        "azure",
        "costs",
      ].includes(page)
    )
      cache.list = await getList();
    if (page === "licenses")
      cache.licenses = (await api("/resources?kind=license&limit=200")).items;
    if (page === "findings") cache.findings = (await api("/findings")).items;
    if (page === "coverage") cache.coverage = (await api("/coverage")).items;
    if (page === "runs") cache.runs = (await api("/runs")).items;
    if (page === "ledger") {
      const [ledger, integrity] = await Promise.all([
        api("/ledger"),
        api("/integrity"),
      ]);
      cache.ledger = ledger.items;
      cache.integrity = integrity;
    }
    if (page === "permissions")
      cache.principals = (await api("/resources?limit=200")).items.filter((r) =>
        ["user", "group", "servicePrincipal"].includes(r.kind),
      );
    if (id !== generation) return;
    $("#view").innerHTML = views[page]();
    window.scrollTo(0, 0);
  } catch (error) {
    if (id === generation && $("#view"))
      $("#view").innerHTML =
        `<div class="notice error"><h2>Não foi possível carregar o observatório.</h2><p>${esc(error.message)}</p>${btn("Tentar novamente", "refresh", "primary")}</div>`;
  }
}
function coverageSummary() {
  const sources = cache.coverage || [],
    ok = sources.filter((s) => s.status === "success").length,
    enabled = sources.filter((s) => s.enabled).length;
  return {
    ok,
    enabled,
    total: sources.length,
    pending: sources.filter((s) => s.enabled && s.status !== "success").length,
  };
}
function chart() {
  const values = [];
  for (let i = 6; i >= 0; i--) {
    const day = new Date(Date.now() - i * 86400000);
    const key = day.toISOString().slice(0, 10);
    const found = cache.overview.activity.find(
      (a) => new Date(a.day).toISOString().slice(0, 10) === key,
    );
    values.push({
      value: Number(found?.count || 0),
      label: day.toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "short",
      }),
    });
  }
  const max = Math.max(1, ...values.map((x) => x.value));
  return `<div class="chart"><svg viewBox="0 0 620 180" role="img" aria-label="Contagem de eventos coletados por dia, últimos sete dias">${[20, 60, 100, 140].map((y, i) => `<path d="M30 ${y}H615" stroke="#f0edf5" stroke-dasharray="3 5"/><text x="0" y="${y + 3}" fill="#a49bae" font-size="9">${Math.round(max * (1 - i / 4))}</text>`).join("")}${values
    .map((x, i) => {
      const height = (x.value / max) * 130;
      return `<rect x="${52 + i * 80}" y="${155 - height}" width="35" height="${height}" rx="4" fill="${i === 6 ? "#9274c3" : "#d9cfeb"}"><title>${x.label}: ${x.value} eventos</title></rect>`;
    })
    .join(
      "",
    )}</svg><div class="chart-labels">${values.map((x) => `<span>${x.label}</span>`).join("")}</div></div>`;
}
function overview() {
  const o = cache.overview,
    c = coverageSummary(),
    findings = cache.findings.filter((f) => f.severity !== "info").slice(0, 3);
  return (
    title(
      "Seu tenant, em perspectiva.",
      "Conecte identidades, recursos e mudanças. Investigue a partir de evidências.",
      btn(icon("download") + " Exportar eventos", "export") +
        btn(
          icon("connect") + " Gerenciar fontes",
          "nav",
          "primary",
          'data-page="coverage"',
        ),
    ) +
    `<div class="hero"><div><div class="eyebrow">VISIBILIDADE COM CONTEXTO</div><h2>Não basta saber o que aconteceu.<br>Entenda as conexões por trás.</h2><p>Da criação de um recurso ao acesso por um grupo: explore as relações<br>e acompanhe a cobertura real de cada fonte.</p>${btn("Explorar caminhos de acesso &nbsp; ↗", "nav", "ghost", 'data-page="permissions"')}</div><div class="hero-art"><svg viewBox="0 0 300 260" fill="none"><circle cx="165" cy="140" r="105" stroke="currentColor"/><circle cx="165" cy="140" r="70" stroke="currentColor"/><circle cx="165" cy="140" r="35" stroke="currentColor"/><path d="M20 140h290M165 0v260M90 65l150 150M90 215 240 65" stroke="currentColor" stroke-dasharray="3 7"/><path d="m165 55 52 135-52-35-52 35z" stroke="currentColor" stroke-width="2"/><circle cx="165" cy="140" r="5" fill="currentColor"/></svg></div></div><div class="metrics">${[
      [o.resources, "Recursos observados", "inventory", "Inventário do tenant"],
      [
        o.permissions,
        "Relações de acesso",
        "permissions",
        "Atribuições e associações",
      ],
      [o.events, "Eventos preservados", "events", "Com referência à evidência"],
      [
        c.ok + "/" + c.total,
        "Fontes com última coleta OK",
        "coverage",
        c.pending + " fontes habilitadas precisam de atenção",
      ],
    ]
      .map(
        ([v, t, i, d]) =>
          `<div class="metric"><div class="metric-top">${t}${icon(i)}</div><div class="metric-value">${typeof v === "string" ? esc(v) : num(v)}</div><div class="metric-foot">${esc(d)}</div></div>`,
      )
      .join(
        "",
      )}</div><div class="grid"><div class="card"><div class="card-head"><div><h2>O movimento do seu ambiente</h2><p>Eventos por data de ocorrência ou detecção · últimos 7 dias</p></div>${pill("7 dias", "gray")}</div><div class="chart-legend"><span><span class="dot"></span>Eventos coletados</span><span>A cobertura varia por fonte</span></div>${chart()}</div><div class="card"><div class="card-head"><div><h2>Pontos para investigar</h2><p>Sinais baseados nos dados disponíveis</p></div>${pill(findings.length + " sinais", "warn")}</div>${findings.map((f) => `<div class="mini-row"><span class="mini-icon ${f.severity === "high" ? "bad" : "warn"}">${icon("findings")}</span><div><h3>${esc(f.title)}</h3><p>${esc(f.resourceName)}</p></div>${btn(icon("arrow"), "finding", "ghost small", `data-id="${f.id}" aria-label="Investigar sinal"`)}</div>`).join("") || '<div class="empty"><b>Nenhum sinal nas regras atuais.</b>Isso não garante ausência de riscos.</div>'}<div class="card-foot"><span>Regras explícitas. Sem pontuações inventadas.</span>${btn("Ver todos ↗", "nav", "ghost", 'data-page="findings"')}</div></div></div><div class="grid"><div class="card"><div class="card-head"><div><h2>Últimos acontecimentos</h2><p>Quem fez, onde e quando — conforme a fonte</p></div>${btn("Abrir linha do tempo ↗", "nav", "ghost small", 'data-page="events"')}</div>${eventsTable(cache.recent, true)}</div><div class="card"><div class="card-head"><div><h2>Um ecossistema conectado</h2><p>Distribuição dos recursos observados</p></div>${icon("inventory")}</div>${o.services
      .slice(0, 6)
      .map(
        (s) =>
          `<div class="mini-row">${serviceIcon(s.service)}<div class="source-info"><h3>${esc(s.service)}</h3></div><b>${num(s.count)}</b>${btn(icon("arrow"), "service", "ghost small", `data-service="${esc(s.service)}" aria-label="Explorar ${esc(s.service)}"`)}</div>`,
      )
      .join(
        "",
      )}<div class="card-foot"><span>${c.ok} fontes com sucesso na última coleta</span>${btn("Ver lacunas ↗", "nav", "ghost", 'data-page="coverage"')}</div></div></div>`
  );
}
function eventsTable(items, compact = false) {
  return `<div class="table-wrap"><table><thead><tr><th>EVENTO / ALVO</th><th>ATOR</th><th>QUANDO</th>${compact ? "" : "<th>FONTE</th><th>RESULTADO</th>"}<th></th></tr></thead><tbody>${items.map((v) => `<tr><td class="cell-text"><strong>${esc(v.operation)}</strong><small title="${esc(v.target_name)}">${esc(v.target_name || v.target_key || "Alvo não informado")}</small></td><td><strong>${esc(v.actor_name || "Não informado")}</strong><small>${esc(v.category === "inventory" ? "Detecção por snapshot" : v.actor_key?.slice(0, 30) || "Conforme a fonte")}</small></td><td><strong>${esc(fmt(v.occurred_at || v.observed_at))}</strong><small>${v.occurred_at ? "Ocorrência" : "Detecção · horário real desconhecido"}</small></td>${compact ? "" : `<td>${esc(v.source)}</td><td>${pill(v.outcome || "Não informado")}</td>`}<td>${btn(icon("arrow"), "event", "ghost small", `data-id="${v.id}" aria-label="Detalhes do evento"`)}</td></tr>`).join("") || '<tr><td colspan="6" class="empty">Nenhum evento corresponde aos filtros.</td></tr>'}</tbody></table></div>`;
}
function filters(type) {
  const services = [
    "Azure",
    "Entra ID",
    "Microsoft 365",
    "Exchange Online",
    "SharePoint",
    "Intune",
    "Teams",
  ];
  return `<div class="toolbar">${icon("search")}<input id="query" aria-label="Buscar ${type === "events" ? "eventos" : "recursos"}" placeholder="${type === "events" ? "Buscar evento, ator ou recurso" : "Buscar nome ou identificador do recurso"}" value="${esc(state.q)}">${
    type === "events"
      ? `<select id="source-filter" aria-label="Filtrar fonte"><option value="">Todas as fontes</option>${cache.coverage
          .filter((s) => s.type === "events")
          .map(
            (s) =>
              `<option value="${s.id}" ${state.source === s.id ? "selected" : ""}>${esc(s.name)}</option>`,
          )
          .join(
            "",
          )}</select><select id="category-filter" aria-label="Categoria"><option value="">Todas as categorias</option>${[
          ["access", "Acessos"],
          ["change", "Mudanças"],
          ["inventory", "Snapshots"],
          ["data_access", "Plano de dados"],
        ]
          .map(
            ([v, l]) =>
              `<option value="${v}" ${state.category === v ? "selected" : ""}>${l}</option>`,
          )
          .join(
            "",
          )}</select><input type="date" id="from-filter" aria-label="A partir de" value="${state.from.slice(0, 10)}"><input type="date" id="to-filter" aria-label="Até" value="${state.to.slice(0, 10)}">`
      : `<select id="service-filter" aria-label="Serviço"><option value="">Todos os serviços</option>${services.map((s) => `<option ${state.service === s ? "selected" : ""}>${s}</option>`).join("")}</select><select id="kind-filter" aria-label="Tipo"><option value="">Todos os tipos</option>${["user", "group", "application", "servicePrincipal", "site", "team", "device", "license", "mailbox", "directoryRole", "azureRole", "conditionalAccess", "directoryDevice", "devicePolicy", "intuneScript", "intuneSetting", "assignmentFilter", "managedApp", "subscription", "azureConfiguration"].map((k) => `<option ${state.kind === k ? "selected" : ""}>${k}</option>`).join("")}</select>`
  }</div>`;
}
function pagination() {
  return `<div class="pagination"><span>${state.offset + 1}–${state.offset + cache.list.items.length} · até 50 registros por página</span><div>${btn("← Anterior", "previous", "small", state.offset === 0 ? "disabled" : "")}${btn("Próxima →", "next", "small", !cache.list.hasMore ? "disabled" : "")}</div></div>`;
}
function resourceTable(items) {
  return `<div class="table-wrap"><table><thead><tr><th>RECURSO</th><th>SERVIÇO / TIPO</th><th>CRIADO EM</th><th>CRIADO POR</th><th>OBSERVADO EM</th><th></th></tr></thead><tbody>${items.map((r) => `<tr><td class="cell-text"><div class="person"><span class="avatar">${esc(initials(r.name))}</span><div><strong>${esc(r.name)}</strong><small title="${esc(r.key)}">${esc(r.key)}</small></div></div></td><td><strong>${esc(r.service)}</strong><small>${esc(r.kind)}</small></td><td>${r.created_at ? esc(fmt(r.created_at)) : "<span>Não informado pela fonte</span>"}</td><td>${esc(r.created_by || "Não informado pela fonte")}</td><td>${esc(fmt(r.last_seen))}</td><td>${btn(icon("arrow"), "resource", "ghost small", `data-key="${esc(r.key)}" aria-label="Detalhes do recurso"`)}</td></tr>`).join("") || '<tr><td colspan="6" class="empty">Nenhum recurso corresponde aos filtros.</td></tr>'}</tbody></table></div>`;
}
function inventory() {
  return (
    title(
      {
        users: "Usuários · licenças e grupos",
        groups: "Grupos · usuários e dispositivos",
        intune: "Intune · políticas, scripts e atribuições",
        azure: "Azure · assinaturas e configurações",
      }[state.page] || "Inventário de recursos",
      "Do usuário à infraestrutura. Criação, propriedades e histórico em um só lugar.",
    ) +
    `<div class="card">${filters("inventory")}<div id="list-results">${resourceTable(cache.list.items)}${pagination()}</div></div>`
  );
}
function events() {
  return (
    title(
      "Linha do tempo unificada",
      "Investigue acessos e mudanças com identidade, horário e evidência.",
      btn(icon("download") + " Exportar JSON", "export"),
    ) +
    `<div class="notice">Filtros por dia usam UTC. Horário de ocorrência vem do provedor. Comparações de inventário registram somente o horário de detecção. Registros ausentes podem decorrer de retenção, licença, permissão ou coleta.</div><div class="card">${filters("events")}<div id="list-results">${eventsTable(cache.list.items)}${pagination()}</div></div>`
  );
}
async function getList() {
  const params = new URLSearchParams({
    limit: 50,
    offset: state.offset,
    q: state.q,
  });
  for (const key of ["service", "kind", "source", "category", "from", "to"])
    if (state[key]) params.set(key, state[key]);
  return api(
    "/" +
      (state.page === "events"
        ? "events"
        : state.page === "costs"
          ? "costs"
          : "resources") +
      "?" +
      params,
  );
}
async function refreshList() {
  const id = ++generation;
  try {
    const result = await getList();
    if (id !== generation) return;
    cache.list = result;
    $("#list-results").innerHTML =
      (state.page === "events"
        ? eventsTable(result.items)
        : state.page === "costs"
          ? costTable(result.items)
          : resourceTable(result.items)) + pagination();
  } catch (err) {
    toast(err.message);
  }
}
function permissions() {
  return (
    title(
      "De onde vem esse acesso?",
      "Siga associações, atribuições e escopos. Cada caminho leva à sua evidência.",
    ) +
    `<div class="notice warning">Este explorador mostra caminhos de permissão observados. Condições, deny assignments, PIM, ACLs não coletadas e outras fontes podem alterar a autorização efetiva.</div><div class="card"><div class="toolbar">${icon("permissions")}<select id="principal" aria-label="Selecionar identidade"><option value="">Selecione uma identidade ou grupo</option>${cache.principals.map((r) => `<option value="${esc(r.key)}">${esc(r.name)} · ${esc(r.kind)}</option>`).join("")}</select><input id="principal-key" placeholder="Ou informe a chave exata, ex.: entra:UUID" aria-label="Chave da identidade">${btn("Investigar caminho", "access", "primary")}</div><div id="access-results"><div class="relationship-graph"><svg viewBox="0 0 650 200" role="img" aria-label="Exemplo conceitual: identidade conectada a grupo, papel e recurso"><path class="graph-line" d="M110 100H540"/><rect class="graph-node" x="25" y="70" width="120" height="60" rx="12"/><rect class="graph-node" x="185" y="70" width="120" height="60" rx="12"/><rect class="graph-node" x="345" y="70" width="120" height="60" rx="12"/><rect class="graph-node" x="505" y="70" width="120" height="60" rx="12"/><text class="graph-label" x="85" y="105" text-anchor="middle">Identidade</text><text class="graph-label" x="245" y="105" text-anchor="middle">Grupo</text><text class="graph-label" x="405" y="105" text-anchor="middle">Papel</text><text class="graph-label" x="565" y="105" text-anchor="middle">Recurso</text></svg><div class="graph-empty">Selecione uma identidade para consultar caminhos reais coletados. Diagrama acima é conceitual.</div></div></div></div>`
  );
}
async function access() {
  const principal = $("#principal-key").value.trim() || $("#principal").value;
  if (!principal) {
    toast("Selecione uma identidade ou informe a chave.");
    return;
  }
  const result = await api(
    "/access?principal=" + encodeURIComponent(principal),
  );
  cache.access = result;
  const name = (key) =>
    cache.principals.find((p) => p.key === key)?.name || key;
  $("#access-results").innerHTML = result.paths.length
    ? `${result.limited ? '<div class="notice warning">Há limite de profundidade ou de resultados. A visão é parcial.</div>' : ""}${result.paths.map((p) => `<div class="path-card"><div class="path">${(p.membershipPaths[0] || [principal]).map((k) => `<span class="node">${esc(name(k))}</span><span class="arrow">→</span>`).join("")}<span class="node">${esc(p.roleName || p.role || p.relation)}</span><span class="arrow">→</span><span class="node">${esc(p.targetName || p.to_key)}</span></div><p>${esc(p.relation)} ${p.scope ? "· Escopo: " + esc(p.scope) : ""} ${p.properties.condition ? "· Atribuição condicional" : ""} ${p.properties.deny || p.properties.accessControlType === "Deny" ? "· Negação declarada na fonte" : ""}</p>${isAuditor() ? btn("Ver evidência ↗", "evidence", "ghost small", `data-id="${p.evidence_id}"`) : ""}${btn("Explorar recurso", "resource", "ghost small", `data-key="${esc(p.to_key)}"`)}</div>`).join("")}`
    : '<div class="empty"><b>Nenhum caminho observado.</b>Isso não comprova ausência de acesso. Confira as fontes e seus escopos.</div>';
}
function licenses() {
  return (
    title(
      "Licenças com contexto",
      "Capacidade habilitada, consumo e planos — sem estimativas financeiras inventadas.",
    ) +
    `<div class="tiles">${
      cache.licenses
        .map((r) => {
          const p = r.properties,
            enabled = p.prepaidUnits?.enabled || 0,
            consumed = p.consumedUnits || 0;
          return `<div class="card tile"><div class="tile-header">${serviceIcon("Microsoft 365")}${pill(p.capabilityStatus || "Não informado")}</div><h2>${esc(p.skuPartNumber || r.name)}</h2><p>${(p.servicePlans || []).length} planos de serviço associados à SKU.</p><div class="definition"><span>Unidades habilitadas</span><b>${num(enabled)}</b></div><div class="definition"><span>Unidades consumidas</span><b>${num(consumed)}</b></div><div class="definition"><span>Saldo habilitado</span><b>${num(enabled - consumed)}</b></div><div class="definition"><span>Suspensas / em alerta</span><b>${num(p.prepaidUnits?.suspended)} / ${num(p.prepaidUnits?.warning)}</b></div><div class="tile-foot"><span class="code">${esc(p.skuId?.slice(0, 12))}…</span>${btn("Investigar atribuições ↗", "resource", "ghost small", `data-key="${esc(r.key)}"`)}</div></div>`;
        })
        .join("") ||
      '<div class="card full empty">Conecte a fonte de licenças para consultar as SKUs do tenant.</div>'
    }</div><div class="notice spacer-note">Saldo de licenças não comprova desperdício. Preços, uso efetivo das aplicações e regras contratuais não são calculados nesta versão.</div>`
  );
}
function findings() {
  return (
    title(
      "Pontos de atenção",
      "Regras transparentes sobre os dados coletados. Investigue antes de agir.",
    ) +
    `<div class="card">${cache.findings.map((f) => `<div class="mini-row"><span class="mini-icon ${f.severity === "high" ? "bad" : f.severity === "medium" ? "warn" : ""}">${icon("findings")}</span><div class="source-info"><h3>${esc(f.title)}</h3><p>${esc(f.resourceName)} · ${esc(f.service)}</p></div>${pill(f.severity)}${btn("Investigar →", "finding", "ghost small", `data-id="${f.id}"`)}</div>`).join("") || '<div class="empty"><b>Nenhum sinal nas regras atuais.</b>Consulte a cobertura antes de tirar conclusões sobre segurança.</div>'}</div>`
  );
}
function coverage() {
  const c = coverageSummary();
  return (
    title(
      "O que o Atlas consegue enxergar",
      "Conexões, permissões e lacunas da coleta. Transparência é parte da auditoria.",
      isAdmin()
        ? btn(
            icon("refresh") + " Coletar habilitadas",
            "collect-all",
            "primary",
          )
        : "",
    ) +
    `<div class="notice">${c.ok} de ${c.total} fontes com sucesso na última coleta. Isso mede o estado das fontes, não a porcentagem de todas as atividades do tenant auditadas. Últimas coletas antigas devem ser investigadas.</div><div class="card source-list">${cache.coverage.map((s) => `<div class="mini-row">${serviceIcon(s.service)}<div class="source-info"><h3>${esc(s.name)} ${s.elevated ? pill("Permissão elevada", "warn") : ""}</h3><p>${esc(s.service)} · ${esc(s.permission)}</p><small>Última coleta OK: ${s.last_success ? esc(fmt(s.last_success)) : "nunca"} · ${num(s.records)} registros ${s.enabled ? "" : "· desabilitada"}</small></div>${pill(s.status)}${btn(icon("arrow"), "source", "ghost small", `data-id="${s.id}" aria-label="Detalhes da fonte ${esc(s.name)}"`)}</div>`).join("")}</div>`
  );
}
function runs() {
  return (
    title(
      "Coletas e processamento",
      "Janelas, limites e resultados de cada execução.",
    ) +
    `<div class="card"><div class="table-wrap"><table><thead><tr><th>FONTE</th><th>STATUS</th><th>INICIADA EM</th><th>REGISTROS</th><th>JANELA / ERRO</th></tr></thead><tbody>${cache.runs.map((r) => `<tr><td><strong>${esc(r.source)}</strong><small>${esc(r.id)}</small></td><td>${pill(r.status)}</td><td>${esc(fmt(r.started_at || r.created_at))}</td><td>${num(r.records)}</td><td class="cell-text">${r.error_code ? esc(r.error_code) : r.window_start ? esc(fmt(r.window_start)) + " → " + esc(fmt(r.window_end)) : "Snapshot de inventário"}<small>Concluída: ${r.finished_at ? esc(fmt(r.finished_at)) : "em andamento"}</small></td></tr>`).join("") || '<tr><td colspan="5" class="empty">Nenhuma coleta executada.</td></tr>'}</tbody></table></div></div>`
  );
}
function ledger() {
  return (
    title(
      "Evidência que você pode verificar",
      "Rastreie a operação do Atlas e valide a cadeia de auditoria.",
      btn(icon("check") + " Verificar integridade", "verify", "primary"),
    ) +
    `<div class="notice ${cache.integrity.valid ? "" : "error"}">${cache.integrity.valid ? "Cadeia consistente" : "Falha de integridade detectada"} · ${cache.integrity.checked} entradas verificadas. A cadeia precisa de uma âncora externa para detectar substituição integral ou remoção do final por um administrador do banco.</div><div class="card"><div class="card-head"><div><h2>Ledger do Atlas</h2><p>Login, configurações, coletas e acesso a evidências</p></div>${pill("Append-only", "violet")}</div><div class="table-wrap"><table><thead><tr><th>SEQUÊNCIA / EVENTO</th><th>ATOR</th><th>ALVO</th><th>HORÁRIO</th><th>HASH</th></tr></thead><tbody>${cache.ledger.map((l) => `<tr><td><strong>${esc(l.action)}</strong><small>#${esc(l.id)}</small></td><td>${esc(l.actor)}</td><td class="cell-text">${esc(l.target)}</td><td>${esc(fmt(l.at))}</td><td><span class="code">${esc(l.sha256.slice(0, 14))}…</span></td></tr>`).join("")}</tbody></table></div></div>`
  );
}
function settings() {
  return (
    title(
      "Seu tenant. Seu observatório.",
      "Onboarding, escopos e fontes de auditoria em um fluxo orientado.",
    ) +
    `<div class="grid"><div class="card steps"><div class="card-head"><div><h2>Conectar Azure e Microsoft 365</h2><p>Habilite cada serviço com consentimento e escopo explícitos</p></div></div><div class="step"><div><h3>Identidade e tenant</h3><p>Você está em ${esc(me.tenant.name)}.</p><span class="code">${esc(me.tenant.id)}</span></div></div><div class="step"><div><h3>Consentir o collector Microsoft Graph</h3><p>O administrador escolhe os dados disponibilizados ao Atlas. A conexão é confirmada por coleta, não apenas pelo retorno da tela de consentimento.</p>${me.mode === "demo" ? "<p>Demonstração: consentimento externo desabilitado.</p>" : '<div class="actions"><a href="/auth/consent?resource=graph">Abrir consentimento Microsoft ↗</a></div>'}</div></div><div class="step"><div><h3>Habilitar Azure e logs do Microsoft 365</h3><p>Atribua leitura ao service principal nos escopos Azure desejados. No Microsoft 365, consinta ActivityFeed.Read e ative as subscriptions do feed conforme o guia.</p>${me.mode === "microsoft" ? '<a href="/auth/consent?resource=m365">Consentir Management Activity API ↗</a>' : ""}</div></div><div class="step"><div><h3>Configurar e validar fontes</h3><p>Defina assinaturas e workspaces, habilite fontes e acompanhe as primeiras coletas. Exchange e ACLs de SharePoint usam os bridges PowerShell.</p>${btn("Abrir fontes e cobertura ↗", "nav", "ghost small", 'data-page="coverage"')}</div></div><div class="step"><div><h3>Verificar retenção e lacunas</h3><p>Ative os logs e políticas de retenção necessários na Microsoft. O Atlas não recupera eventos que a fonte nunca registrou ou já removeu.</p><a href="https://github.com/iamjrbro/Atlas/tree/main/docs" target="_blank" rel="noopener noreferrer">Consultar documentação ↗</a></div></div></div><div class="card settings-card"><h2>Escopo do tenant</h2>${isAdmin() ? `<form id="settings-form"><label for="tenant-name">Nome do workspace</label><input id="tenant-name" required maxlength="100" value="${esc(me.tenant.name)}"><label for="subscriptions">Assinaturas Azure · UUIDs separados por vírgula</label><textarea id="subscriptions" placeholder="Vazio: todas as assinaturas acessíveis pelo collector">${esc(me.tenant.settings.subscriptions?.join(", "))}</textarea><label for="workspaces">Workspaces Log Analytics · JSON</label><textarea id="workspaces" placeholder='[{"id":"UUID","tables":["AzureDiagnostics"]}]'>${esc(JSON.stringify(me.tenant.settings.workspaces || [], null, 2))}</textarea><div class="section-label">FONTES HABILITADAS</div>${cache.coverage.map((s) => `<label class="checkbox-line"><input type="checkbox" name="source" value="${s.id}" ${me.tenant.settings.sources?.includes(s.id) ? "checked" : ""}><span>${esc(s.name)}</span>${s.elevated ? pill("Elevada", "warn") : ""}</label>`).join("")}<div class="spacer"></div><button class="primary" type="submit">Salvar configuração</button><p class="error-text" id="settings-error"></p></form>` : "<p>Somente um administrador Atlas pode alterar configurações e solicitar coletas.</p>"}</div></div>`
  );
}
const views = {
  overview,
  events,
  inventory,
  users: inventory,
  groups: inventory,
  intune: inventory,
  azure: inventory,
  costs,
  permissions,
  licenses,
  findings,
  coverage,
  runs,
  ledger,
  settings,
};
let priorFocus;
function modal(title, body, footer = "") {
  priorFocus = document.activeElement;
  $("#modal-root").innerHTML =
    `<div class="modal-bg"><section class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="modal-head"><h2>${esc(title)}</h2>${btn(icon("close"), "close", "ghost", 'aria-label="Fechar"')}</div><div class="modal-body">${body}</div>${footer ? `<div class="modal-foot">${footer}</div>` : ""}</section></div>`;
  $(".modal button")?.focus();
}
function closeModal() {
  $("#modal-root").innerHTML = "";
  priorFocus?.focus();
}
async function resourceDetail(key, offset = 0, childOffset = 0) {
  const result = await api(
    "/resource?key=" +
      encodeURIComponent(key) +
      "&offset=" +
      offset +
      "&childOffset=" +
      childOffset,
  );
  cache.detail = result;
  const r = result.resource;
  modal(
    r.name,
    `${pill(r.service, "violet")} ${pill(r.kind)}<details class="resource-origin"><summary>Origem, identificação e datas</summary>${[
      ["Identificador", r.key],
      ["Criado em", fmt(r.created_at)],
      ["Criado por", r.created_by || "Não informado pela fonte"],
      ["Primeira observação", fmt(r.first_seen)],
      ["Última observação", fmt(r.last_seen)],
      ["Fonte", r.source],
    ]
      .map(
        ([k, v]) =>
          `<div class="definition"><span>${k}</span><b>${esc(v)}</b></div>`,
      )
      .join(
        "",
      )}</details>${detailExtras(result)}<div class="divider">GRUPOS, MEMBROS, LICENÇAS E ATRIBUIÇÕES</div>${result.edges.map((p) => `<div class="path-card"><div class="path"><span class="node">${p.fromCollected ? resourceLink(p.from_key, p.fromName) : esc(p.fromName)}</span><span class="arrow">→</span><span class="node">${esc({ assigned_to: "Incluído", excluded_from: "Excluído", assignment_filter: "Filtro · " + p.role }[p.relation] || p.roleName || p.role || p.relation)}</span><span class="arrow">→</span><span class="node">${p.toCollected ? resourceLink(p.to_key, p.toName) : esc(p.toName)}</span></div><p>${esc({ member_of: "Membro do grupo", owns: "Proprietário", licensed_for: "Licença atribuída", assigned_to: "Atribuição incluída", excluded_from: "Atribuição excluída", assignment_filter: "Filtro de atribuição" }[p.relation] || p.relation)} ${p.scope ? "· Escopo " + esc(p.scope) : ""}</p>${p.properties.target ? `<details><summary>Alvo e filtro declarados pela Microsoft</summary><pre>${esc(JSON.stringify(p.properties.target, null, 2))}</pre></details>` : ""}${isAuditor() ? btn("Ver evidência ↗", "evidence", "ghost small", `data-id="${p.evidence_id}"`) : ""}</div>`).join("") || "<p>Nenhuma relação coletada para este recurso.</p>"}${detailPagination(result)}<div class="notice warning">${result.limitations.map(esc).join("<br>")}</div><div class="divider">PROPRIEDADES OBSERVADAS</div><pre>${esc(JSON.stringify(r.properties, null, 2))}</pre><div class="divider">HISTÓRICO DE EVIDÊNCIAS</div>${result.versions.map((v) => `<div class="mini-row"><span>${esc(fmt(v.observed_at))}</span><span class="code">${esc(v.sha256.slice(0, 12))}…</span>${isAuditor() ? btn("Evidência", "evidence", "ghost small", `data-id="${v.evidence_id}"`) : ""}</div>`).join("")}`,
    isAuditor()
      ? btn(
          "Abrir evidência original",
          "evidence",
          "primary",
          `data-id="${r.evidence_id}"`,
        )
      : btn("Fechar", "close"),
  );
}

const money = (amount, currency) =>
  Number(amount).toLocaleString("pt-BR", { style: "currency", currency });
const resourceLink = (key, name) =>
  btn(esc(name), "resource", "ghost small", `data-key="${esc(key)}"`);
function detailPagination(d) {
  return `<div class="pagination"><span>Relações ${d.relationshipsOffset + 1}–${d.relationshipsOffset + d.edges.length}</span><div>${btn("← Anterior", "detail-page", "small", `data-offset="${Math.max(0, d.relationshipsOffset - 50)}" data-child-offset="${d.childrenOffset}" ${d.relationshipsOffset ? "" : "disabled"}`)}${btn("Próximas →", "detail-page", "small", `data-offset="${d.relationshipsOffset + 50}" data-child-offset="${d.childrenOffset}" ${d.relationshipsHasMore ? "" : "disabled"}`)}</div></div>`;
}
function detailExtras(d) {
  const r = d.resource,
    props = r.properties;
  const scriptFields = [
    "scriptContent",
    "detectionScriptContent",
    "remediationScriptContent",
  ].filter((k) => typeof props[k] === "string");
  const scripts = scriptFields
    .map((k) => {
      try {
        const bytes = Uint8Array.from(atob(props[k]), (c) => c.charCodeAt(0));
        return `<div class="divider">${esc(k)} · LEITURA</div><pre>${esc(new TextDecoder().decode(bytes))}</pre>`;
      } catch {
        return `<p>${esc(k)}: conteúdo não decodificado; consulte o JSON original.</p>`;
      }
    })
    .join("");
  return `${scripts}${r.kind === "user" ? `<div class="divider">IDENTIDADE E LICENCIAMENTO</div><p>${esc(props.userPrincipalName)} · ${esc(props.department)} · ${props.accountEnabled ? "Conta habilitada" : "Conta desabilitada ou estado não informado"}</p><p>Licenças atribuídas: ${num(props.assignedLicenses?.length)} · Veja planos desabilitados e origem na configuração observada.</p>${d.related.map((l) => `<div class="path-card">${resourceLink(l.key, l.name)}<pre>${esc(JSON.stringify({ servicePlans: l.properties.servicePlans, assignment: (props.assignedLicenses || []).find((a) => "license:" + a.skuId === l.key), assignmentStates: props.licenseAssignmentStates }, null, 2))}</pre></div>`).join("")}` : ""}
    ${d.costs.length ? `<div class="divider">CUSTOS REAIS OBSERVADOS</div>${d.costs.map((c) => `<div class="definition"><span>${esc(c.period_start.slice(0, 10))} até ${esc(fmt(c.period_end))}</span><b>${esc(money(c.amount, c.currency))}</b></div>`).join("")}<p>Valores podem sofrer ajustes e atraso de ingestão. Consulte a cobertura de azure.costs.</p>` : r.service === "Azure" ? `<p>Custos deste recurso: nenhum valor coletado. Confira a cobertura de azure.costs.</p>` : ""}
    ${d.children.length ? `<div class="divider">RECURSOS, CONFIGURAÇÕES E CONTEÚDO</div>${d.children.map((c) => `<div class="mini-row">${resourceLink(c.key, c.name)}${pill(c.kind)}</div>`).join("")}` : ""}
    ${d.childrenOffset || d.childrenHasMore ? `<div class="pagination">${btn("← Configurações anteriores", "detail-page", "small", `data-offset="${d.relationshipsOffset}" data-child-offset="${Math.max(0, d.childrenOffset - 50)}" ${d.childrenOffset ? "" : "disabled"}`)}${btn("Próximas configurações →", "detail-page", "small", `data-offset="${d.relationshipsOffset}" data-child-offset="${d.childrenOffset + 50}" ${d.childrenHasMore ? "" : "disabled"}`)}</div>` : ""}`;
}
function costTable(items) {
  return `<div class="table-wrap"><table class="cost-table"><thead><tr><th>RECURSO / ASSINATURA</th><th>DIA UTC</th><th>CUSTO REAL</th><th>EVIDÊNCIA</th></tr></thead><tbody>${items.map((c) => `<tr><td>${c.properties.resourceId ? (c.resource_key ? resourceLink(c.resource_key, c.resource_name) : esc(c.name.split("/").at(-1))) : "Cobrança sem ResourceId · " + (c.resource_key ? resourceLink(c.resource_key, c.resource_name) : esc(c.properties.subscriptionId))}<small>${esc(c.properties.subscriptionId)}</small></td><td>${esc(c.properties.usageDate.replace(/^(\d{4})(\d{2})(\d{2})$/, "$3/$2/$1"))}</td><td>${esc(money(c.properties.amount, c.properties.currency))}</td><td>${resourceLink(c.key, "Detalhes")}</td></tr>`).join("") || '<tr><td colspan="4">Nenhum custo coletado. Ausência de dados não significa custo zero.</td></tr>'}</tbody></table></div>`;
}
function costs() {
  const d = cache.list;
  return (
    title(
      "Custos Azure",
      "Custo real por recurso e assinatura, com moeda e período explícitos.",
    ) +
    `<div class="notice">${pill(d.coverage.status)} · ${esc(d.coverage.limitation)} Último sucesso: ${esc(fmt(d.coverage.last_success))}. Uma coleta parcial pode misturar observações de momentos distintos; confira o horário de cada registro.</div><div class="card">${d.totals.map((t) => `<div class="cost-total"><div><b>Assinatura · ${esc(t.subscription_id)}</b><small>${esc(t.period_start.slice(0, 10))} até ${esc(fmt(t.period_end))}</small></div><strong>${esc(money(t.amount, t.currency))}</strong></div>`).join("") || "<p>Totais indisponíveis sem coleta de custos.</p>"}</div><div class="card"><div class="toolbar"><input id="query" aria-label="Buscar custos por recurso ou assinatura" placeholder="Buscar recurso ou assinatura" value="${esc(state.q)}"></div><div id="list-results">${costTable(d.items)}${pagination()}</div></div>`
  );
}

async function evidence(id) {
  const v = await api("/evidence/" + id);
  cache.evidence = v;
  modal(
    "Evidência original",
    `${pill(v.hashValid ? "Hash validado" : "Hash divergente", v.hashValid ? "" : "bad")}<div class="definition"><span>Fonte</span><b>${esc(v.source)}</b></div><div class="definition"><span>Coletada em</span><b>${esc(fmt(v.observed_at))}</b></div><div class="definition"><span>SHA-256</span><b>${esc(v.sha256)}</b></div><p>Hash calculado sobre JSON canônico do registro e seu contexto. Valida a consistência armazenada; não é uma assinatura digital da Microsoft.</p><pre>${esc(JSON.stringify(v.payload, null, 2))}</pre>`,
    btn(icon("download") + " Baixar evidência", "download-evidence", "primary"),
  );
}
function eventDetail(id) {
  const item = [...(cache.list?.items || []), ...(cache.recent || [])].find(
    (x) => x.id === id,
  );
  if (!item) return;
  modal(
    item.operation,
    `${[
      ["Fonte", item.source],
      ["Categoria", item.category],
      ["Ator", item.actor_name || "Não informado pela fonte"],
      ["Alvo", item.target_name || item.target_key || "Não informado"],
      ["Ocorrido em", fmt(item.occurred_at)],
      ["Detectado/coletado em", fmt(item.observed_at)],
      ["Resultado", item.outcome || "Não informado"],
      ["Correlação", item.correlation_id || "Não informada"],
    ]
      .map(
        ([k, v]) =>
          `<div class="definition"><span>${k}</span><b>${esc(v)}</b></div>`,
      )
      .join(
        "",
      )}<div class="notice">UTC original: ${esc(item.occurred_at || "Horário da ocorrência desconhecido")}. Investigue a evidência antes de atribuir responsabilidade.</div>`,
    isAuditor()
      ? btn(
          "Examinar evidência",
          "evidence",
          "primary",
          `data-id="${item.evidence_id}"`,
        )
      : btn("Fechar", "close"),
  );
}
function findingDetail(id) {
  const f = cache.findings.find((v) => v.id === id);
  if (!f) return;
  modal(
    f.title,
    `${pill(f.severity)}<p>${esc(f.description)}</p><div class="definition"><span>Recurso</span><b>${esc(f.resourceName)}</b></div><div class="definition"><span>Regra</span><b>${esc(f.rule)}</b></div><div class="definition"><span>Observado em</span><b>${esc(fmt(f.observedAt))}</b></div><div class="notice">Sinal para investigação. Não confirma um incidente e não executa correções automaticamente.</div>`,
    btn(
      "Explorar recurso",
      "resource",
      "primary",
      `data-key="${esc(f.resourceKey)}"`,
    ) +
      (isAuditor()
        ? btn("Evidência", "evidence", "", `data-id="${f.evidenceId}"`)
        : ""),
  );
}
function sourceDetail(id) {
  const s = cache.coverage.find((v) => v.id === id);
  if (!s) return;
  modal(
    s.name,
    `${pill(s.status)} ${pill(s.enabled ? "Habilitada" : "Desabilitada", "gray")}${[
      ["Serviço", s.service],
      ["Permissão", s.permission],
      ["Tipo", s.type],
      ["Última tentativa", s.last_attempt ? fmt(s.last_attempt) : "Nunca"],
      ["Último sucesso", s.last_success ? fmt(s.last_success) : "Nunca"],
      ["Registros da última coleta", num(s.records)],
      ["Checkpoint", s.checkpoint ? fmt(s.checkpoint) : "Não disponível"],
      ["Diagnóstico", s.detail?.code || "Sem erro registrado"],
    ]
      .map(
        ([k, v]) =>
          `<div class="definition"><span>${k}</span><b>${esc(v)}</b></div>`,
      )
      .join(
        "",
      )}<div class="notice">${esc(s.limitation || "Cobertura limitada aos objetos e eventos disponibilizados pela API e pelas permissões configuradas.")}${s.license ? "<br>" + esc(s.license) : ""}</div>`,
    isAdmin() && s.provider !== "bridge" && s.enabled
      ? btn("Solicitar coleta", "collect", "primary", `data-id="${s.id}"`) +
          (s.provider === "graph" || s.id === "azure.configurations"
            ? btn("Reiniciar cursor", "reset-source", "", `data-id="${s.id}"`)
            : "")
      : btn("Fechar", "close"),
  );
}
function download(name, value) {
  const u = URL.createObjectURL(
      new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
    ),
    a = document.createElement("a");
  a.href = u;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 1000);
}
document.addEventListener("click", async (ev) => {
  if (ev.target.classList.contains("modal-bg")) return closeModal();
  const b = ev.target.closest("[data-action]");
  if (!b) return;
  try {
    const a = b.dataset.action;
    if (a === "nav") {
      closeModal();
      await load(b.dataset.page);
    }
    if (a === "menu") $("aside").classList.toggle("open");
    if (a === "close") closeModal();
    if (a === "search") {
      await load("inventory");
      $("#query").focus();
    }
    if (a === "refresh") {
      cache.coverage = null;
      await load(state.page, { preserve: true });
    }
    if (a === "logout") {
      await api("/logout", { method: "POST", body: {} });
      me = null;
      cache = {};
      closeModal();
      await login();
    }
    if (a === "timezone") {
      timezone =
        timezone === "UTC"
          ? Intl.DateTimeFormat().resolvedOptions().timeZone ||
            "America/Sao_Paulo"
          : "UTC";
      await load(state.page, { preserve: true });
    }
    if (a === "service") {
      await load("inventory");
      state.service = b.dataset.service;
      $("#service-filter").value = state.service;
      await refreshList();
    }
    if (a === "next" || a === "previous") {
      state.offset = Math.max(0, state.offset + (a === "next" ? 50 : -50));
      await refreshList();
    }
    if (a === "event") eventDetail(b.dataset.id);
    if (a === "resource") await resourceDetail(b.dataset.key);
    if (a === "detail-page")
      await resourceDetail(
        cache.detail.resource.key,
        Number(b.dataset.offset),
        Number(b.dataset.childOffset),
      );
    if (a === "evidence") await evidence(b.dataset.id);
    if (a === "finding") findingDetail(b.dataset.id);
    if (a === "source") sourceDetail(b.dataset.id);
    if (a === "access") await access();
    if (a === "reset-source") {
      await api("/sources/" + b.dataset.id + "/reset", {
        method: "POST",
        body: {},
      });
      closeModal();
      toast(
        "Cursor reiniciado. Evidências preservadas; solicite uma nova coleta.",
      );
    }
    if (a === "collect" || a === "collect-all") {
      const sources =
        a === "collect"
          ? [b.dataset.id]
          : cache.coverage
              .filter((s) => s.enabled && s.provider !== "bridge")
              .map((s) => s.id);
      await api("/collect", { method: "POST", body: { sources } });
      closeModal();
      toast("Solicitação de coleta registrada.");
      await load("runs");
    }
    if (a === "verify") {
      const r = await api("/integrity");
      toast(
        r.valid
          ? `Cadeia consistente: ${r.checked} entradas verificadas.`
          : "Divergência de integridade detectada.",
      );
    }
    if (a === "export") {
      if (!isAuditor()) {
        toast("A exportação de evidências exige papel Auditor ou Admin.");
        return;
      }
      download("atlas-events.json", await api("/export/events"));
      toast("Eventos exportados.");
    }
    if (a === "download-evidence")
      download("atlas-evidence-" + cache.evidence.id + ".json", cache.evidence);
  } catch (err) {
    toast(err.message);
  }
});
let searchTimer;
document.addEventListener("input", (ev) => {
  if (ev.target.id === "query") {
    state.q = ev.target.value;
    state.offset = 0;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(refreshList, 250);
  }
});
document.addEventListener("change", (ev) => {
  const fields = {
    "service-filter": "service",
    "kind-filter": "kind",
    "source-filter": "source",
    "category-filter": "category",
    "from-filter": "from",
    "to-filter": "to",
  };
  const field = fields[ev.target.id];
  if (field) {
    state[field] = ev.target.value
      ? ["from", "to"].includes(field)
        ? ev.target.value +
          (field === "from" ? "T00:00:00.000Z" : "T23:59:59.999Z")
        : ev.target.value
      : "";
    state.offset = 0;
    refreshList();
  }
  if (ev.target.id === "principal") $("#principal-key").value = "";
});
document.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const f = ev.target,
    b = f.querySelector('button[type="submit"]');
  if (b) b.disabled = true;
  try {
    if (f.id === "demo-form") {
      await api("/demo/session", {
        method: "POST",
        body: { tenant: $("#demo-tenant").value, role: $("#demo-role").value },
      });
      me = await api("/me");
      cache = {};
      await load("overview");
    }
    if (f.id === "settings-form") {
      let workspaces;
      try {
        workspaces = JSON.parse($("#workspaces").value || "[]");
      } catch {
        throw new Error("O JSON de workspaces é inválido.");
      }
      const settings = {
        name: $("#tenant-name").value,
        sources: [...f.querySelectorAll('input[name="source"]:checked')].map(
          (x) => x.value,
        ),
        subscriptions: $("#subscriptions")
          .value.split(",")
          .map((v) => v.trim())
          .filter(Boolean),
        workspaces,
      };
      await api("/tenant/settings", { method: "PUT", body: settings });
      me = await api("/me");
      cache.coverage = null;
      toast("Configuração do tenant salva.");
      await load("coverage");
    }
  } catch (err) {
    const el = $("#login-error") || $("#settings-error");
    if (el) el.textContent = err.message;
    else toast(err.message);
  } finally {
    if (b) b.disabled = false;
  }
});
document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape") closeModal();
  if ((ev.metaKey || ev.ctrlKey) && ev.key === "k" && me) {
    ev.preventDefault();
    load("inventory").then(() => $("#query").focus());
  }
  if (ev.key === "Tab" && $(".modal")) {
    const list = [
        ...$(".modal").querySelectorAll("button,a,input,select,textarea"),
      ].filter((x) => !x.disabled),
      first = list[0],
      last = list.at(-1);
    if (ev.shiftKey && document.activeElement === first) {
      ev.preventDefault();
      last.focus();
    } else if (!ev.shiftKey && document.activeElement === last) {
      ev.preventDefault();
      first.focus();
    }
  }
});
async function boot() {
  try {
    const s = await fetch("/api/session").then((r) => r.json());
    if (s.authenticated) {
      me = await api("/me");
      const requested = location.hash.slice(1);
      await load(
        menu().some((m) => m[0] === requested) ? requested : "overview",
      );
    } else await login();
  } catch (err) {
    $("#app").innerHTML =
      `<div class="loading">Não foi possível iniciar o Atlas: ${esc(err.message)}</div>`;
  }
}
boot();
