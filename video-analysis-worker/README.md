# Video Analysis Adapter for Cloudflare Workers

这是 MoonTVPlus 官方站解析适配器的 Cloudflare Worker 版，和 MoonTVPlus 本体放在同一个 fork 里，但使用独立的部署 workflow。

## 自动部署规则

- MoonTVPlus 本体：仍使用 `.github/workflows/cloudflare-deploy.yml`。
- 解析适配器：使用 `.github/workflows/video-analysis-cloudflare-deploy.yml`。
- 上游 MoonTVPlus 更新只会触发 MoonTVPlus 本体部署，不会触发解析适配器部署。
- 只有 `video-analysis-worker/**` 或适配器 workflow 变更时，才会部署解析适配器。

## GitHub Secrets

复用 MoonTVPlus 本体的 Cloudflare 凭据：

```text
CLOUDFLARE_API_TOKEN
CLOUDFLARE_ACCOUNT_ID
```

解析适配器可选配置：

```text
VIDEO_ANALYSIS_WORKER_NAME=video-analysis-adapter
VIDEO_ANALYSIS_PUBLIC_BASE_URL=https://你的适配器域名
VIDEO_ANALYSIS_PARSER_API=https://json.jlvungo.cn/api.php/
VIDEO_ANALYSIS_JLVUNGO_API_KEY=你的解析Key
VIDEO_ANALYSIS_PARSER_CANDIDATES=https://api1.example.com/api.php/|key1|备用1\nhttps://api2.example.com/api.php/||无Key备用
VIDEO_ANALYSIS_PLAY_MODE=direct
VIDEO_ANALYSIS_CACHE_TTL_MINUTES=30
VIDEO_ANALYSIS_BILI_COOKIE=你的B站Cookie
VIDEO_ANALYSIS_ENABLED_PLATFORMS=mgtv,qq,iqiyi,youku,bili
VIDEO_ANALYSIS_INCLUDE_AGGREGATE_SOURCE=false
```

`VIDEO_ANALYSIS_PARSER_CANDIDATES` 用 `\n` 分隔多行。没有 key 的接口格式是：

```text
https://example.com/api.php/||名称
```

## MoonTVPlus 导入地址

适配器部署完成后，把下面地址填到 MoonTVPlus 的配置订阅：

```text
https://你的适配器域名/subscription.json
```

可读的原始配置地址：

```text
https://你的适配器域名/subscription.raw.json
```

## 手动部署

在 GitHub Actions 页面手动运行 `Deploy Video Analysis Adapter to Cloudflare`。

本地调试需要安装 Wrangler：

```sh
npx wrangler dev --config video-analysis-worker/wrangler.toml
```
