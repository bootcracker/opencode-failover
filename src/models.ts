export interface FailoverModel {
  /** Model ID used in OpenCode model selectors, e.g. "flint-40b-free". */
  id: string;
  /** Human-readable label. */
  label: string;
}

/**
 * Free OpenCode models (cost = $0) in failover priority order.
 * Source: OpenCode catalog (/models, provider "opencode").
 */
export const FREE_MODELS: FailoverModel[] = [
  { id: "flint-40b-free", label: "Flint 40B Free" },
  { id: "deepseek-v4.1-flash-free", label: "DeepSeek V4.1 Flash Free" },
  { id: "minimax-m3.1-flash-free", label: "MiniMax M3.1 Flash Free" },
  { id: "glm-5.3-flash-free", label: "GLM-5.3 Flash Free" },
  { id: "nemotron-3.5-super-vl-free", label: "Nemotron 3.5 Super VL Free" },
  { id: "nemotron-3-ultra-free", label: "Nemotron 3 Ultra Free" },
  { id: "nemotron-3.5-lightning-free", label: "Nemotron 3.5 Lightning Free" },
  { id: "beam-free", label: "Beam Free" },
  { id: "longcat-2.5-free", label: "LongCat 2.5 Free" },
  { id: "hy4-flash-free", label: "Hy4 Flash Free" },
  { id: "mimo-v2.6-flash-free", label: "MiMo-V2.6 Flash Free" },
  { id: "iceman-free", label: "Iceman Free" },
  { id: "inkling-2-small-free", label: "Inkling 2 Small Free" },
  { id: "big-pickle", label: "Big Pickle" },
];

export function getFreeModels(): FailoverModel[] {
  return FREE_MODELS;
}
