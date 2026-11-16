import { FREE_MODELS, type FailoverModel } from "./models";

export interface FailoverEnv {
  apiKey: string;
  baseUrl: string;
  maxAttempts?: number;
}

export interface ChatCompletionBody {
  model?: string;
  messages?: unknown[];
  stream?: boolean;
  [key: string]: unknown;
}

export type FailoverResult =
  | { ok: true; response: Response }
  | { ok: false; quota: true; status: number; body: unknown }
  | { ok: false; quota: false; status: number; body: unknown };

type AttemptResult =
  | { kind: "response"; response: Response }
  | { kind: "quota"; status: number; body: unknown }
  | { kind: "error"; status: number; body: unknown };

const QUOTA_PATTERNS: RegExp[] = [
  /insufficient[_ ]quota/i,
  /insufficient[_ ]balance/i,
  /no[_ ]credit/i,
  /credit[_ ]limit/i,
  /quota/i,
];

export function isQuotaError(status: number, bodyText: string): boolean {
  if (status === 429 || status === 402) return true;
  const text = bodyText.toLowerCase();
  return QUOTA_PATTERNS.some((pattern) => pattern.test(text));
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { error: { message: text } };
  }
}

export function resolveFailoverModel(requested?: string): FailoverModel | undefined {
  const raw = requested && requested.includes("/") ? requested.split("/").pop() : requested;
  const id = raw?.trim();
  if (!id) return FREE_MODELS[0];
  return FREE_MODELS.find((m) => m.id === id);
}

async function attemptModel(params: {
  apiKey: string;
  baseUrl: string;
  modelId: string;
  body: ChatCompletionBody;
  signal?: AbortSignal;
}): Promise<AttemptResult> {
  const url = `${params.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${params.apiKey}`,
      },
      body: JSON.stringify({ ...params.body, model: params.modelId }),
      signal: params.signal,
    });
  } catch (cause) {
    return { kind: "error", status: 502, body: { error: { message: `Upstream request failed: ${String(cause)}` } } };
  }

  if (upstream.ok) {
    return { kind: "response", response: upstream };
  }

  const text = await upstream.text();
  const body = safeJsonParse(text);

  if (isQuotaError(upstream.status, text)) {
    return { kind: "quota", status: upstream.status, body };
  }

  return { kind: "error", status: upstream.status, body };
}

export async function runChatCompletionsFailover(params: {
  apiKey: string;
  baseUrl: string;
  body: ChatCompletionBody;
  maxAttempts?: number;
  signal?: AbortSignal;
}): Promise<FailoverResult> {
  const requestedModelId = params.body?.model
    ? params.body.model.includes("/")
      ? params.body.model.split("/").pop()!.trim()
      : params.body.model.trim()
    : undefined;

  if (requestedModelId && !FREE_MODELS.some((m) => m.id === requestedModelId)) {
    return {
      ok: false,
      quota: false,
      status: 400,
      body: {
        error: {
          message: `Model "${requestedModelId}" is not in the failover catalog.`,
          available: FREE_MODELS.map((m) => m.id),
        },
      },
    };
  }

  const startIndex = requestedModelId ? FREE_MODELS.findIndex((m) => m.id === requestedModelId) : 0;
  const queue: FailoverModel[] = [];
  for (let i = startIndex >= 0 ? startIndex : 0; i < FREE_MODELS.length; i += 1) {
    queue.push(FREE_MODELS[i]);
  }

  const maxAttempts = params.maxAttempts && params.maxAttempts > 0 ? Math.min(params.maxAttempts, queue.length) : queue.length;
  const failed = new Set<string>();
  let lastQuota: { status: number; body: unknown } | null = null;
  let attempts = 0;

  for (const model of queue) {
    if (failed.has(model.id)) continue;
    if (attempts >= maxAttempts) break;
    attempts += 1;

    const result = await attemptModel({
      apiKey: params.apiKey,
      baseUrl: params.baseUrl,
      modelId: model.id,
      body: params.body,
      signal: params.signal,
    });

    if (result.kind === "response") {
      return { ok: true, response: result.response };
    }

    if (result.kind === "quota") {
      failed.add(model.id);
      lastQuota = { status: result.status, body: result.body };
      continue;
    }

    return { ok: false, quota: false, status: result.status, body: result.body };
  }

  if (lastQuota) {
    return { ok: false, quota: true, status: lastQuota.status, body: lastQuota.body };
  }

  return {
    ok: false,
    quota: false,
    status: 503,
    body: { error: { message: "All failover models were exhausted without success." } },
  };
}
