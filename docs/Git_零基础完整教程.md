# Git 零基础完整教程：从空白文件夹到 GitHub 上线

> 配套速查表：`docs/Git_使用速查.md`（会用了之后查命令用）
> 本文是**教学版**：每个命令讲清楚"在干什么、会看到什么、错了怎么办"。

---

## 第 0 章 先把名词对上号

| 名词 | 通俗解释 |
|---|---|
| 仓库 repository | 一个被 git 管理的文件夹，里面所有改动都会被记录 |
| 提交 commit | 给当前所有文件拍一张"快照"，带编号、时间、作者、说明 |
| 分支 branch | 一条独立的开发线。`main` 是默认主线 |
| 远程 remote | 放在服务器（GitHub）上的那份仓库副本 |
| origin | 给远程仓库起的默认名字，只是个代号，可以改 |
| 暂存区 stage | 一个"待提交清单"，用来挑出这次要打包哪些改动 |

**核心心智模型**：`工作区 --add--> 暂存区 --commit--> 本地仓库 --push--> GitHub`

---

## 第 1 章 准备工作（一台电脑只做一次）

### 1.1 确认 git 装好了

```bash
git --version
```

看到 `git version 2.x.x` 就对了。没有的话去 https://git-scm.com/downloads 下载安装。

### 1.2 配置身份（必做）

git 要把"是谁提交的"写进每一条记录，所以必须先告诉它：

```bash
git config --global user.name "你的名字"
git config --global user.email "你的邮箱"
```

- `--global` 表示对这台电脑上所有仓库生效，只需配一次
- 名字建议用英文或拼音，会显示在 GitHub 的提交记录里
- 想只对当前项目生效，去掉 `--global`

**注意**：这里填的邮箱会出现在每一条公开提交记录里。如果不想暴露真实邮箱，
可以在 GitHub 的 Settings → Emails 里开启 "Keep my email addresses private"，
用 GitHub 给你的 `xxx@users.noreply.github.com` 地址。

验证：

```bash
git config --global --list
```

### 1.3 配置 SSH 密钥（想免密推送就做）

**为什么需要**：GitHub 要确认推送的人是你。两种方式 —— HTTPS 每次输账号密码/令牌，
或者 SSH 用密钥自动认证。SSH 配一次，以后一劳永逸。

**第一步：看看有没有现成的密钥**

```bash
ls ~/.ssh
```

如果看到 `id_rsa` 和 `id_rsa.pub`，说明已经有了，跳到第三步。
（`id_ed25519` 是更新的算法，效果一样）

**第二步：生成密钥**

```bash
ssh-keygen -t rsa -C "你的邮箱"
```

一路按回车即可（密码短语可留空）。会生成两个文件：

| 文件 | 是什么 | 能不能给别人 |
|---|---|---|
| `id_rsa` | **私钥**，留在自己电脑上 | 绝对不行 |
| `id_rsa.pub` | **公钥**，要交给 GitHub | 可以 |

**第三步：把公钥贴到 GitHub**

```bash
cat ~/.ssh/id_rsa.pub
```

复制输出的**全部内容**（从 `ssh-rsa` 开头到邮箱结尾），然后：

1. 浏览器打开 https://github.com/settings/keys
2. 点 **New SSH key**
3. Title 随便填（比如"我的笔记本"），Key type 保持 `Authentication Key`
4. Key 框里粘贴刚复制的内容 → **Add SSH key**

### 1.4 验证连接

```bash
ssh -T git@github.com
```

第一次会问 `Are you sure you want to continue connecting?`，输 `yes` 回车。

看到这样的输出就成功了：

```
Hi 你的用户名! You've successfully authenticated, but GitHub does not provide shell access.
```

`Hi` 后面就是你的 GitHub 用户名 —— 后面拼仓库地址要用到它。

---

## 第 2 章 把本地文件夹变成 Git 仓库

### 2.1 进入项目文件夹

在文件夹里右键 → **Open Git Bash here**（装了 Git 就有这个菜单），
或者先开终端再 `cd` 进去：

```bash
cd /d/code/你的项目
```

### 2.2 初始化仓库

```bash
git init -b main
```

- `git init` 在文件夹里创建一个隐藏的 `.git` 目录，所有版本历史都存在这里面
- `-b main` 指定主分支叫 `main`（GitHub 现在的默认叫法）
- 这一步**不会动你的任何文件**，只是多了一个 `.git` 文件夹

输出：`Initialized empty Git repository in ...` —— 空仓库，还没有任何记录。

### 2.3 配置 .gitignore（提交前必做）

**为什么**：有些文件不该进版本库 —— 依赖包（几个 G）、构建产物（能重新生成）、
密钥（泄露就完了）。不排除的话仓库会变得又大又危险。

在项目根目录新建 `.gitignore` 文件（没有后缀名），一行一条规则：

```
node_modules/
dist/
coverage/
.env
.env.*
!.env.example
*.log
.DS_Store
```

规则读法：

| 写法 | 含义 |
|---|---|
| `node_modules/` | 排除这个目录 |
| `*.log` | 排除所有 .log 结尾的文件 |
| `!.env.example` | `!` 表示例外，这个要保留 |
| `# 注释` | 井号开头是注释 |

**已经提交过的文件，后加 .gitignore 是不起作用的**，需要先移出：

```bash
git rm --cached 文件名      # 只从版本库移除，本地文件保留
```

### 2.4 把文件放进暂存区

```bash
git add -A
```

- `-A` = all，把所有改动（新增、修改、删除）都放进暂存区
- 想只提交某一个文件：`git add README.md`

这一步可以随时用 `git status` 看进展。

### 2.5 提交

```bash
git commit -m "chore: 初始化项目"
```

- `-m` 后面是本次提交的说明，**必填**，否则会弹出编辑器让你写
- 这一步才真正把快照存进本地仓库

提交信息建议用前缀：

| 前缀 | 用于 |
|---|---|
| `feat:` | 新增功能 |
| `fix:` | 修复问题 |
| `docs:` | 只改文档 |
| `refactor:` | 重构 |
| `chore:` | 配置、依赖等杂项 |

### 2.6 检查成果

```bash
git log --oneline     # 应该看到刚才那条提交，带一个 7 位编号
git status            # 应该显示 "nothing to commit, working tree clean"
```

至此**本地仓库已经完成**，但 GitHub 上还是空的。

---

## 第 3 章 在 GitHub 上建一个空仓库

1. 浏览器打开 **https://github.com/new**（需先登录）
2. **Repository name**：填仓库名，比如 `xiaoban-agent`
   - 只能用英文、数字、`-`、`_`
   - 这个名字会成为网址的一部分
3. **Description**：可留空
4. **Public / Private**：公开所有人都能看到；私有只有你和被邀请的人能看
5. ⚠️ **最关键的**：下面三个选项**一个都不要勾**

   | 选项 | 勾了会怎样 |
   |---|---|
   | Add a README file | GitHub 会先替你在云端建一个提交，和你的本地历史"撞车" |
   | Add .gitignore | 同上，而且可能和你本地的规则冲突 |
   | Choose a license | 同上 |

   勾了之后推送会被拒绝（报 `rejected` / `fetch first`），新手最容易卡在这里。

6. 点绿色的 **Create repository**

创建后页面会显示仓库地址，两种格式：

| 格式 | 用途 |
|---|---|
| `git@github.com:用户名/仓库名.git` | **SSH**，配了密钥就用这个，免密 |
| `https://github.com/用户名/仓库名.git` | HTTPS，每次要输凭据 |

---

## 第 4 章 把本地仓库连到 GitHub 并推送

### 4.1 给本地仓库登记远程地址

```bash
git remote add origin git@github.com:用户名/仓库名.git
```

拆开看：

- `git remote add` —— 登记一个远程仓库
- `origin` —— 给它起的名字（约定俗成叫 origin，你也可以叫别的）
- 最后是地址

验证登记成功：

```bash
git remote -v
```

会看到两行（fetch 和 push），地址一致就对了。

改地址用 `git remote set-url origin 新地址`，删除用 `git remote remove origin`。

### 4.2 推送

```bash
git push -u origin main
```

拆开看：

- `git push` —— 上传
- `origin` —— 推到哪个远程
- `main` —— 推哪个分支
- `-u` 是 `--set-upstream` 的缩写：把本地 main 和远程 main **绑定起来**，
  **以后只要敲 `git push` 就行**，不用再写后面这一串

成功输出类似：

```
To github.com:用户名/仓库名.git
 * [new branch]      main -> main
branch 'main' set up to track 'origin/main'.
```

### 4.3 验证（别只看 push 输出）

```bash
git ls-remote origin     # 直接查 GitHub，最权威
git status -sb           # 显示 ## main...origin/main 就是完全同步
```

最直观的验证：刷新浏览器里的仓库页面，文件应该都在了。

---

## 第 5 章 以后的日常：改完就传

第一次的 `remote add` 和 `push -u` **一辈子只做一次**。以后每次改完代码：

```bash
git status                # 1. 看改了什么
git add -A                # 2. 放进暂存区
git commit -m "feat: ..." # 3. 存成版本
git push                  # 4. 推上去（-u 已设好，不用带参数）
```

就这四步。

---

## 第 6 章 出错怎么办

| 报错/现象 | 原因 | 解决 |
|---|---|---|
| `not a git repository` | 当前目录不是仓库，或不在项目根目录 | `cd` 到项目目录；没初始化就 `git init -b main` |
| `Permission denied (publickey)` | SSH 密钥没配好 | 重做第 1.3、1.4 步；`ssh -T git@github.com` 先测通 |
| `rejected ... fetch first` | GitHub 上有你本地没有的提交（多是建仓库时勾了 README） | `git pull --rebase origin main` 后再 `git push` |
| `remote origin already exists` | 之前登记过远程地址了 | `git remote set-url origin 新地址` |
| `nothing to commit` | 没有改动，或忘了 `git add` | 先 `git add -A` |
| 提交信息写错了但还没 push | — | `git commit --amend -m "正确说明"` |
| 文件加错暂存区 | — | `git restore --staged 文件名` |
| 改乱了文件想还原（⚠️ 改动会丢） | — | `git restore 文件名` |
| 文件不小心提交进去了 | — | `git rm --cached 文件名`，再加进 `.gitignore` |
| push 很慢或卡住 | 网络问题 | Ctrl+C 中断重试；检查代理设置 |

---

## 附录 A 命令速查

```bash
# 一次性准备
git config --global user.name "名字"
git config --global user.email "邮箱"
ssh-keygen -t rsa -C "邮箱"
ssh -T git@github.com                    # 验证 SSH

# 第一次上传
git init -b main
git add -A
git commit -m "chore: 初始化项目"
git remote add origin git@github.com:用户名/仓库名.git
git push -u origin main

# 日常循环
git status
git add -A
git commit -m "feat: 说明"
git push

# 查看
git log --oneline                        # 历史
git remote -v                            # 远程地址
git diff                                 # 未暂存的改动内容
git show 提交编号                         # 某次提交改了什么
```

## 附录 B 本项目（xiaoban-agent）的实际记录

| 项目 | 值 |
|---|---|
| 仓库地址 | https://github.com/PoloQi/xiaoban-agent |
| 主分支 | `main` |
| 首次提交 | `8dce7aa` — 216 个文件、45160 行 |
| 二次提交 | `5f9b2fd` — 新增本教程与速查手册 |
| 认证方式 | SSH（`~/.ssh/id_rsa`），免密推送 |
| 排除在外的文件 | `2026调研报告.docx`(25MB)、`node_modules/`、`.pnpm-store/`、`.local/`、`.env`、`.workbuddy/`、`*.tsbuildinfo` |
