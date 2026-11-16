#!/usr/bin/env node
import { FREE_MODELS } from "../models.js";
import { BIN_NAME, PROVIDER } from "./constants.js";
import { runWithRotation } from "./run.js";
import { loadState, saveState, STATE_FILE } from "./state.js";
import { startServer } from "../server.js";

const HELP = `${BIN_NAME} — rotação cíclica de modelos free do OpenCode

USO
  ${BIN_NAME} <comando> [opções]

COMANDOS
  run [opções] [prompt...]   Executa o opencode com o próximo modelo free
  models                     Lista os modelos free e marca o próximo da rotação
  status                     Mostra o estado atual da rotação
  reset [--index n]          Reinicia o estado (padrão: índice 0)
  config                     Mostra como apontar o OpenCode para o proxy local
  serve                      Inicia o proxy HTTP compatível com a API OpenAI
  help                       Mostra esta ajuda

OPÇÕES DE "run"
  --start <id>        Começa a rotação por um modelo específico
  --attempts <n>      Número máximo de tentativas (padrão: ${FREE_MODELS.length})
  --dry-run           Mostra qual modelo seria usado, sem executar
  --verbose           Loga cada tentativa no stderr
  --                  Repassa o resto dos argumentos direto ao opencode run
  --help              Mostra a ajuda do comando run

EXEMPLOS
  ${BIN_NAME} run "corrija o bug do login"
  ${BIN_NAME} run -- --continue --format json
  ${BIN_NAME} run --start hy4-flash-free "explique este código"
  ${BIN_NAME} models
  ${BIN_NAME} status

ESTADO
  ${STATE_FILE}
`;

function parsePositiveInt(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined;
}

function parseRunArgs(args: string[]): {
  passthrough: string[];
  startModel?: string;
  maxAttempts?: number;
  dryRun: boolean;
  verbose: boolean;
  help: boolean;
} {
  const passthrough: string[] = [];
  let startModel: string | undefined;
  let maxAttempts: number | undefined;
  let dryRun = false;
  let verbose = false;
  let help = false;
  let passthroughOnly = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (passthroughOnly) {
      passthrough.push(arg);
      continue;
    }
    if (arg === "--") {
      passthroughOnly = true;
      continue;
    }
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--verbose") {
      verbose = true;
      continue;
    }
    if (arg === "--help") {
      help = true;
      continue;
    }
    if (arg === "--start" || arg === "--attempts") {
      const value = args[i + 1];
      if (value === undefined) {
        console.error(`[ocf] ${arg} exige um valor.`);
        process.exit(1);
      }
      i += 1;
      if (arg === "--start") startModel = value;
      else maxAttempts = parsePositiveInt(value);
      continue;
    }

    passthrough.push(arg);
  }

  return { passthrough, startModel, maxAttempts, dryRun, verbose, help };
}

async function printModels(): Promise<number> {
  const state = await loadState();
  const current = state.index % FREE_MODELS.length;
  for (let i = 0; i < FREE_MODELS.length; i += 1) {
    const model = FREE_MODELS[i];
    const marker = i === current ? "proximo" : "        ";
    console.log(`${String(i).padStart(2)}  ${marker}  ${model.id.padEnd(30)} ${model.label}`);
  }
  return 0;
}

async function printStatus(): Promise<number> {
  const state = await loadState();
  const next = FREE_MODELS[state.index % FREE_MODELS.length];
  console.log(`estado:        ${STATE_FILE}`);
  console.log(`proximo:       ${PROVIDER}/${next.id}`);
  console.log(`ultimo:        ${state.lastModel ? `${PROVIDER}/${state.lastModel}` : "(nenhum)"}`);
  console.log(`total rodadas: ${state.totalRuns}`);
  console.log(`atualizado:    ${state.updatedAt}`);
  return 0;
}

async function resetState(args: string[]): Promise<number> {
  const indexArg = args[0] === "--index" ? args[1] : undefined;
  const index = indexArg === undefined ? 0 : Number(indexArg);
  if (!Number.isFinite(index) || index < 0) {
    console.error("[ocf] --index deve ser um número inteiro >= 0.");
    return 1;
  }
  await saveState({ index: Math.floor(index), totalRuns: 0, updatedAt: new Date().toISOString() });
  console.log(`[ocf] rotação reiniciada no índice ${Math.floor(index)}.`);
  return 0;
}

function printConfig(): number {
  console.log(`O provider nativo "${PROVIDER}" já contém os modelos free.`);
  console.log(`Use: ${BIN_NAME} run "sua mensagem"\n`);
  console.log("Para usar o proxy como endpoint OpenAI-compatible, configure opencode.json:");
  console.log(`{
  "$schema": "https://opencode.ai/config.json",
  "providers": {
    "opencode-failover": {
      "name": "OpenCode Failover",
      "package": "@opencode/ai/providers/openai-compatible",
      "options": {
        "apiKey": "{env:OPENCODE_API_KEY}",
        "baseURL": "http://127.0.0.1:8787/v1"
      }
    }
  }
}`);
  return 0;
}

function serve(): number {
  const port = Number(process.env.PORT ?? 8787);
  const host = process.env.HOST ?? "0.0.0.0";
  const { server } = startServer({ port, host });
  server.listen(port, host, () => {
    console.log(`${BIN_NAME} proxy listening on http://${host}:${port}`);
  });
  return 0;
}

async function main(): Promise<number> {
  const [command, ...args] = process.argv.slice(2);

  switch (command) {
    case undefined:
    case "help":
    case "--help":
    case "-h":
      console.log(HELP);
      return 0;

    case "run": {
      const parsed = parseRunArgs(args);
      if (parsed.help) {
        console.log(HELP);
        return 0;
      }
      const maxAttempts =
        parsed.maxAttempts ?? parsePositiveInt(process.env.FAILOVER_MAX_ATTEMPTS) ?? FREE_MODELS.length;
      return runWithRotation({
        args: parsed.passthrough,
        startModel: parsed.startModel,
        maxAttempts,
        dryRun: parsed.dryRun,
        verbose: parsed.verbose,
      });
    }

    case "models":
      return printModels();

    case "status":
      return printStatus();

    case "reset":
      return resetState(args);

    case "config":
      return printConfig();

    case "serve":
      return serve();

    default:
      console.error(`[ocf] comando desconhecido: ${command}`);
      console.error("Use --help para ver os comandos disponíveis.");
      return 1;
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(`[ocf] erro: ${String(error)}`);
    process.exitCode = 1;
  });
