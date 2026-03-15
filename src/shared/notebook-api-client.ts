const NOTEBOOK_BATCH_EXECUTE_URL = 'https://notebooklm.google.com/_/LabsTailwindUi/data/batchexecute';

export function stripAntiXssiPrefix(body) {
  return String(body || '').replace(/^\)\]\}'\n/, '');
}

export function parseBatchExecuteBody(body) {
  const normalized = stripAntiXssiPrefix(body);
  const lines = normalized.split('\n').filter(Boolean);
  const payloadLine = lines.find(line => line.trim().startsWith('['));

  if (!payloadLine) {
    throw new Error('NotebookLM response payload missing.');
  }

  return JSON.parse(payloadLine);
}

export function buildRpcUrl({ rpcId, sourcePath, bl, fSid, hl, reqId }) {
  const url = new URL(NOTEBOOK_BATCH_EXECUTE_URL);
  url.searchParams.set('rpcids', rpcId);
  url.searchParams.set('source-path', sourcePath);
  url.searchParams.set('bl', bl);
  url.searchParams.set('f.sid', fSid);
  url.searchParams.set('hl', hl);
  url.searchParams.set('_reqid', String(reqId));
  url.searchParams.set('rt', 'c');
  return url.toString();
}

export function buildRpcFetchOptions({ at, fReq }) {
  return {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
    },
    body: new URLSearchParams({
      'f.req': fReq,
      at,
    }).toString(),
  };
}

export function buildFReqEnvelope({ rpcId, paramsJson }) {
  return JSON.stringify([[[rpcId, paramsJson, null, 'generic']]]);
}

export async function callNotebookRpc({
  fetchImpl,
  authSnapshot,
  rpcId,
  paramsJson,
  sourcePath = '/',
  hl = 'en',
  reqId = Date.now(),
}) {
  const rpcUrl = buildRpcUrl({
    rpcId,
    sourcePath,
    bl: authSnapshot.bl,
    fSid: authSnapshot.fSid,
    hl,
    reqId,
  });

  const fReq = buildFReqEnvelope({ rpcId, paramsJson });
  const options = buildRpcFetchOptions({ at: authSnapshot.at, fReq });
  const response = await fetchImpl(rpcUrl, options);
  const bodyText = await response.text();

  if (!response.ok) {
    throw new Error(`NotebookLM RPC failed with HTTP ${response.status}.`);
  }

  const payload = parseBatchExecuteBody(bodyText);
  return {
    payload,
    bodyText,
  };
}
