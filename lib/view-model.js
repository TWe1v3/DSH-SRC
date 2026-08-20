export function scopeList(scope = {}) {
  if (Array.isArray(scope)) return [...scope];
  return [
    ...(scope.domains || []),
    ...(scope.ips || []),
    ...(scope.apps || []),
  ];
}

function scopeDetail(scope = {}) {
  if (Array.isArray(scope)) return { domains: [...scope], ips: [], apps: [], excluded: [], tierMap: {} };
  return {
    domains: scope.domains || [], ips: scope.ips || [], apps: scope.apps || [],
    excluded: scope.excluded || [], tierMap: scope.tierMap || {},
  };
}

function normalizeFact(fact) {
  return { ...fact, evidenceState: fact.evidenceState || fact.confidence || 'candidate' };
}

function normalizeFinding(finding) {
  return {
    ...finding,
    reproducibleSteps: finding.reproducibleSteps || (typeof finding.reproSteps === 'string' ? finding.reproSteps.split('\n').filter(Boolean) : []),
    supportingFactIds: finding.supportingFactIds || [],
    affectedAssetIds: finding.affectedAssetIds || [],
    humanReproduced: finding.humanReproduced === true,
  };
}

export function buildSessionView(id, session = {}) {
  const engagement = session.engagement || {};
  const assets = session.assets || [];
  const intents = session.intents || [];
  const facts = (session.facts || []).map(normalizeFact);
  const findings = (session.findings || []).map(normalizeFinding);
  return {
    id,
    schemaVersion: session.schemaVersion || 1,
    platform: engagement.platform || 'unknown',
    engagement,
    scope: scopeList(engagement.scope),
    scopeDetail: scopeDetail(engagement.scope),
    authorization: engagement.authorization || '',
    assets,
    intents,
    facts,
    findings,
    edges: session.edges || [],
    counts: { assets: assets.length, intents: intents.length, facts: facts.length, findings: findings.length },
    updatedAt: session.updatedAt || null,
  };
}

export function buildViewModel(raw = {}) {
  return {
    schemaVersion: 2,
    sessions: Object.entries(raw.sessions || {}).map(([id, session]) => buildSessionView(id, session)),
  };
}
