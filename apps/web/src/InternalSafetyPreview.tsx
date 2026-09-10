const FIXED_ACTIONS = [
  "先离开危险位置，去有其他人的安全地方。",
  "马上告诉身边可信任的成年人，并清楚说明危险正在发生。",
  "如果危险仍在继续，直接向现场成年人求助，不要独自处理。",
] as const;

function StopMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 48 48" className="safety-preview-stop-mark">
      <circle cx="24" cy="24" r="19" />
      <path d="M17 17 31 31M31 17 17 31" />
    </svg>
  );
}

export function InternalSafetyPreview() {
  function exitPreview() {
    window.location.assign("/");
  }

  return (
    <div className="safety-preview-shell">
      <header className="safety-preview-header">
        <div className="safety-preview-brand">
          <span className="safety-preview-index">05E</span>
          <div>
            <strong>小伴 · 安全值守台</strong>
            <small>LOCAL SYNTHETIC PREVIEW</small>
          </div>
        </div>
        <button className="safety-preview-exit" type="button" onClick={exitPreview}>
          退出内部预览
        </button>
      </header>

      <main className="safety-preview-main">
        <section className="safety-preview-status" aria-labelledby="generation-status-title">
          <div className="safety-preview-status-copy">
            <p className="safety-preview-eyebrow">GLOBAL GENERATION CONTROL</p>
            <div className="safety-preview-title-row">
              <StopMark />
              <div>
                <p className="safety-preview-signal">停止态 · 默认安全</p>
                <h1 id="generation-status-title">全局生成已停止</h1>
              </div>
            </div>
            <p className="safety-preview-status-note">
              AI去标识化、检索与模型调用均不会开始。数据库读取异常时保持同一停止结果。
            </p>
          </div>
          <dl className="safety-preview-metrics" aria-label="生成控制状态">
            <div><dt>作用域</dt><dd>GLOBAL</dd></div>
            <div><dt>状态来源</dt><dd>PERSISTED</dd></div>
            <div><dt>控制版本</dt><dd>v1</dd></div>
            <div><dt>通知</dt><dd>未发送</dd></div>
          </dl>
        </section>

        <div className="safety-preview-grid">
          <section className="safety-preview-incident" aria-labelledby="fixed-safety-title">
            <div className="safety-preview-section-heading">
              <div>
                <p className="safety-preview-eyebrow">FIXED SAFETY RESPONSE · SYNTHETIC</p>
                <h2 id="fixed-safety-title">先去安全、有其他人的地方</h2>
              </div>
              <span className="safety-preview-level">L3</span>
            </div>

            <p className="safety-preview-category">
              <span>固定分流</span>
              active_danger
            </p>

            <ol className="safety-preview-actions">
              {FIXED_ACTIONS.map((action, index) => (
                <li key={action}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <p>{action}</p>
                </li>
              ))}
            </ol>

            <div className="safety-preview-boundary" role="note">
              <strong>界面边界</strong>
              <p>这是固定文案的本地合成预览；没有真实儿童输入、事件写入、通知或处置承诺。</p>
            </div>
          </section>

          <aside className="safety-preview-rail" aria-label="值守说明">
            <section>
              <p className="safety-preview-eyebrow">CONTROL AUTHORITY</p>
              <h2>控制动作未开放</h2>
              <p>恢复生成必须由安全值守角色在服务端完成认证、填写受控理由并留下不可变更历史。</p>
              <button type="button" disabled>需要安全值守认证</button>
            </section>

            <section>
              <p className="safety-preview-eyebrow">FAIL-CLOSED RULE</p>
              <h2>控制状态不可读</h2>
              <p className="safety-preview-rule">UNKNOWN → STOP</p>
              <p>数据库超时、记录缺失或契约异常均不得降级为继续生成。</p>
            </section>

            <section className="safety-preview-checks">
              <p className="safety-preview-eyebrow">VISIBLE EVIDENCE</p>
              <ul>
                <li><span />固定安全步骤</li>
                <li><span />通知状态明确</li>
                <li><span />无真实身份数据</li>
              </ul>
            </section>
          </aside>
        </div>
      </main>

      <footer className="safety-preview-footer">
        <span>阶段 5E · 内部开发预览</span>
        <span>未接入公开导航 · 未提供真实控制接口</span>
      </footer>
    </div>
  );
}
