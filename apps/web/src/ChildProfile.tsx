import { useState, type ReactNode } from "react";

import { COMPANION_COPY, CompanionIllustration } from "./companion";
import { childProfileLabels, type CompletedChildProfile } from "./profile";
import "./child-profile.css";

interface ChildProfileProps {
  profile: CompletedChildProfile;
  onOpenKnowledge: () => void;
  onOpenTrusted: () => void;
  onOpenAdult?: () => Promise<void>;
}

function ProfileIcon({ children }: { children: ReactNode }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24">{children}</svg>;
}

export function ChildProfile({ profile, onOpenKnowledge, onOpenTrusted, onOpenAdult }: ChildProfileProps) {
  const labels = childProfileLabels(profile);
  const companion = COMPANION_COPY[profile.companion];
  const [adultState, setAdultState] = useState<"idle" | "loading" | "error">("idle");

  async function openAdult() {
    if (onOpenAdult === undefined) return;
    setAdultState("loading");
    try {
      await onOpenAdult();
    } catch {
      setAdultState("error");
    }
  }

  return (
    <section className="child-profile-page" aria-labelledby="child-profile-title">
      <header className="child-profile-heading">
        <div>
          <p>PERSONAL FIELD NOTE · 个人空间</p>
          <h1 id="child-profile-title">这是你的<br /><em>成长手账封面。</em></h1>
        </div>
        <span><ProfileIcon><path d="M12 3 19 6v5c0 4.5-2.5 8-7 10-4.5-2-7-5.5-7-10V6Z" /><path d="m9 12 2 2 4-5" /></ProfileIcon>资料来自进入引导</span>
      </header>

      <article className="child-profile-hero">
        <div className="child-profile-avatar"><CompanionIllustration companion={profile.companion} /></div>
        <div className="child-profile-hero-copy">
          <p><span aria-hidden="true" />AI 成长伙伴</p>
          <h2>{profile.alias}<small>和</small>{companion.name}</h2>
          <div>{labels.grade}<i aria-hidden="true" />喜欢{labels.interests.join("、")}</div>
        </div>
        <span className="child-profile-index" aria-hidden="true">01</span>
      </article>

      <section className="child-profile-sheet" aria-labelledby="basic-profile-title">
        <div className="child-profile-sheet-heading">
          <div><p>PROFILE · READ ONLY</p><h2 id="basic-profile-title">我的基础资料</h2></div>
          <span>目前只查看</span>
        </div>

        <dl className="child-profile-grid">
          <div>
            <dt><span><ProfileIcon><circle cx="12" cy="8" r="3" /><path d="M6 20c.5-4.5 2.5-7 6-7s5.5 2.5 6 7" /></ProfileIcon></span>昵称</dt>
            <dd>{profile.alias}</dd>
          </div>
          <div>
            <dt><span><ProfileIcon><path d="M5 5h14v14H5zM8 2v6M16 2v6M8 12h8M8 16h5" /></ProfileIcon></span>年级</dt>
            <dd>{labels.grade}</dd>
          </div>
          <div className="child-profile-wide">
            <dt><span><ProfileIcon><path d="M20 4C11 4 5 9 5 18c6 1 13-3 15-14Z" /><path d="M5 20c4-6 8-10 13-14" /></ProfileIcon></span>兴趣</dt>
            <dd className="child-profile-tags">{labels.interests.map((interest) => <span key={interest}>{interest}</span>)}</dd>
          </div>
          <div className="child-profile-wide child-profile-companion-row">
            <dt><span><ProfileIcon><path d="M5 5h14v10H9l-4 4Z" /><path d="M9 9h6M9 12h4" /></ProfileIcon></span>我的 AI 伙伴</dt>
            <dd><strong>{companion.name}</strong><small>{companion.description}</small></dd>
          </div>
        </dl>
      </section>

      <button className="child-profile-knowledge child-profile-trusted" type="button" onClick={onOpenTrusted}>
        <span><ProfileIcon><circle cx="9" cy="8" r="3" /><path d="M3 20c.4-4.3 2.3-6.8 6-6.8s5.6 2.5 6 6.8" /><path d="M16 6.5a3 3 0 0 1 0 5.6M17.5 20c-.2-2.2-.7-3.9-1.6-5" /></ProfileIcon></span>
        <span><small>TRUSTED ADULTS</small><strong>可信任的大人</strong><em>经过家人确认的真人，可以现在就去找</em></span>
        <ProfileIcon><path d="M5 12h14" /><path d="m14 7 5 5-5 5" /></ProfileIcon>
      </button>

      <button className="child-profile-knowledge" type="button" onClick={onOpenKnowledge}>
        <span><ProfileIcon><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H11v16H6.5A2.5 2.5 0 0 0 4 21.5Z" /><path d="M20 5.5A2.5 2.5 0 0 0 17.5 3H13v16h4.5A2.5 2.5 0 0 1 20 21.5Z" /></ProfileIcon></span>
        <span><small>KNOWLEDGE CENTER</small><strong>安全成长小站</strong><em>心情、安全与身体边界的情景小练习</em></span>
        <ProfileIcon><path d="M5 12h14" /><path d="m14 7 5 5-5 5" /></ProfileIcon>
      </button>

      {onOpenAdult !== undefined && (
        <section className="child-profile-adult-entry">
          <div><small>LOCAL SYNTHETIC GUARDIAN</small><strong>预览监护端</strong><p>使用已核验的本地合成监护关系进入成人四导航。</p></div>
          <button type="button" disabled={adultState === "loading"} onClick={() => void openAdult()}>{adultState === "loading" ? "正在核验…" : "进入监护端"}</button>
          {adultState === "error" && <span role="alert">暂时无法核验监护身份，请稍后重试。</span>}
        </section>
      )}

      <aside className="child-profile-boundary">
        <ProfileIcon><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></ProfileIcon>
        <p><strong>这里只显示你主动保存的基础资料。</strong>不会读取通讯录、定位或相册；“可信任的大人”只列出经过家人确认的真人，不会替你发送任何消息。</p>
      </aside>
    </section>
  );
}
