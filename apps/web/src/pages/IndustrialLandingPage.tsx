const operatingModules = [
  {
    code: "01",
    label: "2D / DASHBOARD",
    title: "业务看板",
    description: "通过有边界的交付画布，编排指标、图表、状态与现场信息。",
    signal: "LAYOUT",
  },
  {
    code: "02",
    label: "3D / SCENE",
    title: "三维场景",
    description: "导入 GLB 或自包含 GLTF，配置节点、材质、灯光与交付视角。",
    signal: "MODEL",
  },
  {
    code: "03",
    label: "ASSET / REGISTER",
    title: "资产台账",
    description: "用稳定 assetId 关联模型节点、设备信息和业务指标。",
    signal: "ASSET",
  },
  {
    code: "04",
    label: "DATA / CONTRACT",
    title: "数据契约",
    description: "统一 REST 轮询与 WebSocket 数据的字段语义和状态边界。",
    signal: "DATA",
  },
] as const;

const deliveryStages = [
  { code: "A-01", title: "模板建项", copy: "选择行业骨架，建立项目交付边界。" },
  { code: "A-02", title: "模型导入", copy: "检查模型结构，整理节点与场景视角。" },
  { code: "A-03", title: "资产映射", copy: "以 assetId 连接模型、台账与数据。" },
  { code: "A-04", title: "看板编排", copy: "组合 2D 组件与 3D 场景。" },
  { code: "A-05", title: "现场交付", copy: "预览、校验并部署到约定环境。" },
] as const;

const deploymentFacts = [
  ["WEB", "配置台与只读运行页"],
  ["API", "身份、项目与版本接口"],
  ["DB", "配置、资产与数据契约"],
  ["S3", "模型与图片对象存储"],
] as const;

function scrollToIndustrialSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function IndustrialMark() {
  return (
    <span aria-hidden="true" className="industrial-mark">
      <i />
      <i />
      <i />
    </span>
  );
}

function FactoryTelemetryVisual() {
  return (
    <div aria-label="工厂模型、设备资产与业务数据联动示意" className="industrial-telemetry" role="img">
      <header>
        <span>SCENE / PLANT-01</span>
        <div>
          <i />
          <span>数字孪生交付视图</span>
        </div>
      </header>

      <div className="industrial-scene">
        <div className="industrial-grid-floor" />
        <div className="industrial-rail industrial-rail-a" />
        <div className="industrial-rail industrial-rail-b" />
        <div className="industrial-machine industrial-machine-a">
          <span>M-01</span>
          <i /><i /><i />
        </div>
        <div className="industrial-machine industrial-machine-b">
          <span>M-02</span>
          <i /><i />
        </div>
        <div className="industrial-machine industrial-machine-c">
          <span>M-03</span>
          <i /><i /><i />
        </div>
        <div className="industrial-selection">
          <i /><i /><i /><i />
          <span>assetId / PUMP-01</span>
        </div>
        <div className="industrial-scene-axis">
          <span>X</span>
          <span>Y</span>
          <span>Z</span>
        </div>
      </div>

      <aside className="industrial-telemetry-panel">
        <div className="industrial-panel-heading">
          <span>设备指标</span>
          <i />
        </div>
        <dl>
          <div><dt>运行状态</dt><dd>示例数据</dd></div>
          <div><dt>设备温度</dt><dd>-- °C</dd></div>
          <div><dt>实时功率</dt><dd>-- kW</dd></div>
        </dl>
        <div className="industrial-mini-chart">
          <i /><i /><i /><i /><i /><i /><i />
        </div>
      </aside>

      <footer>
        <div><span>2D</span><strong>业务信息</strong></div>
        <i />
        <div className="industrial-asset-key"><span>KEY</span><strong>assetId</strong></div>
        <i />
        <div><span>3D</span><strong>空间对象</strong></div>
      </footer>
    </div>
  );
}

function IndustrialLandingPage() {
  return (
    <main className="industrial-landing">
      <div className="industrial-topline">
        <span>FACTORY TWIN / DIGITAL DELIVERY SYSTEM</span>
        <span>2D + 3D / CUSTOMER-SITE READY</span>
      </div>

      <nav aria-label="工业风产品页导航" className="industrial-nav">
        <a aria-label="Factory Twin 工业风首页" className="industrial-brand" href="#/industrial">
          <IndustrialMark />
          <span>
            <strong>FACTORY TWIN</strong>
            <small>工业数字孪生交付平台</small>
          </span>
        </a>
        <div className="industrial-nav-links">
          <button onClick={() => scrollToIndustrialSection("industrial-modules")} type="button">核心模块</button>
          <button onClick={() => scrollToIndustrialSection("industrial-flow")} type="button">交付工序</button>
          <button onClick={() => scrollToIndustrialSection("industrial-architecture")} type="button">技术架构</button>
        </div>
        <div className="industrial-nav-actions">
          <a className="industrial-platform-entry" href="#/projects">
            进入平台
            <span aria-hidden="true">→</span>
          </a>
        </div>
      </nav>

      <section className="industrial-hero">
        <div className="industrial-hero-copy">
          <div className="industrial-location">
            <span>DELIVERY SYSTEM</span>
            <i />
            <span>FOR FACTORY PROJECTS</span>
          </div>
          <h1>
            工业现场，
            <span>一套系统完成交付。</span>
          </h1>
          <p>
            将 2D 业务看板、3D 工厂模型、资产台账与数据契约组织到同一项目中，
            为数字孪生项目提供清晰、可追溯的交付工作流。
          </p>
          <div className="industrial-hero-actions">
            <a className="industrial-primary-action" href="#/projects">
              <span>启动交付配置</span>
              <i aria-hidden="true">→</i>
            </a>
            <button onClick={() => scrollToIndustrialSection("industrial-modules")} type="button">
              浏览系统结构
            </button>
          </div>
          <ul className="industrial-specs">
            <li><span>MODEL</span><strong>GLB / GLTF</strong></li>
            <li><span>LINK</span><strong>assetId</strong></li>
            <li><span>DEPLOY</span><strong>客户现场 / 受控云</strong></li>
          </ul>
        </div>

        <FactoryTelemetryVisual />
      </section>

      <section className="industrial-signal-strip" aria-label="平台能力概览">
        <span>01 / 模板建项</span>
        <i />
        <span>02 / 模型导入</span>
        <i />
        <span>03 / 资产映射</span>
        <i />
        <span>04 / 数据绑定</span>
        <i />
        <span>05 / 预览交付</span>
      </section>

      <section className="industrial-section industrial-modules" id="industrial-modules">
        <header className="industrial-section-heading">
          <div>
            <span>SECTION / 01</span>
            <p>OPERATING MODULES</p>
          </div>
          <h2>交付控制面</h2>
          <p>每个模块职责清晰，围绕同一个项目版本协同，不维护互相漂移的重复配置。</p>
        </header>

        <div className="industrial-module-grid">
          {operatingModules.map((module) => (
            <article key={module.code}>
              <header>
                <span>{module.code}</span>
                <i />
                <small>{module.signal}</small>
              </header>
              <div className={`industrial-module-icon industrial-module-icon-${module.code}`}>
                <i /><i /><i /><i />
              </div>
              <p>{module.label}</p>
              <h3>{module.title}</h3>
              <div className="industrial-module-rule" />
              <span>{module.description}</span>
            </article>
          ))}
        </div>
      </section>

      <section className="industrial-section industrial-linkage">
        <header className="industrial-section-heading industrial-heading-dark">
          <div>
            <span>SECTION / 02</span>
            <p>ASSET DATA LINKAGE</p>
          </div>
          <h2>一条资产链路贯穿 2D 与 3D</h2>
          <p>模型节点只描述空间对象，数据契约只描述业务指标，稳定的 assetId 负责将二者准确连接。</p>
        </header>

        <div className="industrial-linkage-board">
          <article>
            <small>INPUT / A</small>
            <strong>MODEL NODE</strong>
            <span>模型节点</span>
            <p>PUMP_BODY_01</p>
          </article>
          <div className="industrial-linkage-connector"><i /><span>MAP</span><i /></div>
          <article className="industrial-linkage-core">
            <small>UNIFIED KEY</small>
            <strong>assetId</strong>
            <span>PUMP-01</span>
            <div><i /><i /><i /><i /></div>
          </article>
          <div className="industrial-linkage-connector"><i /><span>BIND</span><i /></div>
          <article>
            <small>INPUT / B</small>
            <strong>BUSINESS DATA</strong>
            <span>业务指标</span>
            <p>status / temp / power</p>
          </article>
        </div>

        <div className="industrial-linkage-status">
          <span><i />模型对象</span>
          <span><i />资产台账</span>
          <span><i />指标映射</span>
          <strong>配置关系可追溯</strong>
        </div>
      </section>

      <section className="industrial-section industrial-flow" id="industrial-flow">
        <header className="industrial-section-heading">
          <div>
            <span>SECTION / 03</span>
            <p>DELIVERY PROCEDURE</p>
          </div>
          <h2>标准交付工序</h2>
          <p>从模板建项到现场部署，每一步都有明确输入、输出与校验位置。</p>
        </header>

        <ol className="industrial-stage-list">
          {deliveryStages.map((stage, index) => (
            <li key={stage.code}>
              <header>
                <span>{stage.code}</span>
                <small>{String(index + 1).padStart(2, "0")} / 05</small>
              </header>
              <div className="industrial-stage-progress"><i /></div>
              <h3>{stage.title}</h3>
              <p>{stage.copy}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="industrial-section industrial-architecture" id="industrial-architecture">
        <header className="industrial-section-heading">
          <div>
            <span>SECTION / 04</span>
            <p>TECHNICAL ARCHITECTURE</p>
          </div>
          <h2>从前端到客户现场</h2>
          <p>前端保持同一套应用与接口契约，当前云端资源作为开发验证适配器，现场部署时替换运行与存储基础设施。</p>
        </header>

        <div className="industrial-architecture-grid">
          <article className="industrial-architecture-card">
            <header>
              <div>
                <span>ARCH / FRONTEND</span>
                <h3>前端应用架构</h3>
              </div>
              <small>REACT APPLICATION</small>
            </header>
            <div className="industrial-architecture-diagram industrial-frontend-diagram">
              <div className="industrial-arch-node industrial-arch-node-primary">
                <small>CLIENT</small>
                <strong>浏览器</strong>
                <span>交付人员配置 / 客户只读查看</span>
              </div>
              <div className="industrial-arch-arrow" aria-hidden="true">↓</div>
              <div className="industrial-arch-module-grid">
                <div><small>PUBLIC</small><strong>产品介绍</strong></div>
                <div><small>WORKSPACE</small><strong>项目配置台</strong></div>
                <div><small>2D</small><strong>看板画布</strong></div>
                <div><small>3D</small><strong>模型编辑器</strong></div>
              </div>
              <div className="industrial-arch-arrow" aria-hidden="true">↓</div>
              <div className="industrial-arch-layer">
                <strong>React + TypeScript</strong>
                <span>组件 Schema · 路由 · 状态 · API Client</span>
              </div>
              <div className="industrial-arch-split">
                <div>
                  <small>BUILD</small>
                  <strong>Vite 静态资源</strong>
                </div>
                <div>
                  <small>CONTRACT</small>
                  <strong>同源 /api</strong>
                </div>
              </div>
            </div>
            <footer>
              <span>页面按需加载</span>
              <span>模型与图片仅保存资源 ID</span>
              <span>2D / 3D 共享 assetId</span>
            </footer>
          </article>

          <article className="industrial-architecture-card industrial-onsite-card">
            <header>
              <div>
                <span>ARCH / ON-PREMISE</span>
                <h3>客户现场部署架构</h3>
              </div>
              <small>DOCKERIZED SERVICES</small>
            </header>
            <div className="industrial-architecture-diagram industrial-onsite-diagram">
              <div className="industrial-arch-node industrial-arch-node-primary">
                <small>LOCAL CLIENT</small>
                <strong>客户内网浏览器</strong>
                <span>无需访问公有云</span>
              </div>
              <div className="industrial-arch-arrow" aria-hidden="true">↓</div>
              <div className="industrial-arch-layer industrial-gateway-layer">
                <strong>Nginx / Caddy</strong>
                <span>HTTPS · 静态前端 · /api 反向代理</span>
              </div>
              <div className="industrial-arch-branch" aria-hidden="true">
                <i />
                <span>↓</span>
                <span>↓</span>
              </div>
              <div className="industrial-arch-split industrial-service-split">
                <div>
                  <small>APPLICATION</small>
                  <strong>Node.js API</strong>
                  <span>身份 · 项目 · 版本 · 数据网关</span>
                </div>
                <div>
                  <small>FRONTEND</small>
                  <strong>静态 Web</strong>
                  <span>同一份 React 构建产物</span>
                </div>
              </div>
              <div className="industrial-arch-arrow" aria-hidden="true">↓</div>
              <div className="industrial-storage-row">
                <div><small>DATABASE</small><strong>PostgreSQL</strong><span>配置与权限</span></div>
                <div><small>OBJECT</small><strong>MinIO</strong><span>模型与图片</span></div>
                <div><small>CONNECTOR</small><strong>数据网关</strong><span>REST / WebSocket</span></div>
              </div>
              <div className="industrial-field-source">
                <span>客户业务 API</span>
                <i />
                <span>MES / ERP / IoT 平台</span>
              </div>
            </div>
            <footer className="industrial-migration-map">
              <span><small>当前</small> Worker <i>→</i> Node.js API</span>
              <span><small>当前</small> D1 <i>→</i> PostgreSQL</span>
              <span><small>当前</small> R2 <i>→</i> MinIO</span>
            </footer>
          </article>
        </div>
      </section>

      <section className="industrial-section industrial-deployment" id="industrial-deployment">
        <div className="industrial-deployment-copy">
          <span>SECTION / 05 — DEPLOYMENT</span>
          <h2>工具用于交付，<br />系统落在客户需要的位置。</h2>
          <p>
            当前可以在受控云环境中快速开发和验证；正式项目可将前端、API、数据库与对象存储适配到客户服务器或内网。
          </p>
          <a href="#/projects">进入交付平台 <span aria-hidden="true">→</span></a>
        </div>

        <div className="industrial-deployment-rack">
          <header>
            <span>CUSTOMER SITE / SYSTEM RACK</span>
            <div><i /><i /><i /></div>
          </header>
          <div className="industrial-rack-body">
            {deploymentFacts.map(([code, copy]) => (
              <div key={code}>
                <strong>{code}</strong>
                <span>{copy}</span>
                <i />
              </div>
            ))}
          </div>
          <footer>
            <span>LOCAL NETWORK</span>
            <i />
            <span>CONTROLLED BOUNDARY</span>
          </footer>
        </div>
      </section>

      <section className="industrial-final">
        <div className="industrial-final-index">
          <span>READY / WHEN YOU ARE</span>
          <strong>FT-2026</strong>
        </div>
        <div>
          <p>FACTORY DIGITAL TWIN DELIVERY</p>
          <h2>让下一次现场交付，<br />从一套清晰的系统开始。</h2>
        </div>
        <a href="#/projects">
          进入平台
          <span aria-hidden="true">↗</span>
        </a>
      </section>

      <footer className="industrial-footer">
        <a className="industrial-brand" href="#/industrial">
          <IndustrialMark />
          <span>
            <strong>FACTORY TWIN</strong>
            <small>2D + 3D INDUSTRIAL DELIVERY PLATFORM</small>
          </span>
        </a>
        <p>模型 · 资产 · 数据 · 看板</p>
        <span>© 2026 / FACTORY TWIN</span>
      </footer>
    </main>
  );
}

export default IndustrialLandingPage;
