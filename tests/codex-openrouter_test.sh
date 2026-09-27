#!/usr/bin/env bash
# 不访问真实密钥。doctor 的 401 用例会打一次 OpenRouter。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT="$ROOT/codex-openrouter.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

export HOME="$TMP/home"
export CODEX_HOME="$HOME/.codex"
export SHELL="/bin/bash"
mkdir -p "$HOME"
unset OPENROUTER_API_KEY

KEY="sk-or-test-secret-value"
chmod +x "$SCRIPT"

assert_toml() {
  python3 - "$1" "$2" "$3" <<'PY'
import sys, tomllib
from pathlib import Path
path, expected_auth, expect_profiles = sys.argv[1], sys.argv[2], sys.argv[3] == "yes"
with open(path, "rb") as handle:
    data = tomllib.load(handle)
assert data["model_provider"] == "openrouter"
assert data["model"]
assert data["model_reasoning_effort"] in {"low", "medium", "high", "xhigh", "max"}
provider = data["model_providers"]["openrouter"]
assert provider["base_url"] == "https://openrouter.ai/api/v1"
assert provider["wire_api"] == "responses"
if expected_auth == "command":
    assert "env_key" not in provider
    auth = provider["auth"]
    assert auth["command"] == "sh"
    assert auth["args"][0] == "-c"
else:
    assert provider["env_key"] == "OPENROUTER_API_KEY"
    assert "auth" not in provider
profiles = data.get("profiles") or {}
if expect_profiles:
    assert set(profiles) >= {"or-sol", "or-luna", "or-terra", "or-sonnet"}
    assert profiles["or-sonnet"]["model"] == "anthropic/claude-sonnet-4.6"
else:
    assert "or-sol" not in profiles
print("toml ok", path)
PY
}

run_auth_command() {
  python3 - "$1" "$2" <<'PY'
import subprocess, sys, tomllib
config_path, expected = sys.argv[1], sys.argv[2]
with open(config_path, "rb") as handle:
    data = tomllib.load(handle)
auth = data["model_providers"]["openrouter"]["auth"]
result = subprocess.run(
    [auth["command"], *auth["args"]],
    check=True,
    capture_output=True,
    text=True,
)
assert result.stdout == expected, repr(result.stdout)
print("auth command ok")
PY
}

echo "1. dry-run 不写文件"
out="$("$SCRIPT" setup --dry-run --model openai/gpt-5.6-luna --effort medium)"
[[ "$out" == *'model = "openai/gpt-5.6-luna"'* ]]
[[ "$out" == *'model_reasoning_effort = "medium"'* ]]
[[ ! -e "$CODEX_HOME/config.toml" ]]

echo "2. 首次 setup，并执行 auth 命令"
"$SCRIPT" setup --key "$KEY" --model openai/gpt-5.6-sol --effort high
assert_toml "$CODEX_HOME/config.toml" command yes
run_auth_command "$CODEX_HOME/config.toml" "$KEY"
mode="$(stat -c %a "$CODEX_HOME/openrouter_api_key")"
[[ "$mode" == "600" ]]

echo "3. 保留原有配置，重复执行结果不变"
python3 - "$CODEX_HOME/config.toml" <<'PY'
import sys
from pathlib import Path
p = Path(sys.argv[1])
original = p.read_text()
needle = 'model_reasoning_effort = "high"\n'
insert = needle + """
personality = "pragmatic"

[projects."/tmp/demo"]
trust_level = "trusted"

[model_providers.local]
name = "local"
base_url = "http://127.0.0.1:11434"
"""
if needle not in original:
    raise SystemExit("missing managed root")
p.write_text(original.replace(needle, insert, 1))
PY
"$SCRIPT" setup --key "$KEY" --model openai/gpt-5.6-terra --effort low
python3 - <<PY
import tomllib
from pathlib import Path
data = tomllib.load(open("$CODEX_HOME/config.toml", "rb"))
assert data["personality"] == "pragmatic", data
assert data["projects"]["/tmp/demo"]["trust_level"] == "trusted"
assert data["model_providers"]["local"]["base_url"] == "http://127.0.0.1:11434"
assert data["model"] == "openai/gpt-5.6-terra"
assert data["model_reasoning_effort"] == "low"
print("preserved ok")
PY
cp "$CODEX_HOME/config.toml" "$TMP/once.toml"
"$SCRIPT" setup --key "$KEY" --model openai/gpt-5.6-terra --effort low
cmp "$CODEX_HOME/config.toml" "$TMP/once.toml"

echo "4. 路径含空格时 auth 命令仍返回密钥"
export CODEX_HOME="$TMP/home/codex dir"
"$SCRIPT" setup --key "$KEY" --no-profiles
run_auth_command "$CODEX_HOME/config.toml" "$KEY"
assert_toml "$CODEX_HOME/config.toml" command no

echo "5. env 认证，以及切回 command"
"$SCRIPT" setup --key "$KEY" --auth env --no-profiles
assert_toml "$CODEX_HOME/config.toml" env no
"$SCRIPT" setup --key "$KEY" --auth command --with-profiles
assert_toml "$CODEX_HOME/config.toml" command yes

echo "6. 拒绝坏参数，且不把密钥写进错误信息"
set +e
bad="$("$SCRIPT" setup --effort huge --key "$KEY" 2>&1)"
status=$?
set -e
[[ "$status" -ne 0 ]]
[[ "$bad" != *"$KEY"* ]]

echo "7. --persist-shell 写入 bashrc，且不含明文密钥"
export CODEX_HOME="$HOME/.codex"
"$SCRIPT" setup --key "$KEY" --persist-shell --no-profiles
[[ -f "$HOME/.bashrc" ]]
grep -q "BEGIN codex-openrouter" "$HOME/.bashrc"
# shellcheck disable=SC1091
source "$HOME/.bashrc"
[[ "$OPENROUTER_API_KEY" == "$KEY" ]]
grep -q "$KEY" "$HOME/.bashrc" && { echo "密钥被写进了 bashrc"; exit 1; }
unset OPENROUTER_API_KEY

echo "8. doctor 对无效密钥失败，且输出不含密钥"
set +e
doc="$("$SCRIPT" doctor 2>&1)"
status=$?
set -e
[[ "$status" -ne 0 ]]
[[ "$doc" == *"OpenRouter"* ]]
[[ "$doc" != *"$KEY"* ]]

echo "9. 缺少斜杠的模型只提示，不失败"
err="$("$SCRIPT" setup --dry-run --model gpt-5.6-sol 2>&1 >/dev/null)"
[[ "$err" == *"提供商前缀"* ]]

echo "全部通过"
