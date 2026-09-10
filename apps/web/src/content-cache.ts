import {
  ageBandSchema,
  childContentDetailSchema,
  childContentListResponseSchema,
  contentSlugSchema,
  type AgeBand,
  type ChildContentDetail,
  type ChildContentListResponse,
} from "@xiaoban/contracts";
import { z } from "zod";

const CACHE_KEY = "xiaoban.child.content-cache.v1";
const MAX_CACHE_AGE_MS = 24 * 60 * 60 * 1_000;

const cacheSchema = z.object({
  schemaVersion: z.literal(1),
  ageBand: ageBandSchema,
  cachedAt: z.iso.datetime(),
  list: childContentListResponseSchema,
  details: z.record(contentSlugSchema, childContentDetailSchema),
}).strict();

type ChildContentCache = z.infer<typeof cacheSchema>;

export interface CachedValue<T> {
  cachedAt: string;
  value: T;
}

function isFresh(cache: ChildContentCache, now: Date): boolean {
  const cachedAt = Date.parse(cache.cachedAt);
  return Number.isFinite(cachedAt) && cachedAt <= now.getTime()
    && now.getTime() - cachedAt <= MAX_CACHE_AGE_MS;
}

function read(ageBand: AgeBand, now: Date): ChildContentCache | null {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (raw === null) return null;
    const parsed = cacheSchema.safeParse(JSON.parse(raw));
    if (!parsed.success || parsed.data.ageBand !== ageBand || !isFresh(parsed.data, now)) {
      sessionStorage.removeItem(CACHE_KEY);
      return null;
    }
    return parsed.data;
  } catch {
    sessionStorage.removeItem(CACHE_KEY);
    return null;
  }
}

function write(cache: ChildContentCache): void {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(cacheSchema.parse(cache)));
  } catch {
    sessionStorage.removeItem(CACHE_KEY);
  }
}

export function readCachedContentList(
  ageBand: AgeBand,
  now = new Date(),
): CachedValue<ChildContentListResponse> | null {
  const cache = read(ageBand, now);
  if (cache === null) return null;
  const items = cache.list.items.filter((item) => Date.parse(item.expiresAt) > now.getTime());
  if (cache.list.items.length > 0 && items.length === 0) return null;
  return {
    cachedAt: cache.cachedAt,
    value: {
      ...cache.list,
      items,
      pagination: { ...cache.list.pagination, offset: 0, total: items.length },
    },
  };
}

export function writeCachedContentList(
  ageBand: AgeBand,
  list: ChildContentListResponse,
  now = new Date(),
): void {
  const parsedList = childContentListResponseSchema.parse(list);
  const previous = read(ageBand, now);
  const revisions = new Map(parsedList.items.map((item) => [item.slug, item.revision]));
  const details = Object.fromEntries(
    Object.entries(previous?.details ?? {}).filter(([slug, detail]) =>
      revisions.get(slug) === detail.revision && Date.parse(detail.expiresAt) > now.getTime()),
  );
  write({
    schemaVersion: 1,
    ageBand,
    cachedAt: now.toISOString(),
    list: parsedList,
    details,
  });
}

export function readCachedContentDetail(
  ageBand: AgeBand,
  slug: string,
  revision: string,
  now = new Date(),
): CachedValue<ChildContentDetail> | null {
  const cache = read(ageBand, now);
  const detail = cache?.details[slug];
  if (
    cache === null || detail === undefined || detail.revision !== revision
    || Date.parse(detail.expiresAt) <= now.getTime()
  ) return null;
  return { cachedAt: cache.cachedAt, value: detail };
}

export function writeCachedContentDetail(
  ageBand: AgeBand,
  detail: ChildContentDetail,
  now = new Date(),
): void {
  const cache = read(ageBand, now);
  const parsedDetail = childContentDetailSchema.parse(detail);
  const matchingSummary = cache?.list.items.find((item) => item.slug === detail.slug);
  if (cache === null || matchingSummary?.revision !== parsedDetail.revision) return;
  write({
    ...cache,
    details: { ...cache.details, [parsedDetail.slug]: parsedDetail },
  });
}

export function clearChildContentCache(): void {
  sessionStorage.removeItem(CACHE_KEY);
}
