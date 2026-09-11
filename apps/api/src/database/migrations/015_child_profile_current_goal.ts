import { sql, type Kysely } from "kysely";

/**
 * 成长目标编辑：在 child_profiles 增加 current_goal_id 字段。
 *
 * 语义：
 * - current_goal_id 是 VARCHAR(64)，枚举值见 @xiaoban/contracts 的 childGrowthGoalKeySchema。
 * - 服务端在 buildPlan 时优先读 current_goal_id；未设置时回落到 DEFAULT_CHILD_GROWTH_GOAL_KEY。
 * - 既有数据回填：所有现有 child_profiles 默认持有 DEFAULT_CHILD_GROWTH_GOAL_KEY = "screen-free-bedtime-30m"，
 *   与旧版写死的 CHILD_GROWTH_GOAL_KEY 行为一致，不改变既有 13 条迁移产出的基线。
 * - 不修改其他表结构；不扩张真实通知；不写日志。
 *
 * 安全：
 * - 字段允许 NULL 表示"从未切换过"，符合前端「未修改过」语义。
 * - 没有任何真实儿童信息；不会向任何下游发送数据。
 */
export async function up(database: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE child_profiles
      ADD COLUMN current_goal_id VARCHAR(64) NULL AFTER updated_at
  `.execute(database);
  await sql`
    UPDATE child_profiles
      SET current_goal_id = 'screen-free-bedtime-30m'
      WHERE current_goal_id IS NULL
  `.execute(database);
}

export async function down(database: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE child_profiles DROP COLUMN current_goal_id`.execute(database);
}