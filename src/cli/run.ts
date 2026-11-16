import { spawn } from "node:child_process";
import { isQuotaError } from "../failover.js";
import { FREE_MODELS, type FailoverModel } from "../models.js";
import { PROVIDER } from "./constants.js";
import { loadState, saveState } from "./state.js";

export interface RunOptions {
  /** Argumentos repassados ao `opencode run` (prompt e flags). */
  args: string[];
  /** ID do modelo por onde começar esta execução. */
  startModel?: string;
  /** Limite de tentativas nesta execução. */
  maxAttempts?: number;
  /** Mostra qual modelo seria usado, sem executar nada. */
  dryRun?: boolean;
  /** Logs extras no stderr. */
  verbose?: boolean;
}

interface AttemptResult {
  exitCode: number;
  quota: boolean;
}

const MAX_BUFFER = 20_000;

/** Executa o opencode uma vez com um modelo específico e detecta erro de cota na saída. */
function runOnce(model: FailoverModel, args: string[], verbose: boolean): Promise<AttemptResult> {
  return new Promise((resolve) => {
    if (verbose) {
      console.error(`[ocf] executando ${PROVIDER}/${model.id}`);
    }

    const child = spawn("opencode", ["run", "--model", `${PROVIDER}/${model.id}`, ...args], {
      stdio: ["inherit", "pipe", "pipe"],
      env: process.env,
    });

    let buffer = "";
    const capture = (chunk: Buffer, target: NodeJS.WriteStream): void => {
      buffer = (buffer + chunk.toString("utf8")).slice(-MAX_BUFFER);
      target.write(chunk);
    };

    child.stdout?.on("data", (chunk: Buffer) => capture(chunk, process.stdout));
    child.stderr?.on("data", (chunk: Buffer) => capture(chunk, process.stderr));

    child.on("error", (error) => {
      console.error(`[ocf] falha ao executar o opencode: ${String(error)}`);
      resolve({ exitCode: 1, quota: false });
    });

    child.on("close", (code) => {
      const exitCode = code ?? 1;
      resolve({ exitCode, quota: isQuotaError(exitCode, buffer) });
    });
  });
}

/** Roda o prompt com rotação circular, avançando de modelo quando a cota esgota. */
export async function runWithRotation(options: RunOptions): Promise<number> {
  let state = await loadState();

  if (options.startModel) {
    const index = FREE_MODELS.findIndex((model) => model.id === options.startModel);
    if (index < 0) {
      console.error(`[ocf] modelo "${options.startModel}" não existe no catálogo free.`);
      return 1;
    }
    state = { ...state, index };
  }

  const maxAttempts = Math.min(
    options.maxAttempts && options.maxAttempts > 0 ? options.maxAttempts : FREE_MODELS.length,
    FREE_MODELS.length,
  );

  if (options.dryRun) {
    const model = FREE_MODELS[state.index % FREE_MODELS.length];
    console.log(`${PROVIDER}/${model.id}`);
    return 0;
  }

  let lastExitCode = 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const model = FREE_MODELS[state.index % FREE_MODELS.length];
    const nextIndex = (state.index + 1) % FREE_MODELS.length;
    const now = new Date().toISOString();

    // Reserva o próximo índice ANTES de executar: assim a rotação continua
    // mesmo que a tentativa atual falhe ou o processo seja interrompido.
    state = {
      index: nextIndex,
      lastModel: model.id,
      lastRunAt: now,
      totalRuns: state.totalRuns + 1,
      updatedAt: now,
    };
    await saveState(state);

    if (options.verbose) {
      console.error(`[ocf] tentativa ${attempt}/${maxAttempts} -> ${model.id}`);
    }

    const result = await runOnce(model, options.args, options.verbose ?? false);
    lastExitCode = result.exitCode;

    if (result.exitCode === 0) {
      return 0;
    }
    if (!result.quota) {
      return result.exitCode;
    }

    if (options.verbose) {
      console.error(`[ocf] cota esgotada em ${model.id}; avançando para o próximo.`);
    }
  }

  console.error(`[ocf] todos os modelos falharam por cota (${maxAttempts} tentativas).`);
  return lastExitCode;
}
