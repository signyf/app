#!/usr/bin/env bash
# 把 OpenAI Codex CLI 接到 OpenRouter。
# 配置写在用户级 $CODEX_HOME/config.toml（默认 ~/.codex/config.toml）。
# Codex 会忽略项目目录里的 .codex/config.toml 中的 model_provider。
set -euo pipefail

CODEX_DIR="${CODEX_HOME:-$HOME/.codex}"
KEY_FILE="${CODEX_OR_KEY_FILE:-$CODEX_DIR/openrouter_api_key}"
CONFIG_FILE="$CODEX_DIR/config.toml"

DEFAULT_MODEL="openai/gpt-5.6-sol"
DEFAULT_EFFORT="high"
DEFAULT_AUTH="command"

usage() {
  cat <<'EOF'
用法: codex-openrouter.sh <setup|run|doctor> [选项]

把 OpenAI Codex CLI 接到 OpenRouter Responses API。

子命令:
  setup     写入用户级 ~/.codex/config.toml，并保存 API 密钥
  run       读取已保存的密钥后启动 codex，参数原样传给 codex
  doctor    检查配置，并向 OpenRouter 验证密钥

setup 选项:
  --key KEY             OpenRouter 密钥（会出现在进程列表里，尽量别用）
  --key-file PATH       从文件读取密钥；PATH 为 - 时从标准输入读取
  --model SLUG          模型，默认 openai/gpt-5.6-sol
  --effort LEVEL        推理力度: low medium high xhigh max，默认 high
  --auth MODE           command（默认）或 env
                        command 会拉取 OpenRouter 模型目录，非 OpenAI 模型才有正确元数据
                        env 使用 env_key，不拉模型目录；若 command 模式启动失败可改用它
  --with-profiles       写入 or-sol / or-luna / or-terra / or-sonnet 配置档（默认开启）
  --no-profiles         不写上述配置档，并删掉本脚本以前写过的同名配置档
  --persist-shell       在当前 shell 的 rc 文件里 source 密钥
  --config PATH         指定 config.toml 路径，默认 $CODEX_HOME/config.toml
  --dry-run             只把将要写入的 config.toml 打到标准输出

环境变量:
  OPENROUTER_API_KEY    未通过 --key / --key-file 传入时使用
  CODEX_HOME            Codex 配置目录，默认 ~/.codex

示例:
  export OPENROUTER_API_KEY="sk-or-..."
  ./codex-openrouter.sh setup
  ./codex-openrouter.sh doctor
  ./codex-openrouter.sh run
  codex --profile or-luna
EOF
}

die() {
  printf '错误: %s\n' "$1" >&2
  exit 1
}

need_python() {
  command -v python3 >/dev/null 2>&1 || die "需要 python3"
}

validate_effort() {
  case "$1" in
    low|medium|high|xhigh|max) ;;
    *) die "不支持的推理力度: $1（可用 low medium high xhigh max）" ;;
  esac
}

validate_auth() {
  case "$1" in
    command|env) ;;
    *) die "不支持的认证方式: $1（可用 command 或 env）" ;;
  esac
}

validate_model() {
  local model="$1"
  [[ -n "$model" ]] || die "模型 slug 不能为空"
  [[ "$model" != *$'\n'* && "$model" != *" "* ]] || die "模型 slug 不能包含空格或换行"
  if [[ "$model" != */* ]]; then
    printf '提示: 模型 slug 通常要带提供商前缀，例如 openai/gpt-5.6-sol\n' >&2
  fi
}

read_key_from_file() {
  local path="$1"
  local key
  if [[ "$path" == "-" ]]; then
    key="$(tr -d '\r' <&0 || true)"
  else
    [[ -f "$path" ]] || die "找不到密钥文件: $path"
    key="$(tr -d '\r' <"$path")"
  fi
  # 去掉首尾空白，保留中间内容交给后续校验。
  python3 -c 'import sys; print(sys.stdin.read().strip())' <<<"$key"
}

load_saved_key() {
  [[ -f "$KEY_FILE" ]] || return 1
  python3 -c 'import pathlib,sys; print(pathlib.Path(sys.argv[1]).read_text().strip())' "$KEY_FILE"
}

validate_key() {
  local key="$1"
  [[ -n "$key" ]] || die "API 密钥为空"
  [[ "$key" != *$'\n'* && "$key" != *$'\r'* ]] || die "API 密钥不能包含换行"
  [[ ! "$key" =~ [[:space:]] ]] || die "API 密钥不能包含空白字符"
  if [[ "$key" != sk-or-* ]]; then
    printf '提示: OpenRouter 密钥一般以 sk-or- 开头，请确认没有把别的密钥写进来\n' >&2
  fi
}

write_key_file() {
  local key="$1"
  mkdir -p "$CODEX_DIR"
  umask 077
  printf '%s\n' "$key" >"$KEY_FILE"
  chmod 600 "$KEY_FILE"
}

persist_shell() {
  local shell_name rc begin end tmp block
  shell_name="$(basename "${SHELL:-bash}")"
  case "$shell_name" in
    zsh) rc="$HOME/.zshrc" ;;
    fish)
      printf '提示: fish 不会自动写入配置。请手动执行:\n  set -x OPENROUTER_API_KEY (tr -d "\\n" < %q)\n' "$KEY_FILE" >&2
      return 0
      ;;
    *) rc="$HOME/.bashrc" ;;
  esac
  begin="# BEGIN codex-openrouter"
  end="# END codex-openrouter"
  block="$begin
export OPENROUTER_API_KEY=\$(tr -d '\\n' < $(printf '%q' "$KEY_FILE"))
$end"
  mkdir -p "$(dirname "$rc")"
  touch "$rc"
  tmp="$(mktemp)"
  python3 - "$rc" "$tmp" "$begin" "$end" "$block" <<'PY'
import pathlib, sys
rc, tmp, begin, end, block = sys.argv[1:]
text = pathlib.Path(rc).read_text()
lines = text.splitlines(keepends=True)
out = []
i = 0
while i < len(lines):
    if lines[i].strip() == begin:
        i += 1
        while i < len(lines) and lines[i].strip() != end:
            i += 1
        if i < len(lines):
            i += 1
        continue
    out.append(lines[i])
    i += 1
if out and not out[-1].endswith("\n"):
    out[-1] += "\n"
if out and out[-1].strip() != "":
    out.append("\n")
out.append(block + "\n")
pathlib.Path(tmp).write_text("".join(out))
PY
  mv "$tmp" "$rc"
  printf '已写入 shell 配置: %s\n' "$rc"
}

render_config() {
  local model="$1" effort="$2" auth="$3" profiles="$4"
  CODEX_OR_CONFIG="$CONFIG_FILE" \
  CODEX_OR_MODEL="$model" \
  CODEX_OR_EFFORT="$effort" \
  CODEX_OR_AUTH="$auth" \
  CODEX_OR_PROFILES="$profiles" \
  CODEX_OR_KEY_FILE="$KEY_FILE" \
  python3 - <<'PY'
import os
import re
import shlex
from pathlib import Path

config_path = Path(os.environ["CODEX_OR_CONFIG"])
model = os.environ["CODEX_OR_MODEL"]
effort = os.environ["CODEX_OR_EFFORT"]
auth = os.environ["CODEX_OR_AUTH"]
with_profiles = os.environ["CODEX_OR_PROFILES"] == "1"
key_file = os.environ["CODEX_OR_KEY_FILE"]

MANAGED_ROOT = ("model", "model_provider", "model_reasoning_effort")
MANAGED_COMMENT = "# codex-openrouter: managed provider settings"
PROFILE_TABLES = (
    "profiles.or-sol",
    "profiles.or-luna",
    "profiles.or-terra",
    "profiles.or-sonnet",
)
PROVIDER_TABLES = (
    "model_providers.openrouter",
    "model_providers.openrouter.auth",
)
MANAGED_TABLES = set(PROVIDER_TABLES) | set(PROFILE_TABLES)
HEADER_RE = re.compile(r"^\s*\[\[?[^\]]+\]\]?\s*(?:#.*)?$")
ROOT_KEY_RE = re.compile(
    r"^\s*(?:model|model_provider|model_reasoning_effort)\s*="
)


def table_name(line: str) -> str:
    match = re.match(r"^\s*\[\[?([^\]]+)\]\]?\s*(?:#.*)?$", line)
    if not match:
        raise ValueError(f"无法解析表头: {line!r}")
    return match.group(1).strip()


def toml_basic(value: str) -> str:
    escaped = value.replace("\\", "\\\\").replace('"', '\\"')
    return f'"{escaped}"'


def split_document(text: str) -> tuple[list[str], list[tuple[str, list[str]]]]:
    lines = text.splitlines(keepends=True)
    preamble: list[str] = []
    tables: list[tuple[str, list[str]]] = []
    current_name = None
    current: list[str] = []
    seen_table = False
    for line in lines:
        if HEADER_RE.match(line):
            if seen_table:
                tables.append((current_name, current))
            seen_table = True
            current_name = table_name(line)
            current = [line]
            continue
        if seen_table:
            current.append(line)
        else:
            preamble.append(line)
    if seen_table:
        tables.append((current_name, current))
    return preamble, tables


def clean_preamble(lines: list[str]) -> list[str]:
    kept = []
    for line in lines:
        stripped = line.strip()
        if stripped == MANAGED_COMMENT:
            continue
        if ROOT_KEY_RE.match(line):
            continue
        kept.append(line)
    while kept and kept[0].strip() == "":
        kept.pop(0)
    return kept


def render_provider() -> str:
    # tr 自己把 \n 解释成换行；shell 单引号会把这两个字符原样传给 tr。
    snippet = "tr -d '\\n' < " + shlex.quote(key_file)
    lines = [
        "[model_providers.openrouter]",
        'name = "OpenRouter"',
        'base_url = "https://openrouter.ai/api/v1"',
        'wire_api = "responses"',
    ]
    if auth == "env":
        lines.append('env_key = "OPENROUTER_API_KEY"')
        return "\n".join(lines) + "\n"
    lines.extend(
        [
            "",
            "[model_providers.openrouter.auth]",
            'command = "sh"',
            "args = [" + ", ".join(toml_basic(part) for part in ("-c", snippet)) + "]",
        ]
    )
    return "\n".join(lines) + "\n"


def render_profiles() -> str:
    profiles = [
        ("or-sol", "openai/gpt-5.6-sol"),
        ("or-luna", "openai/gpt-5.6-luna"),
        ("or-terra", "openai/gpt-5.6-terra"),
        ("or-sonnet", "anthropic/claude-sonnet-4.6"),
    ]
    chunks = []
    for name, slug in profiles:
        chunks.append(
            "\n".join(
                [
                    f"[profiles.{name}]",
                    'model_provider = "openrouter"',
                    f"model = {toml_basic(slug)}",
                ]
            )
        )
    return "\n\n".join(chunks) + "\n"


def main() -> None:
    original = config_path.read_text() if config_path.exists() else ""
    preamble, tables = split_document(original)
    preamble = clean_preamble(preamble)
    kept_tables = [(name, body) for name, body in tables if name not in MANAGED_TABLES]

    root = [
        MANAGED_COMMENT + "\n",
        f"model = {toml_basic(model)}\n",
        'model_provider = "openrouter"\n',
        f"model_reasoning_effort = {toml_basic(effort)}\n",
    ]
    if preamble:
        if not root[-1].endswith("\n"):
            root[-1] += "\n"
        if preamble[0].strip() != "":
            root.append("\n")
        root.extend(preamble)
        if not root[-1].endswith("\n"):
            root[-1] += "\n"

    body = "".join(root).rstrip() + "\n\n"
    for _, table_lines in kept_tables:
        chunk = "".join(table_lines).strip("\n")
        body += chunk + "\n\n"
    body += render_provider().rstrip() + "\n"
    if with_profiles:
        body += "\n" + render_profiles().rstrip() + "\n"
    print(body, end="")


if __name__ == "__main__":
    main()
PY
}

install_config() {
  local rendered="$1"
  mkdir -p "$(dirname "$CONFIG_FILE")"
  if [[ -f "$CONFIG_FILE" ]] && ! cmp -s "$CONFIG_FILE" <(printf '%s\n' "$rendered"); then
    cp -p "$CONFIG_FILE" "$CONFIG_FILE.bak"
  fi
  printf '%s\n' "$rendered" >"$CONFIG_FILE"
}

cmd_setup() {
  local model="$DEFAULT_MODEL"
  local effort="$DEFAULT_EFFORT"
  local auth="$DEFAULT_AUTH"
  local profiles=1
  local persist=0
  local dry=0
  local key="${OPENROUTER_API_KEY:-}"
  local key_from_flag=0
  local saved=""

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --key)
        [[ $# -ge 2 ]] || die "--key 需要一个值"
        key="$2"
        key_from_flag=1
        shift 2
        ;;
      --key-file)
        [[ $# -ge 2 ]] || die "--key-file 需要一个路径"
        key="$(read_key_from_file "$2")"
        key_from_flag=1
        shift 2
        ;;
      --model)
        [[ $# -ge 2 ]] || die "--model 需要一个 slug"
        model="$2"
        shift 2
        ;;
      --effort)
        [[ $# -ge 2 ]] || die "--effort 需要一个值"
        effort="$2"
        shift 2
        ;;
      --auth)
        [[ $# -ge 2 ]] || die "--auth 需要一个值"
        auth="$2"
        shift 2
        ;;
      --with-profiles)
        profiles=1
        shift
        ;;
      --no-profiles)
        profiles=0
        shift
        ;;
      --persist-shell)
        persist=1
        shift
        ;;
      --config)
        [[ $# -ge 2 ]] || die "--config 需要一个路径"
        CONFIG_FILE="$2"
        shift 2
        ;;
      --dry-run)
        dry=1
        shift
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        die "未知参数: $1（用 --help 查看用法）"
        ;;
    esac
  done

  validate_effort "$effort"
  validate_auth "$auth"
  validate_model "$model"
  need_python

  if [[ "$CONFIG_FILE" != "$CODEX_DIR/config.toml" ]]; then
    printf '提示: Codex 只在用户级配置（%s）里识别 model_provider。\n' "$CODEX_DIR/config.toml" >&2
  fi

  local rendered
  rendered="$(render_config "$model" "$effort" "$auth" "$profiles")"

  if [[ "$dry" -eq 1 ]]; then
    printf '%s\n' "$rendered"
    exit 0
  fi

  if [[ "$key_from_flag" -eq 0 && -z "$key" ]]; then
    if saved="$(load_saved_key 2>/dev/null)"; then
      key="$saved"
    fi
  fi
  if [[ -z "$key" && -t 0 ]]; then
    local input
    read -r -s -p "OpenRouter API Key: " input
    printf '\n'
    key="$input"
  fi
  if [[ -z "$key" ]]; then
    die "缺少 OpenRouter API 密钥。请设置 OPENROUTER_API_KEY，或使用 --key / --key-file"
  fi
  validate_key "$key"
  write_key_file "$key"
  install_config "$rendered"
  if [[ "$persist" -eq 1 ]]; then
    persist_shell
  fi

  printf '已写入 %s\n' "$CONFIG_FILE"
  printf '密钥文件 %s（权限 600）\n' "$KEY_FILE"
  printf '默认模型 %s，认证方式 %s\n' "$model" "$auth"
  if [[ "$auth" == "env" ]]; then
    printf 'env 模式需要进程环境里有 OPENROUTER_API_KEY。可以执行:\n  %s run\n或重新 setup 时加上 --persist-shell\n' "$0"
  else
    printf '可以直接运行 codex。本脚本的 run 子命令也会带上密钥。\n'
  fi
  if [[ "$profiles" -eq 1 ]]; then
    printf '配置档: codex --profile or-sol|or-luna|or-terra|or-sonnet\n'
  fi
}

cmd_run() {
  need_python
  local key="${OPENROUTER_API_KEY:-}"
  if [[ -z "$key" ]]; then
    key="$(load_saved_key)" || die "找不到密钥。请先运行 setup，或设置 OPENROUTER_API_KEY"
  fi
  validate_key "$key"
  command -v codex >/dev/null 2>&1 || die "未安装 codex。可以执行: npm install -g @openai/codex"
  export OPENROUTER_API_KEY="$key"
  exec codex "$@"
}

cmd_doctor() {
  need_python
  local key="${OPENROUTER_API_KEY:-}"
  if [[ -z "$key" ]]; then
    if [[ -f "$KEY_FILE" ]]; then
      key="$(load_saved_key)"
    fi
  fi
  CODEX_OR_CONFIG="$CONFIG_FILE" \
  CODEX_OR_KEY_FILE="$KEY_FILE" \
  CODEX_OR_KEY="${key:-}" \
  python3 - <<'PY'
import json
import os
import stat
import sys
import urllib.error
import urllib.request

config_path = os.environ["CODEX_OR_CONFIG"]
key_file = os.environ["CODEX_OR_KEY_FILE"]
key = os.environ.get("CODEX_OR_KEY", "")
errors = 0


def fail(message: str) -> None:
    global errors
    errors += 1
    print(f"失败: {message}", file=sys.stderr)


try:
    import tomllib
except ModuleNotFoundError:
    fail("需要 Python 3.11+ 的 tomllib")
    sys.exit(1)

print(f"配置文件: {config_path}")
if not os.path.isfile(config_path):
    fail("还没有 config.toml，请先运行 setup")
    sys.exit(1)

with open(config_path, "rb") as handle:
    try:
        config = tomllib.load(handle)
    except tomllib.TOMLDecodeError as exc:
        fail(f"config.toml 无法解析: {exc}")
        sys.exit(1)

if config.get("model_provider") != "openrouter":
    fail(f"model_provider 不是 openrouter，当前是 {config.get('model_provider')!r}")
else:
    print(f"模型: {config.get('model')}")

providers = config.get("model_providers") or {}
provider = providers.get("openrouter") or {}
if provider.get("base_url") != "https://openrouter.ai/api/v1":
    fail(f"base_url 不正确: {provider.get('base_url')!r}")
wire = provider.get("wire_api", "responses")
if wire != "responses":
    fail(f"wire_api 必须是 responses，当前是 {wire!r}")
else:
    print("wire_api: responses")

if provider.get("env_key"):
    print("认证: env_key（不会拉取 OpenRouter 模型目录）")
elif isinstance(provider.get("auth"), dict):
    print("认证: command（会拉取 OpenRouter 模型目录）")
else:
    fail("openrouter 提供商没有 auth 命令，也没有 env_key")

if not key:
    fail("没有密钥。请设置 OPENROUTER_API_KEY 或先运行 setup")
    sys.exit(1)

if os.path.isfile(key_file):
    mode = stat.S_IMODE(os.stat(key_file).st_mode)
    if mode != 0o600:
        fail(f"密钥文件权限是 {mode:o}，应为 600")
    else:
        print(f"密钥文件权限: 600 ({key_file})")

request = urllib.request.Request(
    "https://openrouter.ai/api/v1/key",
    headers={
        "Authorization": f"Bearer {key}",
        "Accept": "application/json",
    },
)
try:
    with urllib.request.urlopen(request, timeout=20) as response:
        payload = json.load(response)
except urllib.error.HTTPError as exc:
    detail = exc.read().decode("utf-8", errors="replace")[:300]
    detail = detail.replace(key, "***")
    fail(f"OpenRouter 拒绝了密钥，HTTP {exc.code}: {detail}")
    sys.exit(1)
except Exception as exc:  # noqa: BLE001 — 网络错误直接报告给用户
    fail(f"无法连接 OpenRouter: {exc}")
    sys.exit(1)

data = payload.get("data") or {}
label = data.get("label") or "(无标签)"
limit = data.get("limit")
usage = data.get("usage")
print(f"密钥可用: {label}")
if limit is not None or usage is not None:
    print(f"额度: usage={usage} limit={limit}")
if errors:
    sys.exit(1)
PY
}

main() {
  local cmd="${1:-}"
  if [[ -z "$cmd" || "$cmd" == "-h" || "$cmd" == "--help" || "$cmd" == "help" ]]; then
    usage
    [[ -n "$cmd" ]] || exit 1
    exit 0
  fi
  shift
  case "$cmd" in
    setup) cmd_setup "$@" ;;
    run) cmd_run "$@" ;;
    doctor) cmd_doctor "$@" ;;
    *)
      die "未知子命令: $cmd（用 --help 查看用法）"
      ;;
  esac
}

main "$@"
