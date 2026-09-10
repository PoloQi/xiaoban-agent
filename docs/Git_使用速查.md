# Git 使用速查手册

> 本项目仓库：`git@github.com:PoloQi/xiaoban-agent.git`
> 所有命令都在项目根目录 `D:\code\agent` 下执行。

## 一、先理解四个区域

```
工作区  --git add-->  暂存区  --git commit-->  本地仓库  --git push-->  GitHub
```

| 区域 | 是什么 | 对应命令 |
|---|---|---|
| 工作区 | 你在编辑器里实际改的文件 | 无（直接改文件） |
| 暂存区 | 挑出"这次要提交"的改动 | `git add` |
| 本地仓库 | 只在你电脑上的版本历史 | `git commit` |
| 远程仓库 | GitHub 云端，团队协作和备份 | `git push` / `git pull` |

关键点：**改完文件不会自动进版本库，必须 add + commit**。

## 二、日常循环：改完代码怎么上传

```bash
git status                    # 1. 先看改了什么
git add -A                    # 2. 把改动放进暂存区（-A = 全部）
git commit -m "feat: 新增成长计划页面"   # 3. 存成一个版本快照
git push                      # 4. 推到 GitHub
```

这四步是本项目 90% 的场景，记住它就够了。

> 第一次推送某个新分支时才需要写全：`git push -u origin 分支名`，之后直接 `git push`。

## 三、最常用的命令

| 命令 | 作用 |
|---|---|
| `git status` | 查看当前有哪些改动、有没有未提交的东西 |
| `git add 文件名` | 只暂存某个文件（比 `-A` 精确） |
| `git commit -m "说明"` | 提交暂存区内容 |
| `git push` | 上传到 GitHub |
| `git pull` | 把 GitHub 上的新改动拉下来 |
| `git log --oneline` | 查看提交历史（每行一条，带短编号） |
| `git diff` | 查看还没暂存的具体改动内容 |

## 四、提交信息的写法

推荐前缀，方便以后回溯：

| 前缀 | 用途 |
|---|---|
| `feat:` | 新增功能 |
| `fix:` | 修复问题 |
| `docs:` | 只改文档 |
| `refactor:` | 重构，不改功能 |
| `chore:` | 杂项，如配置、依赖 |

例：`fix: 修复儿童端聊天消息重复发送`

## 五、常见问题怎么办

**推送被拒绝（rejected）**
说明 GitHub 上有你本地没有的提交，先拉再推：
```bash
git pull
git push
```

**提交信息写错了，但还没 push**
```bash
git commit --amend -m "正确的说明"
```

**文件加错进暂存区，想撤出来**（文件本身不动）
```bash
git restore --staged 文件名
```

**改乱了某个文件，想还原成上次提交的样子**（⚠️ 改动会丢）
```bash
git restore 文件名
```

**想看某次提交具体改了什么**
```bash
git show 提交编号
```

**某个文件不想上传，但不确定是被哪条规则命中的**
```bash
git check-ignore -v 文件名
```

**文件已经被提交进仓库了，现在想移出去**
```bash
git rm --cached 文件名      # 只从版本库移除，本地文件保留
```
然后把文件名加进 `.gitignore`。

## 六、关于 .gitignore

根目录的 `.gitignore` 决定哪些文件**不进版本库**。本项目已排除：

- `node_modules/`、`.pnpm-store/` —— 依赖，太大且可用 `pnpm install` 恢复
- `dist/`、`coverage/`、`*.tsbuildinfo` —— 构建产物，可重新生成
- `.local/`、`.env` —— 本地运行数据与密钥，**绝不能上传**
- `.workbuddy/`、`.claude/settings.local.json` —— 编辑器个人配置
- `2026调研报告.docx` —— 25MB 参考资料，留在本地

规则写法：`目录名/` 排除整个目录，`*.log` 按扩展名排除，前面加 `!` 表示例外（如 `!.env.example`）。

## 七、分支（团队协作时用）

```bash
git switch -c feature/growth-plan   # 新建并切换到新分支
git switch main                     # 切回主分支
git branch                          # 查看所有本地分支（* 是当前所在）
git push -u origin feature/growth-plan   # 把新分支推上去
```

规范做法：**不在 main 上直接开发**。新功能开新分支 → 推送 → 在 GitHub 提 Pull Request → 评审后合并。

## 八、这个项目的现状

| 项目 | 值 |
|---|---|
| 远程仓库 | https://github.com/PoloQi/xiaoban-agent |
| 主分支 | `main` |
| SSH 认证 | 已配置（`~/.ssh/id_rsa`），无需输密码 |
| 首次提交 | `8dce7aa`，216 个文件 |

查看效果：浏览器打开 https://github.com/PoloQi/xiaoban-agent
