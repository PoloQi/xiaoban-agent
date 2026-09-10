import { isDeepStrictEqual } from "node:util";

import type { Kysely, Transaction } from "kysely";

import type { DatabaseSchema } from "./types.js";

const AUTHOR_ID = "d2300000-0000-4000-8000-000000000101";
const REVIEWER_ID = "d2300000-0000-4000-8000-000000000102";
const CREATED_AT = new Date("2026-08-21T00:00:00.000Z");
const VALID_FROM = new Date("2026-08-01T00:00:00.000Z");
const EXPIRES_AT = new Date("2027-12-31T00:00:00.000Z");
const SOURCE_LABEL = "小伴开发合成内容";
const LEGACY_SOURCE_LABEL = "小伴竞赛合成内容";
const REVIEW_REASON = "项目内部审核的开发合成内容，仅供本地验收，不代表儿童试点专业审核。";
const LEGACY_REVIEW_REASON = "项目内部审核的竞赛合成内容，仅供成人演示，不代表儿童试点专业审核。";

export const DEV_CONTENT_SEEDS = [
  {
    item: {
      id: "d2300000-0000-4000-8000-000000000001",
      contentType: "knowledge" as const,
      slug: "demo-screen-break-guide",
    },
    version: {
      id: "d2300000-0000-4000-8000-000000000002",
      title: "屏幕休息方法",
      summary: "完成一件事后，把注意力从屏幕移到远处，给自己一个短暂停顿。",
      body: {
        topic: "general_growth",
        paragraphs: [
          "屏幕里的内容会一直更新，但你可以主动决定什么时候停一下。",
          "先把设备放稳，看向窗外或房间较远处，慢慢数二十秒。",
          "然后喝口水，伸展肩膀，再决定继续还是去做别的事。",
        ],
      },
      riskTags: ["general_information"],
    },
    reviewId: "d2300000-0000-4000-8000-000000000003",
  },
  {
    item: {
      id: "d2300000-0000-4000-8000-000000000011",
      contentType: "activity" as const,
      slug: "demo-five-minute-indoor-observation",
    },
    version: {
      id: "d2300000-0000-4000-8000-000000000012",
      title: "五分钟室内观察",
      summary: "放下屏幕，在安全的位置找到三样之前没注意的东西。",
      body: {
        durationMinutes: 5,
        location: "indoor",
        materials: [],
        adultSupervision: "none",
        steps: [
          "把屏幕放稳，确认周围没有容易绊倒的东西。",
          "在房间里慢慢走一小圈，找出三样之前没注意的颜色或形状。",
          "回到座位，说出或写下其中一个小发现。",
        ],
      },
      riskTags: ["general_information"],
    },
    reviewId: "d2300000-0000-4000-8000-000000000013",
  },
  {
    item: {
      id: "d2300000-0000-4000-8000-000000000021",
      contentType: "knowledge" as const,
      slug: "demo-feelings-and-friendship",
    },
    version: {
      id: "d2300000-0000-4000-8000-000000000022",
      title: "心情与相处",
      summary: "孤单、冲突或被排斥时，先照顾心情，再选择怎样开口。",
      body: {
        topic: "emotional_social",
        paragraphs: [
          "别人暂时不和你一起玩，不等于你不重要。先让自己离开争执，慢慢呼吸几次。",
          "等情绪平一点，可以用“我有点难过，想知道发生了什么”来问清楚。",
          "如果被排斥持续发生，或者有人故意羞辱你，要把经过告诉老师或其他可信任的大人。",
        ],
        quiz: {
          sceneId: "friend-needs-space",
          sceneLabel: "相处练习 · 01",
          scenario: "课间时，你想加入同学的游戏，对方说：“今天想先两个人玩。”你会怎么做？",
          options: [
            { id: "keep-pushing", text: "一直追着问，直到对方同意为止" },
            { id: "pause-and-ask", text: "先停一下做别的事，之后平静地问清楚" },
            { id: "blame-yourself", text: "马上认定大家都不喜欢自己" },
          ],
          correctOptionId: "pause-and-ask",
          correctTitle: "这个选择更照顾自己和别人。",
          incorrectTitle: "先停一下，可能会更有帮助。",
          explanation: "给彼此一点空间，再用清楚的话表达感受，比追问或责怪自己更容易了解真实情况。",
          actionSteps: [
            "先离开争执，让情绪慢慢平下来。",
            "之后用“我有点难过，想知道发生了什么”来问。",
            "如果持续被排斥或羞辱，告诉老师或其他可信任的大人。",
          ],
        },
      },
      riskTags: ["general_information"],
    },
    reviewId: "d2300000-0000-4000-8000-000000000023",
  },
  {
    item: {
      id: "d2300000-0000-4000-8000-000000000031",
      contentType: "knowledge" as const,
      slug: "demo-online-safety-basics",
    },
    version: {
      id: "d2300000-0000-4000-8000-000000000032",
      title: "网络与人身安全",
      summary: "遇到隐私索取、诈骗、陌生网友或危险挑战时，先停下来。",
      body: {
        topic: "digital_safety",
        paragraphs: [
          "刚认识的网友不是经过验证的熟人，不要发送家庭地址、学校、电话、验证码或证件信息。",
          "对方用礼物、保密或“证明够朋友”来催促时，可以直接停止发送并退出聊天。",
          "保存必要证据后，把事情告诉身边可信任的大人，不需要自己一个人处理。",
        ],
        quiz: {
          sceneId: "stranger-asks-address",
          sceneLabel: "网络练习 · 01",
          scenario: "刚认识的网友说：“把你家地址发给我，我给你寄礼物。”你会怎么做？",
          options: [
            { id: "send-address", text: "把地址发给他，证明自己够朋友" },
            { id: "stop-and-tell", text: "先不发送，退出聊天并告诉可信任的大人" },
            { id: "send-school", text: "只发学校名字，不发家庭地址" },
          ],
          correctOptionId: "stop-and-tell",
          correctTitle: "这个选择更安全。",
          incorrectTitle: "这个选择仍可能泄露隐私。",
          explanation: "地址、学校、电话、验证码和证件信息都不要发给陌生网友。礼物不是交换个人信息的理由。",
          actionSteps: [
            "先不要发送任何个人信息。",
            "退出聊天，保存必要证据，不继续争辩。",
            "尽快告诉身边可信任的大人。",
          ],
        },
      },
      riskTags: ["digital_safety"],
    },
    reviewId: "d2300000-0000-4000-8000-000000000033",
  },
  {
    item: {
      id: "d2300000-0000-4000-8000-000000000041",
      contentType: "knowledge" as const,
      slug: "demo-body-boundaries",
    },
    version: {
      id: "d2300000-0000-4000-8000-000000000042",
      title: "身体与边界保护",
      summary: "认识让自己不舒服的身体边界，练习拒绝、离开和求助。",
      body: {
        topic: "body_boundaries",
        paragraphs: [
          "当别人的接触或要求让你不舒服时，你可以说“不”，这不是没礼貌。",
          "不要因为对方要求保密就独自承担。尽快离开不安全的位置，去有人在的地方。",
          "把事情告诉可信任的大人；如果第一个人没有认真听，可以继续告诉另一个大人。",
        ],
        quiz: {
          sceneId: "uncomfortable-secret",
          sceneLabel: "边界练习 · 01",
          scenario: "有人用让你不舒服的方式拉着你，还说：“这是秘密，不能告诉别人。”你会怎么做？",
          options: [
            { id: "keep-secret", text: "答应保密，继续留在原地" },
            { id: "leave-and-tell", text: "明确说不，尽快离开并告诉可信任的大人" },
            { id: "wait-alone", text: "先忍着，等对方自己停下来" },
          ],
          correctOptionId: "leave-and-tell",
          correctTitle: "拒绝、离开和求助是正确行动。",
          incorrectTitle: "你不需要独自忍受或保守这种秘密。",
          explanation: "让你不舒服的接触和要求不需要保密。保护自己的边界，比照顾对方的面子更重要。",
          actionSteps: [
            "清楚地说“不”或“停下来”。",
            "尽快去有其他人在的安全地方。",
            "告诉可信任的大人；没有被认真听见时，继续告诉另一个大人。",
          ],
        },
      },
      riskTags: ["general_information"],
    },
    reviewId: "d2300000-0000-4000-8000-000000000043",
  },
] as const;

type DevContentSeed = (typeof DEV_CONTENT_SEEDS)[number];

export class DevContentSeedConflictError extends Error {
  constructor(readonly reason = "identity_collision") {
    super(`Dev content seed conflicts with existing data: ${reason}.`);
    this.name = "DevContentSeedConflictError";
  }
}

function dateMatches(value: Date, expected: Date): boolean {
  return value.getTime() === expected.getTime();
}

function parseJsonValue(value: unknown): unknown {
  if (Buffer.isBuffer(value)) {
    return JSON.parse(value.toString("utf8"));
  }
  if (typeof value === "string") {
    return JSON.parse(value);
  }
  return value;
}

function jsonMatches(value: unknown, expected: unknown): boolean {
  try {
    return isDeepStrictEqual(parseJsonValue(value), expected);
  } catch {
    return false;
  }
}

async function findItemCollision(
  transaction: Transaction<DatabaseSchema>,
  seed: DevContentSeed,
) {
  const bySlug = await transaction
    .selectFrom("content_items")
    .selectAll()
    .where("slug", "=", seed.item.slug)
    .executeTakeFirst();
  if (bySlug !== undefined) {
    return bySlug;
  }
  return transaction
    .selectFrom("content_items")
    .selectAll()
    .where("id", "=", seed.item.id)
    .executeTakeFirst();
}

async function existingSeedMismatch(
  transaction: Transaction<DatabaseSchema>,
  seed: DevContentSeed,
): Promise<string | undefined> {
  const item = await findItemCollision(transaction, seed);
  const itemChecks: Array<[string, boolean]> = [
    ["item_missing", item !== undefined],
    ["item_id", item?.id === seed.item.id],
    ["item_type", item?.content_type === seed.item.contentType],
    ["item_slug", item?.slug === seed.item.slug],
    ["item_status", item?.lifecycle_status === "published"],
    ["item_active_version", item?.active_version_id === seed.version.id],
  ];
  const itemMismatch = itemChecks.find(([, matches]) => !matches);
  if (itemMismatch !== undefined) {
    return itemMismatch[0];
  }

  const version = await transaction
    .selectFrom("content_versions")
    .selectAll()
    .where("id", "=", seed.version.id)
    .executeTakeFirst();
  const review = await transaction
    .selectFrom("content_reviews")
    .selectAll()
    .where("id", "=", seed.reviewId)
    .executeTakeFirst();

  const checks: Array<[string, boolean]> = [
    ["version_missing", version !== undefined],
    ["version_item", version?.item_id === seed.item.id],
    ["version_number", version?.version_number === 1],
    ["version_status", version?.review_status === "approved"],
    ["version_title", version?.title === seed.version.title],
    ["version_summary", version?.summary === seed.version.summary],
    ["version_body", jsonMatches(version?.content_body, seed.version.body)],
    ["version_age_band", version?.age_band === "both"],
    ["version_source_kind", version?.source_kind === "synthetic_test"],
    [
      "version_source_label",
      version?.source_label === SOURCE_LABEL || version?.source_label === LEGACY_SOURCE_LABEL,
    ],
    ["version_source_url", version?.source_url === null],
    ["version_valid_from", version !== undefined && dateMatches(version.valid_from, VALID_FROM)],
    ["version_expires_at", version !== undefined && dateMatches(version.expires_at, EXPIRES_AT)],
    ["version_risk_tags", jsonMatches(version?.risk_tags, seed.version.riskTags)],
    ["version_author", version?.author_id === AUTHOR_ID],
    ["review_missing", review !== undefined],
    ["review_version", review?.version_id === seed.version.id],
    ["review_author", review?.author_id === AUTHOR_ID],
    ["review_reviewer", review?.reviewer_id === REVIEWER_ID],
    ["review_decision", review?.decision === "approved"],
    [
      "review_reason",
      review?.reason === REVIEW_REASON || review?.reason === LEGACY_REVIEW_REASON,
    ],
  ];
  return checks.find(([, matches]) => !matches)?.[0];
}

async function seedOne(
  transaction: Transaction<DatabaseSchema>,
  seed: DevContentSeed,
): Promise<"created" | "existing"> {
  const itemCollision = await findItemCollision(transaction, seed);
  if (itemCollision !== undefined) {
    const mismatch = await existingSeedMismatch(transaction, seed);
    if (mismatch === undefined) {
      return "existing";
    }
    throw new DevContentSeedConflictError(mismatch);
  }

  const versionCollision = await transaction
    .selectFrom("content_versions")
    .select("id")
    .where("id", "=", seed.version.id)
    .executeTakeFirst();
  const reviewCollision = await transaction
    .selectFrom("content_reviews")
    .select("id")
    .where("id", "=", seed.reviewId)
    .executeTakeFirst();
  if (versionCollision !== undefined || reviewCollision !== undefined) {
    throw new DevContentSeedConflictError();
  }

  await transaction.insertInto("content_items").values({
    id: seed.item.id,
    content_type: seed.item.contentType,
    slug: seed.item.slug,
    lifecycle_status: "draft",
    active_version_id: null,
    created_at: CREATED_AT,
    updated_at: CREATED_AT,
  }).execute();
  await transaction.insertInto("content_versions").values({
    id: seed.version.id,
    item_id: seed.item.id,
    version_number: 1,
    review_status: "approved",
    title: seed.version.title,
    summary: seed.version.summary,
    content_body: JSON.stringify(seed.version.body),
    age_band: "both",
    source_kind: "synthetic_test",
    source_label: SOURCE_LABEL,
    source_url: null,
    valid_from: VALID_FROM,
    expires_at: EXPIRES_AT,
    risk_tags: JSON.stringify(seed.version.riskTags),
    author_id: AUTHOR_ID,
    created_at: CREATED_AT,
  }).execute();
  await transaction.insertInto("content_reviews").values({
    id: seed.reviewId,
    version_id: seed.version.id,
    author_id: AUTHOR_ID,
    reviewer_id: REVIEWER_ID,
    decision: "approved",
    reason: REVIEW_REASON,
    created_at: CREATED_AT,
  }).execute();
  await transaction
    .updateTable("content_items")
    .set({ lifecycle_status: "published", active_version_id: seed.version.id })
    .where("id", "=", seed.item.id)
    .execute();
  return "created";
}

export async function seedDevContent(
  database: Kysely<DatabaseSchema>,
): Promise<{ created: number; existing: number }> {
  return database.transaction().execute(async (transaction) => {
    let created = 0;
    let existing = 0;
    for (const seed of DEV_CONTENT_SEEDS) {
      const result = await seedOne(transaction, seed);
      if (result === "created") {
        created += 1;
      } else {
        existing += 1;
      }
    }
    return { created, existing };
  });
}
