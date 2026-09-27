# Codex 接入 OpenRouter

`codex-openrouter.sh` 会把 OpenAI Codex CLI 指到 [OpenRouter](https://openrouter.ai/docs/cookbook/coding-agents/codex-cli)。配置写在用户级 `~/.codex/config.toml`（可用 `CODEX_HOME` 改目录）。Codex 不读取项目里的 `.codex/config.toml` 中的 `model_provider`。

## 用法

```bash
export OPENROUTER_API_KEY="sk-or-..."
./codex-openrouter.sh setup
./codex-openrouter.sh doctor
./codex-openrouter.sh run
```

密钥保存在 `~/.codex/openrouter_api_key`，文件权限是 `600`。默认认证是一条 `sh` 命令去读这个文件，这样 Codex 会拉取 OpenRouter 的模型目录。默认模型是 `openai/gpt-5.6-sol`。

换模型或推理力度：

```bash
./codex-openrouter.sh setup --model openai/gpt-5.6-luna --effort medium
codex --profile or-luna
```

自带四个配置档：`or-sol`、`or-luna`、`or-terra`、`or-sonnet`。

如果 Codex 在启动时拉模型目录失败，可以改用环境变量认证（非 OpenAI 模型会缺少目录元数据）：

```bash
./codex-openrouter.sh setup --auth env --persist-shell
```

`wire_api` 固定为 `responses`。Codex 已经不再接受 `chat`。
