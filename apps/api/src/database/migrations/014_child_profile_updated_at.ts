import { sql, type Kysely } from "kysely";

/**
 * 资料编辑：在 child_profiles 增加 updated_at 字段。
 *
 * 语义：
 * - completed_at 保持首次完成时间不变（首次进入引导时写入）。
 * - updated_at 在每次「我的 → 修改我的资料」保存后写入当前时间；首次创建时为 NULL。
 * - 不破坏既有 13 条迁移产生的 23 张业务表基线；不修改其他表的结构。
 *
 * 安全：
 * - 不存任何真实儿童信息；不写日志；不发送通知。
 * - 字段为 NULL 时前端以"未修改过"语义展示，避免猜测首次修改时间。
 */
export async function up(database: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE child_profiles
      ADD COLUMN updated_at DATETIME(6) NULL AFTER completed_at
  `.execute(database);
}

export async function down(database: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE child_profiles DROP COLUMN updated_at`.execute(database);
}
