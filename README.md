# LinsOCR

调用本地部署的 PaddleOCR-VL 模型（基于 WSL2），一键将手写笔记图片 / PDF 转为 Markdown 的 Obsidian 插件。

也算是Vibe Coding的练手项目，共花费3.70¥，模型为deepseek-v4-pro，使用CC Switch接入Claude Code。

突然感受到古法编程的羸弱了（）

> An Obsidian plugin that calls a locally-deployed PaddleOCR-VL model (via WSL2) to convert handwritten notes (images/PDFs) into Markdown with a single click.

## 功能

- **一键 OCR**：对图片（PNG/JPG/WebP 等）或 PDF 执行版面解析 + 文字识别，输出结构化 Markdown
- **三种触发方式**：
  1. 直接在 Obsidian 中打开图片/PDF 文件，执行命令
  2. 在 Markdown 笔记中，光标放在 `![[文件]]` 嵌入行上执行命令
  3. 弹窗模糊搜索仓库中的文件
- **服务生命周期自动化**：健康检查 → 自动启动 WSL 服务 → 识别 → 空闲超时自动关闭
- **图片预处理**：长边超过阈值时自动等比压缩，避免大图推理卡顿
- **数学公式支持**：手写数学笔记中的公式会被识别为 LaTeX
- **全部本地运行**：数据不外传，无需网络

## 架构

```
┌─────────────────────────────────────────────┐
│  Windows 11 (宿主机)                         │
│  ┌───────────────────────────────────────┐  │
│  │  Obsidian + LinsOCR 插件 (TypeScript)  │  │
│  │  • child_process.spawn('wsl', [...])  │  │
│  │  • requestUrl → http://127.0.0.1:8080 │  │
│  └───────────────┬───────────────────────┘  │
│                  │ WSL2 网络 (镜像模式)        │
│  ┌───────────────▼───────────────────────┐  │
│  │  WSL2 Arch Linux                      │  │
│  │  • PaddleOCR-VL HTTP 服务 (FastAPI)    │  │
│  │  • GPU 推理 (RTX 5060 Laptop)          │  │
│  │  • conda env: paddle                   │  │
│  └───────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
```

## 前置条件

| 依赖 | 说明 |
|------|------|
| **WSL2** | 已安装并运行，发行版名可在插件设置中配置 |
| **PaddleOCR-VL 服务** | 通过 `paddlex --serve` 启动的 HTTP 服务，监听 `127.0.0.1:8080` |
| **WSL 网络** | 建议使用镜像网络模式（`.wslconfig` 中 `networkingMode=mirrored`），否则可能需要配置端口转发 |
| **Obsidian** | ≥ 0.15.0 |

### PaddleOCR-VL 服务部署（参考）

```bash
# 在 WSL2 (Arch) 中
conda create -n paddle python=3.10
conda activate paddle
pip install paddlepaddle-gpu paddlex paddleocr

# 模型会自动下载到 ~/.paddlex/
```

## 安装

### 手动安装

将构建产物复制到 Obsidian 仓库的插件目录：

```bash
mkdir -p "<你的仓库>/.obsidian/plugins/lins-ocr/"
cp main.js manifest.json styles.css "<你的仓库>/.obsidian/plugins/lins-ocr/"
```

然后在 Obsidian 中：**设置 → 社区插件** → 刷新 → 启用 **LinsOCR**。

### 开发构建

```bash
git clone <repo-url>
cd lins-ocr
npm install
npm run build   # 生成 main.js
```

热重载开发：

```bash
npm run dev     # watch 模式，保存后自动编译
```

> 需要安装 [Hot Reload](https://github.com/pjeby/hot-reload) 社区插件配合使用。

## 设置

进入 **设置 → LinsOCR**，可配置以下选项：

### WSL 配置

| 设置项 | 默认值 | 说明 |
|--------|--------|------|
| WSL 发行版名称 | `Arch` | 安装 PaddleOCR 的发行版名称（`wsl -l` 查看） |
| Conda 环境路径 | `/home/username/miniconda3/envs/paddle` | conda 环境的绝对路径 |
| 服务端口 | `8080` | PaddleOCR-VL 服务端口 |

### 服务端点

| 设置项 | 默认值 |
|--------|--------|
| 健康检查地址 | `http://127.0.0.1:8080/health` |
| 版面解析地址 | `http://127.0.0.1:8080/layout-parsing` |
| 页面重组地址 | `http://127.0.0.1:8080/restructure-pages` |

> 修改端口后 URL 自动同步更新。

### 输出与行为

| 设置项 | 默认值 | 说明 |
|--------|--------|------|
| 输出目录 | 空（仓库根目录） | 识别结果 .md 的保存位置 |
| 附件目录 | `attachments` | 解析出的图片保存位置 |
| 空闲超时 | `120` 秒 | OCR 完成后空闲多久自动关闭服务以释放显存 |
| 图片长边最大像素 | `1280` | 超过此值自动压缩 |

## 使用

### 方式 1：直接打开文件（推荐）

在 Obsidian 中直接打开一张图片或 PDF，按 `Ctrl+P` → 选择：

- **OCR picture** — 识别图片
- **OCR PDF file** — 识别 PDF

### 方式 2：Markdown 嵌入

在笔记中嵌入文件：`![[手写笔记.png]]`，光标放在该行，执行 OCR 命令。

### 方式 3：搜索选择

执行命令时若未找到目标文件，弹出模糊搜索框，输入文件名选择。

### 结果

识别完成后，仓库中自动生成：
- `{文件名}.md` — OCR 识别结果
- `attachments/{文件名}_p0_*.jpg` — 解析出的内嵌图片

## 工作流程

```
用户执行 OCR 命令
    │
    ▼
健康检查 ← HTTP GET /health
    │ (失败)
    ▼
启动 WSL 服务 ← spawn('wsl', ['-d', distro, '--', 'bash', '-c', ...])
    │             FLAGS_allocator_strategy=naive_best_fit
    ▼
读取文件 + 图片压缩（Canvas API，长边 ≤1280px）
    │
    ▼
版面解析 ← POST /layout-parsing (base64 文件)
    │
    ▼
页面重组 ← POST /restructure-pages
    │
    ▼
保存结果（.md + 图片） → 调度空闲关闭（默认 2 分钟）
```

## 项目结构

```
src/
  main.ts                        # 插件入口
  settings.ts                    # 设置接口与标签页
  types.ts                       # 类型定义
  commands/
    helpers.ts                   # 光标嵌入文件查找
    ocr-picture.ts              # OCR 图片命令
    ocr-pdffile.ts              # OCR PDF 命令
  services/
    wsl-service.ts              # WSL 服务生命周期管理
    ocr-api.ts                  # HTTP API 调用
    ocr-orchestrator.ts         # OCR 流程编排
  ui/
    file-picker-modal.ts        # 文件选择器
  utils/
    image-utils.ts              # 图片工具
    file-utils.ts               # 仓库文件操作
```

## 技术选型

- **`requestUrl`** 而非 `fetch` — Obsidian 插件强制要求，避免 CORS
- **`child_process.spawn`** 而非 `exec` — 以参数数组传参，彻底避开 Windows cmd.exe 的嵌套引号转义问题
- **Canvas API** 图片缩放 — Electron 内置，无需 `sharp` 等原生依赖
- **空闲超时关闭** — 避免连续 OCR 时反复加载模型到 GPU 显存

## 许可证

MIT
