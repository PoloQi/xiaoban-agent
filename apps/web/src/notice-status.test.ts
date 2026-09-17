import { describe, expect, it } from "vitest";

import { selectNoticeContent } from "./notice-status";

describe("notice status downgrade copy", () => {
  it.each(["unavailable", "waiting"] as const)("never implies success for %s", (variant) => {
    for (const audience of ["guardian", "child"] as const) {
      const content = selectNoticeContent(variant, audience);
      const text = `${content.headline}${content.message}${content.action}`;
      expect(text).not.toMatch(/已送达|已发送成功|已查看|已确认/);
      expect(content.action).toContain("当面");
    }
  });
});
