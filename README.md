# opencode-failover

Automatic failover proxy between OpenCode free models when quota is exhausted.

## CLI (recommended)

The `opencode-failover-bootcracker` CLI wraps `opencode run` and rotates through the free
models in a circular (round-robin) fashion. The rotation index is persisted, so each invocation
continues from where the last one stopped. If a model runs out of quota, the CLI automatically
advances to the next one.

```sh
npm install
npm run build
npm link   # installs the opencode-failover-bootcracker command globally
```

Commands:

```sh
opencode-failover-bootcracker run "fix the login bug"
opencode-failover-bootcracker run -- --continue --format json
opencode-failover-bootcracker run --start hy4-flash-free "explain this code"
opencode-failover-bootcracker run --dry-run          # show the next model only
opencode-failover-bootcracker models                 # list free models, mark the next one
opencode-failover-bootcracker status                 # show rotation state
opencode-failover-bootcracker reset [--index n]      # reset rotation
opencode-failover-bootcracker config                 # print proxy configuration
opencode-failover-bootcracker serve                  # start the HTTP proxy
```

`run` options: `--start <id>`, `--attempts <n>`, `--dry-run`, `--verbose`, `--` (pass the
remaining arguments straight to `opencode run`).

State is stored at `~/.config/opencode-failover-bootcracker/state.json`. The free models are
available natively as `opencode/<model>`, so no proxy is required for the CLI.

## How it works

- Exposes an OpenAI-compatible API:
  - `GET /health`
  - `GET /v1/models`
  - `POST /v1/chat/completions`
- Keeps an ordered catalog of OpenCode free models (cost = `$0`).
- When a chat completion fails with a **quota error** (HTTP `429`/`402` or quota-ish error body), it marks the model as failed and automatically retries with the next free model.
- Non-quota errors are returned to the client as-is.
- When every model is exhausted, the last quota error is returned.

Context limits are handled by OpenCode itself (automatic compaction before hitting the context window), so the proxy focuses on quota failover.

## Setup

```sh
cd opencode-failover
npm install
cp .env.example .env
# edit .env and set OPENCODE_API_KEY
npm run dev
```

## Configure OpenCode to use the proxy

In `opencode.json(c)`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "model": "opencode-failover/flint-40b-free",
  "providers": {
    "opencode-failover": {
      "name": "OpenCode Failover",
      "package": "@opencode/ai/providers/openai-compatible",
      "options": {
        "apiKey": "{env:OPENCODE_API_KEY}",
        "baseURL": "http://127.0.0.1:8787/v1"
      },
      "models": {
        "flint-40b-free": { "modelID": "flint-40b-free", "name": "Flint 40B Free" },
        "deepseek-v4.1-flash-free": { "modelID": "deepseek-v4.1-flash-free", "name": "DeepSeek V4.1 Flash Free" },
        "minimax-m3.1-flash-free": { "modelID": "minimax-m3.1-flash-free", "name": "MiniMax M3.1 Flash Free" },
        "glm-5.3-flash-free": { "modelID": "glm-5.3-flash-free", "name": "GLM-5.3 Flash Free" },
        "nemotron-3.5-super-vl-free": { "modelID": "nemotron-3.5-super-vl-free", "name": "Nemotron 3.5 Super VL Free" },
        "nemotron-3-ultra-free": { "modelID": "nemotron-3-ultra-free", "name": "Nemotron 3 Ultra Free" },
        "nemotron-3.5-lightning-free": { "modelID": "nemotron-3.5-lightning-free", "name": "Nemotron 3.5 Lightning Free" },
        "beam-free": { "modelID": "beam-free", "name": "Beam Free" },
        "longcat-2.5-free": { "modelID": "longcat-2.5-free", "name": "LongCat 2.5 Free" },
        "hy4-flash-free": { "modelID": "hy4-flash-free", "name": "Hy4 Flash Free" },
        "mimo-v2.6-flash-free": { "modelID": "mimo-v2.6-flash-free", "name": "MiMo-V2.6 Flash Free" },
        "iceman-free": { "modelID": "iceman-free", "name": "Iceman Free" },
        "inkling-2-small-free": { "modelID": "inkling-2-small-free", "name": "Inkling 2 Small Free" },
        "big-pickle": { "modelID": "big-pickle", "name": "Big Pickle" }
      }
    }
  }
}
```

## Environment variables

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `8787` | Port the proxy listens on |
| `HOST` | `0.0.0.0` | Host the proxy listens on |
| `OPENCODE_API_KEY` | - | OpenCode Console API key (required) |
| `OPENCODE_BASE_URL` | `https://opencode.ai/inference/openai/v1` | OpenCode inference base URL |
| `FAILOVER_MAX_ATTEMPTS` | `14` | Max models to try before giving up |

## Test

```sh
curl http://127.0.0.1:8787/health

curl http://127.0.0.1:8787/v1/models

curl http://127.0.0.1:8787/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{
    "model": "flint-40b-free",
    "messages": [{ "role": "user", "content": "Say hello in one word" }]
  }'
```

## Behavior notes

- Quota errors (`429`, `402`, or quota-like error bodies) trigger failover to the next model in the catalog order.
- If the requested model is not in the free catalog, the proxy answers `400` with the list of available models.
- Non-quota upstream errors are forwarded unchanged.
