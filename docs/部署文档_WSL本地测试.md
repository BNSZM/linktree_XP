# WSL 本地部署测试文档（从环境搭建开始）

目标：在 Windows 的 WSL（Ubuntu）里，从**零环境**开始，把**对话代理**和**前端**跑起来，端到端测试对话。**先不碰服务器。**

调用链：
```
浏览器 ──/api/chat──► Astro dev(:4321) ──转发──► Node 代理(:8787) ──Bearer Key──► FastGPT
```

> **两个约定，先看一眼：**
> 1. 下面代码框里的命令**可以整段直接复制粘贴执行**，前面没有任何 `$` 提示符。
> 2. 如果你是 **root 用户**（提示符是 `root@...#`），命令里的 `sudo` 可以省略；如果是普通用户则保留 `sudo`。本文命令默认按 root 写（不带 sudo）。

---

## 第 0 步：确认 / 安装 WSL（已装可跳过）

在 **Windows PowerShell（管理员）** 里：
```
wsl --install -d Ubuntu
wsl -l -v
```
装好后打开「Ubuntu」终端。后续命令都在这个 Ubuntu 终端里执行。

---

## 第 1 步：更新系统并装基础工具

```
apt update && apt -y upgrade
apt -y install curl ca-certificates
curl --version | head -1
```
（普通用户在每条前加 `sudo`，例如 `sudo apt update`。）

---

## 第 2 步：安装 Node.js 18+（二选一）

### 方式 A：NodeSource（root 推荐，系统级安装）
```
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt -y install nodejs
```
（普通用户：`curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -` 然后 `sudo apt -y install nodejs`）

### 方式 C：国内网络推荐 —— 淘宝镜像二进制（不走 apt / 不走 GitHub）
如果 NodeSource 因第三方源 GPG 报错、或 GitHub/nvm 连接被重置（`Connection reset` / git clone `RPC failed`），用这个最稳：
```
cd /tmp
curl -fsSL -o node20.tar.gz https://npmmirror.com/mirrors/node/v20.18.1/node-v20.18.1-linux-x64.tar.gz
mkdir -p /usr/local/lib/nodejs
tar -xzf node20.tar.gz -C /usr/local/lib/nodejs
ln -sf /usr/local/lib/nodejs/node-v20.18.1-linux-x64/bin/node /usr/local/bin/node
ln -sf /usr/local/lib/nodejs/node-v20.18.1-linux-x64/bin/npm  /usr/local/bin/npm
ln -sf /usr/local/lib/nodejs/node-v20.18.1-linux-x64/bin/npx  /usr/local/bin/npx
hash -r
node -v && npm -v
```
装好后把 npm 也切国内镜像（后续 `npm install` 更快更稳）：
```
npm config set registry https://registry.npmmirror.com
```
> 顺手禁掉报错的第三方源（如 Docker）让 apt 恢复正常：
> `for f in $(grep -rl download.docker.com /etc/apt/sources.list.d/ 2>/dev/null); do mv "$f" "$f.disabled"; done && apt update`

### 方式 B：nvm（按用户安装、可切版本、不需要 root）
```
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm install 20
nvm use 20
nvm alias default 20
```

### 验证（两种方式都要看到版本号）
```
node -v
npm -v
```
看到 `node -v` 输出 `v20.x`（≥ v18 即可）即成功。

### Node 安装疑难：装完却是 v12 / npm 不存在
原因：NodeSource 脚本会先跑一次 `apt update`，若你系统里有**第三方源缺 GPG 公钥**（常见是 Docker 源报 `NO_PUBKEY`），这次 `apt update` 失败会让脚本中途退出，于是没加上 Node 20 的源，`apt install nodejs` 装的是 Ubuntu 自带的老版 Node 12。

修复（以 Docker 源为例，自动探测其 keyring 路径并补上公钥）：
```
KEYRING=$(grep -rh download.docker.com /etc/apt/sources.list.d/ /etc/apt/sources.list 2>/dev/null | grep -o 'signed-by=[^]]*' | head -1 | cut -d= -f2)
KEYRING=${KEYRING:-/etc/apt/keyrings/docker.gpg}
install -m 0755 -d "$(dirname "$KEYRING")"
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o "$KEYRING"
chmod a+r "$KEYRING"
apt update
```
`apt update` 干净后，重装 Node 20：
```
apt -y remove nodejs
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt -y install nodejs
node -v && npm -v
```
> 不想碰 apt 就直接用上面的**方式 B（nvm）**，它绕开整个 apt/第三方源问题。

---

## 第 3 步：把项目放进 WSL

把交付的 `personal-homepage/` 文件夹（或解压 `personal-homepage.tar.gz`）放到 WSL 家目录。
Windows 上的文件在 WSL 里通过 `/mnt/盘符/...` 访问（如 `D:` → `/mnt/d`）。

```
mkdir -p ~/homepage && cd ~/homepage
```

情况一：你有压缩包
```
cp /mnt/d/downloads/personal-homepage.tar.gz .
tar -xzf personal-homepage.tar.gz
cd personal-homepage
```

情况二：你有 `personal-homepage/` 文件夹
```
cp -r /mnt/d/downloads/personal-homepage ./personal-homepage
cd personal-homepage
```

确认：
```
ls
```
应看到 `site`、`proxy` 和项目文档。

> 建议把项目放在 WSL 家目录（`~/homepage`）下运行，比放在 `/mnt/d/...` 下更快更稳。

---

## 第 4 步：启动对话代理（终端 A）

```
cd ~/homepage/proxy
cp .env.example .env
nano .env
```
在 `nano` 里把 `FASTGPT_API_KEY` 填上（建议先在 FastGPT 重置一个新 Key）。
保存退出：`Ctrl+O` 回车，再 `Ctrl+X`。然后启动：
```
node server.js
```
看到 `[fastgpt-proxy] listening on :8787 -> https://ai-china.itinfolab.cn/api` 即成功。
> 代理零依赖，**不需要 `npm install`**，Node 18+ 直接 `node server.js`。

### 验证代理（另开一个 Ubuntu 终端）
```
curl http://localhost:8787/api/health
```
期望：`{"ok":true,"hasKey":true,"base":true}`

真实对话（看到流式 `data:` 行即成功）：
```
curl -N -X POST http://localhost:8787/api/chat -H "Content-Type: application/json" -d '{"messages":[{"role":"user","content":"你好"}]}'
```
- `hasKey:false` → `.env` 没填或没生效（确认在 `proxy/` 目录、变量名是 `FASTGPT_API_KEY`）
- 对话报 `upstream` / 超时 → WSL 访问不到 FastGPT，或 Key 不对

---

## 第 5 步：启动前端（终端 B）

```
cd ~/homepage/site
npm install
npm run dev
```
看到本地地址，通常 `http://localhost:4321`。
`astro.config.mjs` 已配好：开发态把 `/api` 自动转发到 `http://localhost:8787`（代理）。
代理若不在默认端口，改用：
```
CHAT_PROXY=http://localhost:8787 npm run dev
```

### 测试
- 浏览器打开 `http://localhost:4321`
- 点「问我任何事…」→ 输入问题 → 应看到**真实**流式回复（来自你的 FastGPT）
- 右上角切中英；点微信/公众号测复制；点小红书/TG 测跳转

---

## 第 6 步（可选）：测试构建产物

```
cd ~/homepage/site
npm run build
npm run preview
```
`dist/` 就是将来上服务器要部署的纯静态文件（`npm run preview` 的 `/api` 同样转发到 :8787，代理需在运行）。

---

## 只想快速看界面（不接代理、不装 Node）

浏览器打开前端页面即可快速看界面；如果暂时不接代理，对话框会显示连接失败兜底提示。也可以只运行前端的 `npm run dev` 预览个人卡片、双语、自托管服务、项目/文章/统计和社交链接。

---

## 常见问题

| 现象 | 排查 |
|---|---|
| `$: command not found` | 你把命令前的 `$` 提示符也粘进去了；本文命令不含 `$`，直接整段粘贴即可 |
| `node: command not found` | Node 没装好或终端没刷新；nvm 用户重开终端或执行 `. "$NVM_DIR/nvm.sh"` |
| 装完是 Node v12 / `npm not found` | NodeSource 脚本因第三方源（如 Docker）`apt update` 报 GPG 错而中途退出，没加上 Node 20 源。先修好报错的源再重装，或改用 nvm（见下） |
| `NO_PUBKEY ...` / 某源未签名 | 缺该源的 GPG 公钥。以 Docker 源为例修复：`grep` 出其 `signed-by=` 路径，把 `https://download.docker.com/linux/ubuntu/gpg` 用 `gpg --dearmor` 写到该路径，再 `apt update`。详见正文「Node 安装疑难」 |
| `sudo: command not found` | 你已是 root，去掉命令里的 `sudo` 即可 |
| 对话框显示「连接失败」 | 代理没起／端口不对／`.env` 没填 Key。先用第 4 步 curl 验证代理 |
| `npm install` 卡住/失败 | 网络问题；换源后重试：`npm config set registry https://registry.npmmirror.com` |
| `curl /api/chat` 超时 | WSL 访问不到 FastGPT，或上游地址/Key 错误 |
| `hasKey:false` | `.env` 未生效：确认目录、变量名 `FASTGPT_API_KEY` |
| 端口被占用 | 改端口：代理 `PORT=8801 node server.js`，前端 `CHAT_PROXY=http://localhost:8801 npm run dev` |

---

## 测试通过后

下一步再上服务器（第 8 步部署落地）：静态 `dist/` 走 80/443，`/api` 反代到代理容器，配域名与 HTTPS，并把代理 `.env` 的 `ALLOW_ORIGIN` 收紧到你的主页域名。需要时我再给**服务器版部署文档**。

---

## 安全与生产环境注意

- **密钥轮换**：如果 API Key 曾在对话/文档中明文出现过，在 FastGPT 后台重置一个新 Key 再填入 `.env`。
- **Origin 收紧**：开发态 `ALLOW_ORIGIN=*` 没问题，上线后改成你的域名。
- **限流与熔断**：代理已内置按 IP 限流。建议再加全局日额度熔断（给 Token 成本封顶），可在 `.env` 中配置。
- **Cloudflare**：整站可套 Cloudflare 免费版获得 WAF + 限流；对话接口可加 Turnstile 人机验证。
- **FastGPT 侧**：公开分身限 `max_tokens`，用便宜模型降低单次调用成本。
- **前端限制只是体验提示**，可被绕过；真正拦截必须在代理层。
