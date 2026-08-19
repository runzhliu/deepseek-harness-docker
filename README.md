# DeepSeek Harness Docker

[English](README.en.md) | 简体中文

[![DeepSeek Harness](https://img.shields.io/badge/DeepSeek_Harness-0.1.0--rc.6-4f46e5)](https://www.npmjs.com/package/@deepseek-ai/dsh)
[![Docker Image](https://img.shields.io/badge/docker.io-runzhliu%2Fdeepseek--harness-2496ED?logo=docker&logoColor=white)](https://hub.docker.com/r/runzhliu/deepseek-harness)
[![Node.js](https://img.shields.io/badge/Node.js-24-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

这是一个可直接构建的 DeepSeek Harness 社区容器方案，默认运行官方 `@deepseek-ai/dsh` 的 Web UI。它不构建或修改 DeepSeek Harness 源码，只把官方 npm 发行物装入一个精简、非 root 的 Node.js 24 运行时。

> 当前基线：`@deepseek-ai/dsh@0.1.0-rc.6`。DeepSeek Harness 仍处于 RC 阶段；升级前应重新完成本文的构建和 Smoke Test。

`0.1.0-rc.6` 直接对应构建时官方 npm Registry 的 `@deepseek-ai/dsh` 最新发行物，并非本项目自定义版本。上游公开 `master` 当时仍标记 `rc.5`；本项目封装 npm 成品而不从源码构建，因此以可安装的官方发行物为基线，并故意不发布漂移的 Docker `latest` 标签。

📖 延伸阅读：[DeepSeek Harness GitHub 仓库深度解析](https://aik8s.run/ai-k8s/rag-agent/deepseek-harness-repository-analysis/) · [Docker、Compose 与 Helm 部署实战](https://aik8s.run/ai-k8s/rag-agent/deepseek-harness-runtime-containerization/)

![DeepSeek Harness Web UI running from this image](assets/deepseek-harness-web.png)

## 项目状态

| 能力 | 状态 | 验证结果 |
| --- | --- | --- |
| Dockerfile | 可用 | `linux/arm64`、`linux/amd64` 构建与原生 PTY 实际启动均已验证 |
| Docker Compose | 可用 | Web 200、healthy、回环端口、重启持久化已验证 |
| Helm | 可用 | 单副本 StatefulSet、PVC、Headless Service、NetworkPolicy；`helm lint --strict` 通过 |
| Web UI | 本机单用户 | 无认证；禁止直接暴露到局域网或公网 |
| Headless | 可用 | 运行时注入 provider Secret；需在目标环境验证实际模型调用和沙箱 |

## DeepSeek Harness 深入分析

本节是配套技术文章的精简版。Cordis 架构、Agent 轮次和事件溯源持久化见 [GitHub 仓库深度解析](https://aik8s.run/ai-k8s/rag-agent/deepseek-harness-repository-analysis/)；镜像设计、安全模型和容器验证矩阵见 [Docker、Compose 与 Helm 部署实战](https://aik8s.run/ai-k8s/rag-agent/deepseek-harness-runtime-containerization/)。

### 它是什么，不是什么

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 不是 DeepSeek 模型权重或推理引擎，而是一套 TypeScript AI Agent Runtime。它把模型适配、会话、工具、权限、工作区、插件、Web UI 与 Headless 入口装配在一起，最终发布为 [`@deepseek-ai/dsh`](https://www.npmjs.com/package/@deepseek-ai/dsh) CLI。更合适的专题归类是“AI Agent Runtime 的云原生化”，而不是“LLM 推理部署”。

截至 2026-08-13，上游仓库还没有 Dockerfile、Compose 或 Kubernetes 清单；同时 [`CONTRIBUTING.md`](https://github.com/deepseek-ai/deepseek-harness/blob/master/CONTRIBUTING.md) 明确表示暂不接受外部 Pull Request，并鼓励社区创建生态项目和教程。因此本项目采用独立社区实现，而不冒充官方镜像。

### 运行时分层

```mermaid
flowchart TB
  CLI["dsh CLI"] --> PROFILE["Profile + Bundle + --patch layers"]
  PROFILE --> CORDIS["Cordis plugin graph"]
  CORDIS --> CORE["Agent / Session / Model / Tool / Sandbox"]
  CORDIS --> WEB["Web surface :3080"]
  CORDIS --> HEADLESS["Headless surface"]
  CORE --> WORKSPACE["/workspace"]
  CORE --> HOME["DSH_HOME: profiles / settings / credentials / sessions / storage"]
```

1. **CLI 与 Profile。** `dsh web` 是 Web profile 的快捷入口，`dsh --profile headless` 则走一次性或自动化场景。Profile 不是一份封闭配置，而是基础 bundle、界面 bundle、用户 patch 和命令行 `--patch` 按顺序叠加的结果。
2. **Cordis 组合层。** Harness 通过 Cordis Loader 把模型、会话、工具、Web Server、目录选择器等能力装成插件图；依赖注入决定激活顺序，配置 patch 通过稳定 `id` 覆盖目标行。本项目没有 fork 源码，而是复用这条官方扩展缝隙覆盖容器监听地址。
3. **Agent 核心。** 模型路由、系统提示词、会话持久化、工具调用、目标/计划、子 Agent 与工作区都在 Host 侧组合。Web 只是浏览器客户端，不是另一个 Agent 实现。
4. **Surface。** Web surface 提供浏览器交互，Headless surface 适合 CLI、CI 和批处理。二者共享核心插件与 `$DSH_HOME` 数据模型。

### 数据与持久化边界

`DSH_HOME` 是容器化的关键边界。本项目显式设为 `/home/node/.dsh`，其中会出现：

- `profiles/`：profile 的包清单、Cordis 配置和用户 patch；
- `settings.yaml` 与凭据文件：模型设置及 Secret 引用/托管凭据；
- `sessions/`：会话日志；
- `storages/`：Workspace 等领域状态。

工作代码位于 `/workspace`，与内部状态卷分离。Compose 使用 `dsh-home` 命名卷加工作区 bind mount；Helm 使用 `dsh-home` PVC，并允许通过 `workspace.existingClaim` 挂载另一块工作区 PVC。这个分离让镜像可以重建，而会话与配置不会随容器消失。

### 为什么容器化并不只是 `npx`

| 难点 | 上游行为 | 本项目决策 |
| --- | --- | --- |
| Node 版本 | 要求 Node 22.19+ 或 24+ | 固定 Node 24 slim |
| 原生依赖 | `node-pty` 在部分架构没有 prebuild | 多阶段构建，builder 带 `node-gyp` 工具链，runtime 不带编译器 |
| Web 监听 | CLI 主动拒绝 `--host 0.0.0.0` | 使用 Cordis overlay；宿主端口只能绑定 `127.0.0.1` |
| Web 安全 | 当前无 TLS、认证和 Origin 策略，可触发代码执行 | 不提供 Ingress/LoadBalancer；Compose 回环发布；Helm 默认拒绝 Pod 入站 |
| HMR | 启动后挂载配置 watcher，需要 Node internals | 仅给 DSH 主进程传 `--expose-internals`，不通过 `NODE_OPTIONS` 传播给 Agent 子进程 |
| 目录选择器 | 浏览模式以 `os.homedir()` 为首页 | 将 `HOME` 指向可写 `/workspace`，避免只读 `/home/node` 的 EROFS |
| 信号和子进程 | Agent 会创建 shell/PTY 子进程 | 使用 `tini` 转发信号和回收孤儿进程 |
| 权限 | 工具需要工作区写入，但不应获得宿主权限 | UID 1000、只读根文件系统、drop ALL、no-new-privileges、最小挂载 |

这里最需要强调的是 Web 监听：Docker bridge 端口转发要求容器进程监听非 loopback 地址，但 Harness 的 CLI 正是为了防止未认证 RCE 被误暴露而禁止 `--host 0.0.0.0`。本项目只在容器内部用官方 patch 机制改监听地址，并把安全责任收回到部署边界：Compose 只发布 `127.0.0.1`，Kubernetes 只建议 `kubectl port-forward`。如果把它改成 `-p 3080:3080`、NodePort、LoadBalancer 或公开 Ingress，就破坏了这个安全模型。

### 容器与 Harness 沙箱的关系

容器不是 Harness 内部权限系统的替代品，两层保护的对象不同：

- Docker/Kubernetes 限制进程能看到哪些宿主目录、Linux capabilities 和资源；
- Harness 沙箱限制 Agent 工具在已进入容器的文件系统中能够执行什么。

Linux Landlock、用户命名空间和原生 helper 的可用性会受宿主内核与容器运行时影响。本项目不会用 `--privileged`、Docker socket 或额外 capabilities 掩盖沙箱失败。发布前除“页面能打开”外，还必须在目标平台验证一次真实 bash/文件工具调用。

### 为什么 Kubernetes 使用 StatefulSet

Harness 的 profile、模型设置、凭据、会话和 Workspace 索引都具有状态。单用户 Web 又不适合在没有会话协调的情况下横向扩容。因此 Helm Chart 固定一个 StatefulSet 副本：稳定地挂载 `dsh-home` PVC，升级时保留状态，卸载时保留 PVC，并明确拒绝把“加 replicas”伪装成高可用。未来只有在上游提供认证、多租户隔离和共享/并发安全的状态后端后，才适合讨论多副本服务化。

## 为什么不只是写 `FROM node` + `npx`

这个镜像处理了最容易漏掉的四个容器边界：

- 固定 DSH 版本，并在构建时校验实际 CLI 版本；
- 固定 pnpm 版本，使 `dsh plugin add` 能在运行时管理社区插件；
- 使用非 root 用户和 `tini`，正确处理 Agent 启动的子进程与退出信号；
- 把配置、凭据、会话和存储统一持久化到 `/home/node/.dsh`；
- 把容器用户的交互主目录指向 `/workspace`，让 Web 目录选择器的新建操作落在可写工作区；
- 通过容器专用 Cordis overlay 监听容器网络，同时只把宿主端口发布到 `127.0.0.1`。

DeepSeek Harness Web 当前没有 TLS、认证或 Origin 策略，Web API 还可以执行代码。因此本方案是**本机单用户开发环境**，不是可直接暴露到局域网或公网的服务。

## 快速开始

在本目录执行：

```bash
docker compose pull
DSH_WORKSPACE=/absolute/path/to/your/project docker compose up -d --no-build
docker compose ps
```

浏览器打开 <http://127.0.0.1:3080>，在设置页配置模型和凭据。侧边栏的“浏览器”按钮会在 Harness WebUI 内直接打开可交互的容器 Chromium；“文件”按钮会打开工作区文件管理器，可查看、新建、编辑、重命名和删除 `/workspace` 内的文件与目录。配置和浏览器 Profile 写入命名卷 `dsh-home`，重建容器后仍会保留。

默认镜像为 Docker Hub 上的 [`runzhliu/deepseek-harness:0.1.0-rc.6`](https://hub.docker.com/r/runzhliu/deepseek-harness)。Compose 同时保留 `build` 配置，方便审查并从本目录复现镜像；如需本地构建，执行 `docker compose build --pull` 后再启动。

### WebUI 内置浏览器

镜像内置 Debian Chromium、中文字体、Xvfb/Openbox 桌面和 noVNC。公开插件 `@runzhliu/dsh-browser-desktop` 通过 Harness 的 `sidebar.footer.action` 与 `shell.overlay` 扩展点提供始终可见的“打开浏览器”入口，点击后直接在 WebUI 内嵌可交互桌面，也可以选择新窗口打开 <http://127.0.0.1:6080/vnc.html?autoconnect=1>。内嵌面板默认占页面约 68%，可拖动标题栏移动、拖动右下角缩放，并支持最大化/还原。插件同时注册 `browser_open` Agent 工具；在对话中说“用浏览器打开 https://example.com”会创建并激活 Chromium 标签页，然后自动展开内嵌面板。浏览器意外退出或关闭后会自动重启，Profile 持久化到 `/home/node/.dsh/chrome-profile`。

![Harness WebUI 中可移动、缩放的内嵌 Chromium 浏览器](assets/browser-desktop-webui.png)

_实际运行效果：浏览器浮窗位于 Harness WebUI 内，图中打开的是 DeepSeek Harness 的公开 GitHub 仓库。_

该实现参考了 [`docker-antigravity`](https://github.com/runzhliu/docker-antigravity) 的可视桌面思路，但没有采用其 `amd64` 基础镜像和 Selkies，而是使用 Debian 原生架构软件包，因此 Apple Silicon 与 x86 Linux 均可运行。6080 与 3080 一样只绑定宿主机回环地址；noVNC 当前没有认证，不能暴露到局域网或公网。

```bash
docker compose exec deepseek-harness chromium-docker --version
docker compose exec deepseek-harness \
  chromium-docker --headless=new --dump-dom https://example.com
```

Compose 为 Chromium 配置了 1GB `/dev/shm`。启动器只对浏览器进程附加 `--no-sandbox`，以适配容器现有的 `cap_drop: ALL` 和 `no-new-privileges` 策略，不会放宽整个容器的权限。Agent 与脚本仍可通过 `chromium-docker --headless=new` 做无头渲染。

### 独立安装浏览器插件

插件已经按 DSH bundle 规范拆到 [`plugins/dsh-browser-desktop`](plugins/dsh-browser-desktop/README.md)，可独立打包：

```bash
npm pack ./plugins/dsh-browser-desktop --pack-destination /tmp
dsh plugin --profile web add /tmp/runzhliu-dsh-browser-desktop-0.1.0.tgz
```

发布到 npm 后可直接执行 `dsh plugin --profile web add @runzhliu/dsh-browser-desktop`。该 npm 包只负责 Harness Host/WebUI 集成，不会自行安装 Chromium、Xvfb 或 noVNC；本仓库 Docker 镜像是完整的参考运行时。DeepSeek Harness 当前通过 npm/GitHub 和 `dsh-plugin` GitHub topic 发现社区插件，并没有单独的审核型插件市场提交流程。

### 工作区文件管理器

镜像还内置独立插件 [`@runzhliu/dsh-workspace-browser`](plugins/dsh-workspace-browser/README.md)。它通过相同的 `sidebar.footer.action` 与 `shell.overlay` 扩展点增加“文件”入口，提供目录导航、面包屑、大小/修改时间、最多 512 KiB 的文本预览，以及新建文件/目录、文本编辑保存、重命名和删除。编辑器支持 `Ctrl/Cmd+S`，保存时会校验打开文件时的修改时间，避免静默覆盖外部变更。

所有请求路径必须相对 `/workspace` 并经过 `realpath` 边界校验；`..` 路径穿越、修改符号链接和指向工作区外部的符号链接都会被拒绝。修改接口只接受同源 JSON 请求，单次写入默认上限为 1 MiB；删除非空目录前 WebUI 会明确提示并确认递归删除。

插件也可以独立打包：

```bash
npm pack ./plugins/dsh-workspace-browser --pack-destination /tmp
dsh plugin --profile web add /tmp/runzhliu-dsh-workspace-browser-0.1.0.tgz
```

该文件管理器具备实际写入和递归删除能力，不构成多租户文件服务。能访问 Harness 的用户通常也能调用 Shell 或 Agent 工具，因此仍需把 DSH 放在可信的本机、Tailnet 或认证网关后面，并用版本控制或备份保证可恢复性。

本公开分支不打包任何公司内部模型、凭据、Skill 或个人工作区挂载。模型在 Harness 设置页配置；额外凭据和私有扩展应放在运行时 Secret、被忽略的 `.env` 或本机 `compose.local.yaml` 中。

查看日志和停止服务：

```bash
docker compose logs -f deepseek-harness
docker compose down
```

`docker compose down` 不删除命名卷。只有明确执行 `docker compose down --volumes` 才会删除持久化的配置、凭据和会话。

## 直接使用 Docker

构建镜像：

```bash
docker build -t runzhliu/deepseek-harness:0.1.0-rc.6 .
```

启动 Web UI：

```bash
docker volume create dsh-home
docker run --rm \
  --name deepseek-harness \
  --publish 127.0.0.1:3080:3080 \
  --publish 127.0.0.1:6080:6080 \
  --shm-size 1g \
  --mount type=volume,src=dsh-home,dst=/home/node/.dsh \
  --mount type=bind,src="$PWD",dst=/workspace \
  runzhliu/deepseek-harness:0.1.0-rc.6
```

不要把端口参数改成 `-p 3080:3080`，也不要把它部署到公开 Ingress。那会把一个没有认证、具备代码执行能力的接口暴露给网络。

## Headless 模式

镜像的入口等价于执行 `dsh`，因此可以用运行参数覆盖默认 Web 命令：

```bash
docker run --rm \
  --env DEEPSEEK_API_KEY \
  --mount type=volume,src=dsh-home,dst=/home/node/.dsh \
  --mount type=bind,src="$PWD",dst=/workspace \
  runzhliu/deepseek-harness:0.1.0-rc.6 \
  --profile headless "summarize this repository"
```

API Key 只应在运行时通过环境变量、Secret 或 Web 设置传入，不能写进 Dockerfile、镜像层或构建参数。

## Kubernetes / Helm

`charts/deepseek-harness` 使用单副本 StatefulSet。`/home/node/.dsh` 由 PVC 持久化，工作区可以使用独立的现有 PVC；Chart 不创建 Ingress 或 LoadBalancer，并默认创建拒绝 Pod 入站流量的 NetworkPolicy。

默认使用已发布的 Docker Hub 镜像，直接安装 Chart：

```bash
helm upgrade --install deepseek-harness charts/deepseek-harness \
  --namespace deepseek-harness \
  --create-namespace \
  --set image.repository=runzhliu/deepseek-harness \
  --set image.tag=0.1.0-rc.6
```

本机开发集群也可以直接拉取默认的 `runzhliu/deepseek-harness`，或先用 `kind load docker-image` / `minikube image load` 导入同名本地镜像。

通过 API Server 安全转发到本机浏览器：

```bash
kubectl -n deepseek-harness rollout status statefulset/deepseek-harness
kubectl -n deepseek-harness port-forward service/deepseek-harness 3080:3080
```

然后打开 <http://127.0.0.1:3080>。不要把这个无认证、可执行代码的接口改成 NodePort、LoadBalancer 或直接接入 Ingress。

如需通过 Secret 注入 provider 环境变量：

```bash
kubectl -n deepseek-harness create secret generic dsh-provider-credentials \
  --from-literal=DEEPSEEK_API_KEY='replace-me'

helm upgrade deepseek-harness charts/deepseek-harness \
  --namespace deepseek-harness \
  --reuse-values \
  --set credentials.existingSecret=dsh-provider-credentials
```

如需持久化工作区，先创建 PVC，再设置 `workspace.existingClaim`。未设置时 `/workspace` 是临时 `emptyDir`。卸载 Chart 后，StatefulSet 创建的 `dsh-home` PVC 默认保留；确认不再需要配置、凭据和会话后再手动删除。

```bash
helm uninstall deepseek-harness --namespace deepseek-harness
kubectl -n deepseek-harness get pvc
```

## 升级版本

构建参数控制安装的 DSH 版本：

```bash
docker build \
  --build-arg DSH_VERSION=0.1.0-rc.6 \
  -t runzhliu/deepseek-harness:0.1.0-rc.6 .
```

Compose 可以使用同一个变量：

```bash
DSH_VERSION=0.1.0-rc.6 docker compose build --pull
```

不要默认安装 `latest`。RC 版本正在快速变化，固定版本才能让问题可复现。

## 安全边界

- 容器默认以镜像内的 `node` 用户（UID/GID 1000）运行；如果宿主工作区拒绝该 UID 写入，需要调整目录权限或构建适配本机 UID 的派生镜像。
- Web 目录选择器中的“主目录”是 `/workspace`，不是保存内部配置的 `/home/node`；通过 Compose 或 Kubernetes 挂载的工作区必须可由 UID 1000 写入。
- Compose 丢弃全部 Linux capabilities、启用 `no-new-privileges`、只读根文件系统，并给 `/tmp` 单独的 tmpfs。
- 只挂载需要 Agent 操作的工作区。不要挂载宿主根目录、`~/.ssh`、云凭据目录或 Docker socket。
- Docker 隔离不是多租户安全沙箱。不要把这个实例交给不受信任用户，也不要把未审查的插件装进持久化配置卷。
- DeepSeek Harness 自己的 Linux 沙箱能力受宿主内核和容器运行时影响；镜像不会通过 `--privileged` 或额外 capabilities 绕过失败。应保留其默认权限模式，并验证真实工具调用。

## Smoke Test

每次升级至少完成以下检查：

```bash
docker run --rm --entrypoint dsh runzhliu/deepseek-harness:0.1.0-rc.6 --version

docker run --rm --entrypoint dsh runzhliu/deepseek-harness:0.1.0-rc.6 \
  web --patch /opt/deepseek-harness/web.cordis.patch.yml --dump-config

docker compose up -d
curl --fail http://127.0.0.1:3080/
docker compose ps
docker compose logs --no-color deepseek-harness
```

通过标准包括：CLI 版本等于构建版本；dump 后的 `webserver.config.host` 为 `0.0.0.0`；首页返回 2xx；容器进入 healthy；日志没有配置或插件加载错误。真正发布镜像前还要分别在 `linux/amd64` 和 `linux/arm64` 上构建并实际 spawn PTY，因为终端与沙箱相关依赖包含原生模块。仓库提供 `make verify`、`make build` 和 `make smoke` 作为统一入口。

## 常见问题

如果 Web 新建文件夹时报 `EROFS: read-only file system, mkdir '/home/node/...'`，说明容器仍在运行早期镜像或旧容器。当前镜像把目录选择器的主目录设为 `/workspace`。重新构建并强制重建容器：

```bash
docker compose build
docker compose up -d --force-recreate
docker compose exec deepseek-harness node -e "console.log(require('node:os').homedir())"
```

最后一条命令应输出 `/workspace`。如果错误变成 `/workspace` 下的 `EACCES`，则是宿主 bind mount 与容器 UID 1000 的权限不匹配；修正工作区所有权/权限，或构建使用匹配 UID 的派生镜像，不要改成 root 运行。

## 文件

| 文件 | 用途 |
| --- | --- |
| `Dockerfile` | 固定版本的非 root DSH 运行时，默认启动 Web UI |
| `web.cordis.patch.yml` | 只用于 Docker bridge 网络的 Web 监听覆盖 |
| `compose.yaml` | 持久化、回环端口和收紧后的运行时配置 |
| `plugins/dsh-browser-desktop/` | 可独立发布的 DSH 浏览器桌面 bundle |
| `plugins/dsh-workspace-browser/` | 受工作区边界约束、支持 CRUD 的文件管理器 bundle |
| `charts/deepseek-harness/` | 单副本 StatefulSet、PVC、Service 和 NetworkPolicy |
| `scripts/smoke.sh` | CLI、配置、原生 PTY 和 HTTP 启动验证 |
| `.github/workflows/ci.yml` | Compose/Helm 校验和双架构镜像 Smoke Test |
| `.dockerignore` | 把构建上下文限制到镜像真正需要的文件 |

本目录是社区实现，不代表 DeepSeek 官方发布的容器镜像。
