import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export interface CliState {
  /** Índice do próximo modelo a ser usado na rotação circular. */
  index: number;
  /** Último modelo efetivamente tentado. */
  lastModel?: string;
  /** Data/hora da última tentativa. */
  lastRunAt?: string;
  /** Total de tentativas realizadas. */
  totalRuns: number;
  updatedAt: string;
}

export const STATE_DIR = join(homedir(), ".config", "opencode-failover-bootcracker");
export const STATE_FILE = join(STATE_DIR, "state.json");

function emptyState(): CliState {
  return { index: 0, totalRuns: 0, updatedAt: new Date().toISOString() };
}

export async function loadState(): Promise<CliState> {
  try {
    const raw = await readFile(STATE_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<CliState>;
    return {
      index: Number.isInteger(parsed.index) && parsed.index! >= 0 ? parsed.index! : 0,
      lastModel: typeof parsed.lastModel === "string" ? parsed.lastModel : undefined,
      lastRunAt: typeof parsed.lastRunAt === "string" ? parsed.lastRunAt : undefined,
      totalRuns: Number.isInteger(parsed.totalRuns) && parsed.totalRuns! >= 0 ? parsed.totalRuns! : 0,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
    };
  } catch {
    return emptyState();
  }
}

export async function saveState(state: CliState): Promise<void> {
  await mkdir(STATE_DIR, { recursive: true });
  await writeFile(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}
