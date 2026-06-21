# AI 小说工作台

一个可直接运行和正式部署的 AI 小说网站，包含：

1. 用户端：一句话成书、灵感辅助、保存作品、续写/改写、个人中心、充值中心。
2. 管理端：管理员登录、用户管理、专业版权限、充值申请审核、手动充星币。

## 本地运行

安装依赖后启动：

```bash
npm install
npm start
```

默认地址：

```text
http://localhost:3000
```

页面入口：

```text
首页：http://localhost:3000
登录注册：http://localhost:3000/auth.html
用户端：http://localhost:3000/user.html
个人中心：http://localhost:3000/profile.html
充值中心：http://localhost:3000/billing.html
管理端：http://localhost:3000/admin.html
```

## 环境变量

先复制一份配置文件：

```bash
cp .env.example .env
```

### DeepSeek 示例

```text
API_PROVIDER=deepseek
API_BASE_URL=https://api.deepseek.com
OPENAI_API_KEY=你的 DeepSeek API Key
OPENAI_MODEL=deepseek-v4-flash

ADMIN_EMAIL=你的管理员邮箱
ADMIN_PASSWORD=你的管理员密码
ADMIN_INITIAL_CREDITS=0

SMTP_HOST=smtp.qq.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=你的发信邮箱
SMTP_PASS=你的 SMTP 授权码
SMTP_FROM=你的发信邮箱

PORT=3000
DATA_DIR=./data
```

说明：

- `OPENAI_API_KEY` 这里也用于兼容 DeepSeek Key。
- `DATA_DIR` 用来指定数据保存目录。本地默认是 `./data`。
- 如果没配 `SMTP_*`，验证码仍可在本地测试，但会走开发模式，不会真实发邮件。
- 在 Render 免费版里，如果没有挂载持久化磁盘，程序会自动回退到项目内的 `data` 目录先启动成功。

## 当前能力

- 邮箱注册 / 邮箱密码登录 / 邮箱验证码登录
- 用户端与管理端分离
- 管理端入口仅管理员可见
- 一句话成书支持章节数、每章字数、视角等控制
- 灵感辅助支持续写、扩写、改写、大纲生成
- 作品保存、打开、继续写、生成下一章、导出 TXT
- `基础版 / 专业版` 切换
- 专业版支持小说记忆
- 升级申请弹窗
- 充值中心、星币余额、充值申请记录
- 管理端审核充值申请
- 管理端直接给用户充星币

## 数据保存

系统数据保存在：

```text
DATA_DIR/app-data.json
```

里面包含：

- 用户账号
- 登录会话
- 已保存作品
- 邮箱验证码记录
- 充值申请记录

如果做正式部署，必须保留这个目录的持久化存储，否则服务器重启后数据会丢。

补充说明：

- Render 免费版可先用于测试。
- 免费版如果没有额外挂载磁盘，数据可能会在重建实例后丢失。
- 要正式运营，建议后续升级到带持久化磁盘的方案。

## 正式部署

这个项目不是纯静态网页，必须以 Node.js 服务形式部署。

### 推荐平台

推荐直接部署到 [Render](https://render.com/)。

项目里已经准备好了 [render.yaml](/Users/macbook/Documents/ai小说/render.yaml:1)，会自动配置：

- Node 服务
- 启动命令
- 健康检查
- 持久化磁盘
- `DATA_DIR=/var/data`

### Render 部署步骤

1. 把这个项目推到 GitHub 仓库。
2. 登录 Render。
3. 选择 `New +` → `Blueprint`。
4. 连接你的 GitHub 仓库。
5. Render 会自动识别 `render.yaml`。
6. 在环境变量里补齐这些值：

```text
API_PROVIDER
API_BASE_URL
OPENAI_API_KEY
OPENAI_MODEL
ADMIN_EMAIL
ADMIN_PASSWORD
ADMIN_INITIAL_CREDITS
SMTP_HOST
SMTP_PORT
SMTP_SECURE
SMTP_USER
SMTP_PASS
SMTP_FROM
```

7. 点击创建并等待部署完成。

### 部署成功后

- 你会拿到一个公网网址
- 普通用户可以直接访问这个网址注册登录
- 你可以继续在本地改按钮、页面和功能，然后重新部署新版本

## 管理员账号

管理员账号来自环境变量：

```text
ADMIN_EMAIL=你的邮箱
ADMIN_PASSWORD=你的密码
```

正式部署时建议使用你真实的管理员邮箱，并设置更强一点的密码。

## 健康检查

部署平台会访问：

```text
/healthz
```

用于判断服务是否正常运行。

## 注意事项

- 现在的数据存储方式适合早期产品验证和小规模运营。
- 如果后面用户量变大，建议从 `json` 文件升级到数据库。
- 如果你要启用真实邮箱验证码，必须配置可用的 SMTP 发信账号。
- 如果你准备正式收费，后面还建议补上订单号、人工备注和充值审计记录。
