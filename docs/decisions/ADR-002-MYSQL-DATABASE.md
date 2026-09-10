# ADR-002：以 MySQL 8.4 LTS 替代 PostgreSQL

- 状态：接受；本地运行环境已达到门槛
- 日期：2026-08-17
- 替代范围：ADR-001 中的数据库选型

## 1. 结论

项目数据库由 PostgreSQL 调整为 **MySQL 8.4 LTS Community + InnoDB**。不再为当前项目建立 PostgreSQL 本地开发环境。

MySQL 在满足本文件约束时，可以覆盖首版所需的事务、行级并发、外键与检查约束、JSON、队列式 outbox 领取、Unicode 和 UTC 时间处理。项目尚未建立数据库代码或业务表，因此当前变更没有数据迁移成本。

本机现有 **MySQL 8.0.40 不作为项目基线**。MySQL 官方已说明 8.0 系列于 2026 年 4 月达到 EOL，并建议升级至 MySQL 8.4 LTS 或 Innovation 版本。项目需要稳定版本线，因此选择 8.4 LTS，不选择短周期 Innovation 版本。

## 2. 本机只读核验

2026-08-17 的只读检查结果：

| 检查项 | 结果 |
|---|---|
| `mysql`、`mysqld`、`mysqladmin`、`mysqldump` | 已安装，路径位于 `C:\Program Files\MySQL\MySQL Server 8.0\bin` |
| 客户端与服务程序版本 | 8.0.40 Community |
| `127.0.0.1:3306` | TCP 可连接 |
| MySQL 初始握手 | 协议 10，服务端版本 8.0.40 |
| 账号、密码、库表和业务数据 | 未读取、未尝试枚举 |

该结果只证明现有服务可达，不代表其字符集、权限、备份或数据状态符合项目要求。

## 3. 能力匹配

| 项目需求 | MySQL 8.4 LTS 能力 | 结论 |
|---|---|---|
| 原子业务写入与 outbox 同事务 | InnoDB ACID 事务与行级锁 | 满足 |
| 多 worker 并发领取任务 | `SELECT ... FOR UPDATE SKIP LOCKED` | 满足；只用于队列式表 |
| 明确数据约束 | 外键、唯一索引、强制 `CHECK` | 满足 |
| 少量结构化扩展字段 | 原生 JSON 类型并自动校验 | 满足；关键字段仍使用关系列 |
| 中文和补充平面字符 | `utf8mb4` | 满足 |
| UTC 存储与微秒精度 | 会话时区 `+00:00`、`DATETIME(6)` | 满足 |
| TypeScript 驱动和迁移 | `mysql2` + Kysely Migrator | 满足 |

## 4. 强制工程约束

- 服务器版本必须是 MySQL 8.4.x LTS；8.0.x、Innovation 版本和 MariaDB 不得混用；
- 所有项目表明确使用 `ENGINE=InnoDB`；
- 数据库和连接字符集使用 `utf8mb4`，不得使用已弃用的三字节 `utf8`/`utf8mb3`；
- 连接建立后将会话时区设为 `+00:00`；业务时间优先使用 `DATETIME(6)` 并由应用按 UTC 解释；
- 可检索、权限、风险、状态和审计字段必须使用明确关系列，不把关键业务状态只放在 JSON 中；
- 代码、通知码、幂等键等需要精确比较的字段使用明确大小写敏感排序规则或二进制类型；
- outbox 领取使用有索引的状态与时间列，并在短事务中使用 `FOR UPDATE SKIP LOCKED`；
- 应用查询使用参数化语句，不拼接用户输入；
- 数据库凭据只通过后端运行环境注入，不写入仓库、前端变量、日志或开发日志；
- 生产环境禁止使用自动 `push` 直接改表，只执行评审过并纳入版本控制的迁移；
- MySQL DDL 不按多语句事务回滚设计，迁移应保持小、可前向修复，并在执行前验证备份或可重建性。

## 5. 驱动和迁移决策

- 驱动：`mysql2` Promise API，使用连接池和参数化执行；
- 类型化查询：Kysely MySQL dialect；
- 迁移：Kysely 内置 Migrator，迁移文件纳入版本控制并提供 `up`/`down`；
- 阶段1只建立连接、迁移框架和数据库就绪检查，不创建账号、会话、风险或通知业务表。

选择 Kysely 是为了保持 SQL 和迁移显式可审查，同时避免在业务模型尚未确定时引入较重的生成式 ORM 工作流。

## 6. 与 PostgreSQL 的差异控制

MySQL 不作为 PostgreSQL 的无差别语法替代。项目需主动控制以下差异：

- 不假设 PostgreSQL 原生 UUID、数组、JSONB/GIN、部分索引或行级安全策略存在；
- 权限隔离由应用状态机、最小权限数据库账号和集成测试共同保证；
- JSON 查询索引需要显式生成列或函数索引，首版优先避免；
- 需要精确大小写语义的字段不得继承默认不区分大小写排序规则；
- 数据库时间连接固定为 UTC，界面层再转换为 Asia/Shanghai。

这些差异不会阻断当前 PRD，但必须在后续表设计和权限评审中检查。

## 7. 本地开发方案与暂停条件

为避免损坏本机可能已有的 8.0.40 数据，默认方案是建立**项目专用、可删除的 MySQL 8.4 LTS 实例**：

- 不原地升级或复用未知用途的数据目录；
- 默认监听 `127.0.0.1:3307`，避免与现有 3306 冲突；
- 开发库与测试库分离，建议名称为 `xiaoban_dev` 和 `xiaoban_test`；
- 迁移账号与应用账号分离，应用账号不拥有建库和改表权限；
- 数据目录、运行文件和本地秘密均排除出版本控制；
- 仅使用合成数据。

安装或升级数据库软件会改变本机状态。开始该操作前必须再次确认下载来源、目标目录、端口和是否采用项目专用并行实例。未得到确认前，不修改现有 MySQL 服务、配置或数据目录。

2026-08-17在得到确认后已建立该方案：

- 版本：MySQL Community Server 8.4.11 LTS Windows ZIP；
- 来源：MySQL官方下载页与CDN；官网MD5 `2e833921898a9a030ea6bfe81bd811bc`匹配，本地另记录SHA-256 `a492371d687d2bab088b0062581144a0044b8964baefdf4faa579292b423d25c`；
- 运行时、数据、日志和秘密仅位于被Git忽略的`.local/`目录；
- 实例不注册Windows服务，只监听`127.0.0.1:3307`；
- `xiaoban_dev`、`xiaoban_test`均为空库，字符集为`utf8mb4`；
- 迁移、开发应用和测试应用账号按库分权，凭据由密码学安全随机数生成并限制为当前Windows用户可读；
- 已验证停止和重新启动；停止3307时现有3306仍可达。

具体命令和故障处理见`docs/08_LOCAL_MYSQL_DEVELOPMENT.md`。

## 8. 下一步验收

本地实例部分已完成。下一小批次只完成：

1. 安装`mysql2`与Kysely；
2. 通过后端环境注入连接独立开发库与测试库；
3. 建立不泄露错误的数据库就绪检查与故障测试；
4. 验证迁移框架，但不创建业务表。

## 9. 官方依据

- MySQL 8.0 EOL说明：https://downloads.mysql.com/docs/mysql-8.0-relnotes-en.a4.pdf
- MySQL 8.4.11官方下载页：https://dev.mysql.com/downloads/mysql/8.4.html
- Windows ZIP安装方式：https://dev.mysql.com/doc/refman/8.4/en/windows-choosing-package.html
- 下载包完整性验证：https://dev.mysql.com/doc/refman/8.4/en/verifying-package-integrity.html
- MySQL LTS发布模型：https://dev.mysql.com/doc/refman/8.4/en/mysql-releases.html
- InnoDB事务与行锁：https://dev.mysql.com/doc/refman/8.0/en/innodb-transaction-model.html
- `SKIP LOCKED`队列领取：https://dev.mysql.com/doc/refman/8.0/en/innodb-locking-reads.html
- MySQL 8.4 JSON：https://dev.mysql.com/doc/refman/8.4/en/json.html
- MySQL 8.4 CHECK约束：https://dev.mysql.com/doc/refman/8.4/en/create-table-check-constraints.html
- `utf8mb4`字符集：https://dev.mysql.com/doc/refman/8.4/en/charset-unicode-utf8mb4.html
- MySQL时区行为：https://dev.mysql.com/doc/refman/8.4/en/time-zone-support.html
- mysql2文档：https://sidorares.github.io/node-mysql2/docs
- Kysely MySQL dialect与迁移：https://kysely-org.github.io/kysely-apidoc/classes/MysqlDialect.html 、https://www.kysely.dev/
