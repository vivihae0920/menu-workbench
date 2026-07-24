# 菜单工作台 - 部署到 Render 指引

## 为什么需要部署到 Render？
- 电脑关机也能用
- 手机随时访问
- 朋友随时共享
- 完全免费

## 第一步：推送到 GitHub（5分钟）

1. 打开 https://github.com → 注册/登录
2. 点右上角 **+** → **New repository**
3. 仓库名填 `menu-workbench`，选 **Public**，点 **Create repository**
4. 复制仓库地址（形如 `https://github.com/你的用户名/menu-workbench.git`）
5. 在本机终端执行（替换你的用户名）：

```bash
cd "C:/Users/86135/WorkBuddy/2026-07-24-16-07-49"
git remote add origin https://github.com/你的用户名/menu-workbench.git
git push -u origin master:main
```

> 如果提示输入账号密码，需要在 GitHub 设置中创建 Personal Access Token。
> 路径：Settings → Developer settings → Personal access tokens → Tokens (classic) → Generate new token → 勾选 `repo` 权限

## 第二步：部署到 Render（3分钟）

1. 打开 https://render.com → 点 **Sign Up** → 选 **GitHub** 登录
2. 登录后点 **New +** → **Web Service**
3. 找到 `menu-workbench` 仓库 → 点 **Connect**
4. Render 会自动读取 `render.yaml` 配置，直接点 **Create Web Service**
5. 等待 1-2 分钟，部署完成后会显示地址：
   `https://menu-workbench-xxxx.onrender.com`

## 第三步：分享给朋友

1. 把 Render 的公网地址发给朋友
2. 打开应用 → 点左上角 👥 → 查看房间号
3. 把房间号也发给朋友
4. 朋友打开链接 → 点 👥 → 输入房间号 → 加入

## 注意事项

- Render 免费版会在 15 分钟无访问后休眠，再次访问时自动唤醒（约需 30 秒）
- 唤醒后所有数据照常使用，不会丢失
- 房间数据存储在服务器内存中，服务重启会清空（免费版限制）
- 小红书菜谱推荐有反爬限制，失败时自动使用内置精选菜谱
