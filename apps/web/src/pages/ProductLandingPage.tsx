const capabilityCards = [
  {
    number: "01",
    label: "2D DASHBOARD",
    title: "把业务数据变成一眼可读的大屏",
    description:
      "固定比例交付画布，内置图表、指标、进度、状态与装饰组件。模板、布局和主题都能复用，适配指挥中心、生产运营与设备保障场景。",
    tags: ["1920 × 1080", "多主题联动", "模板复用"],
  },
  {
    number: "02",
    label: "3D DIGITAL TWIN",
    title: "让模型、设备与业务资产真正对应",
    description:
      "导入 GLB 或自包含 GLTF 模型，完成节点选择、变换、材质、灯光与视角配置，再把模型节点绑定到稳定的业务资产编号。",
    tags: ["GLB / GLTF", "节点级编辑", "资产映射"],
  },
] as const;

const deliverySteps = [
  {
    index: "01",
    title: "选择行业模板",
    description: "从标准大屏骨架开始，避免每个项目重复搭底座。",
  },
  {
    index: "02",
    title: "导入工厂模型",
    description: "上传标准 3D 资源并整理模型节点、材质和视角。",
  },
  {
    index: "03",
    title: "建立资产台账",
    description: "用稳定 assetId 连接设备、模型节点与业务数据。",
  },
  {
    index: "04",
    title: "配置数据契约",
    description: "配置 REST 或 WebSocket 元数据与指标字段映射。",
  },
  {
    index: "05",
    title: "预览与交付",
    description: "交付人员配置，客户侧聚焦只读查看与业务使用。",
  },
] as const;

const productAdvantages = [
  {
    mark: "快",
    title: "更快形成可演示成果",
    description: "模板、组件和主题沉淀为公共能力，新项目无需从空白画布起步。",
  },
  {
    mark: "准",
    title: "2D 与 3D 使用同一资产语义",
    description: "稳定 assetId 贯穿台账、模型节点和指标映射，减少项目后期对账成本。",
  },
  {
    mark: "稳",
    title: "配置态与运行态职责分开",
    description: "交付人员保留编辑能力，客户查看页聚焦现场信息，降低误操作风险。",
  },
  {
    mark: "控",
    title: "支持客户环境部署",
    description: "前后端与项目配置可部署到客户网络，适配内网访问与受控数据边界。",
  },
] as const;

const templates = [
  { code: "MRO", name: "装备修理", color: "cyan" },
  { code: "OPS", name: "生产运营", color: "green" },
  { code: "ENERGY", name: "能耗安全", color: "amber" },
  { code: "SUPPLY", name: "装备保障", color: "violet" },
] as const;

function scrollToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function ProductMark() {
  return (
    <span aria-hidden="true" className="product-mark">
      <i />
      <i />
    </span>
  );
}

function HeroProductVisual() {
  return (
    <div aria-label="2D 大屏与 3D 工厂模型联动示意" className="product-hero-visual" role="img">
      <div className="product-visual-topline">
        <span><i /> FACTORY / NO.01</span>
        <span className="product-visual-live">DELIVERY PREVIEW</span>
      </div>

      <div className="product-factory-stage">
        <div className="product-stage-grid" />
        <div className="product-factory-model" aria-hidden="true">
          <span className="factory-block factory-block-a" />
          <span className="factory-block factory-block-b" />
          <span className="factory-block factory-block-c" />
          <span className="factory-block factory-block-d" />
          <span className="factory-block factory-block-e" />
          <span className="factory-path factory-path-a" />
          <span className="factory-path factory-path-b" />
          <span className="factory-node factory-node-a">A-01</span>
          <span className="factory-node factory-node-b">B-03</span>
        </div>
        <div className="product-floating-card product-floating-card-left">
          <span>设备状态</span>
          <strong><i /> 运行</strong>
          <small>assetId · PUMP-01</small>
        </div>
        <div className="product-floating-card product-floating-card-right">
          <span>实时指标</span>
          <strong>86.4 <small>%</small></strong>
          <div className="product-sparkline">
            <i /><i /><i /><i /><i /><i />
          </div>
          <small>示例数据</small>
        </div>
      </div>

      <div className="product-visual-footer">
        <div>
          <span>二维画布</span>
          <strong>组件化编排</strong>
        </div>
        <div className="product-link-pulse">
          <i />
          <span>assetId</span>
          <i />
        </div>
        <div>
          <span>三维场景</span>
          <strong>模型节点绑定</strong>
        </div>
      </div>
    </div>
  );
}

function ProductLandingPage() {
  return (
    <main className="product-landing">
      <nav aria-label="产品宣传页导航" className="product-nav">
        <a aria-label="Factory Twin 产品首页" className="product-brand" href="#/">
          <ProductMark />
          <span>
            <strong>Factory Twin</strong>
            <small>数字孪生交付平台</small>
          </span>
        </a>
        <div className="product-nav-links">
          <button onClick={() => scrollToSection("capabilities")} type="button">产品能力</button>
          <button onClick={() => scrollToSection("workflow")} type="button">交付流程</button>
          <button onClick={() => scrollToSection("deployment")} type="button">部署方式</button>
        </div>
        <a className="product-nav-entry" href="#/projects">
          进入平台
          <span aria-hidden="true">↗</span>
        </a>
      </nav>

      <section className="product-hero">
        <div className="product-hero-copy">
          <p className="product-kicker"><span>02</span> DIMENSIONS · ONE DELIVERY PLATFORM</p>
          <h1>
            让每一座工厂，
            <span>既看得见，也读得懂。</span>
          </h1>
          <p className="product-hero-lead">
            面向数字孪生项目交付团队，把 2D 业务大屏、3D 工厂场景、资产台账与数据契约放进同一个工作流。
          </p>
          <div className="product-hero-actions">
            <a className="product-cta-primary" href="#/projects">
              进入交付配置台
              <span aria-hidden="true">→</span>
            </a>
            <button className="product-cta-secondary" onClick={() => scrollToSection("capabilities")} type="button">
              查看产品能力
            </button>
          </div>
          <dl className="product-proof-list">
            <div>
              <dt>2D</dt>
              <dd>大屏可视化编排</dd>
            </div>
            <div>
              <dt>3D</dt>
              <dd>模型与资产映射</dd>
            </div>
            <div>
              <dt>ID</dt>
              <dd>统一资产语义</dd>
            </div>
          </dl>
        </div>
        <HeroProductVisual />
      </section>

      <section className="product-trust-strip" aria-label="产品关键能力">
        <span>行业模板</span>
        <i />
        <span>可视化配置</span>
        <i />
        <span>资产台账</span>
        <i />
        <span>数据契约</span>
        <i />
        <span>客户环境部署</span>
      </section>

      <section className="product-section product-capabilities" id="capabilities">
        <div className="product-section-heading">
          <div>
            <p className="product-section-index">01 / PRODUCT ENGINE</p>
            <h2>一个项目，两种视角</h2>
          </div>
          <p>
            2D 负责讲清业务，3D 负责还原空间。它们不再是两套孤立页面，而是围绕同一批设备资产协同工作。
          </p>
        </div>

        <div className="product-capability-grid">
          {capabilityCards.map((capability) => (
            <article className="product-capability-card" key={capability.number}>
              <div className="product-capability-card-head">
                <span>{capability.number}</span>
                <p>{capability.label}</p>
              </div>
              <div className={`product-capability-demo product-capability-demo-${capability.number}`}>
                {capability.number === "01" ? (
                  <>
                    <div className="demo-sidebar"><i /><i /><i /><i /></div>
                    <div className="demo-dashboard">
                      <div className="demo-dashboard-title" />
                      <div className="demo-kpis"><i /><i /><i /></div>
                      <div className="demo-chart">
                        <span /><span /><span /><span /><span /><span />
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="demo-scene-grid" />
                    <div className="demo-cube demo-cube-a" />
                    <div className="demo-cube demo-cube-b" />
                    <div className="demo-cube demo-cube-c" />
                    <div className="demo-object-ring"><i /></div>
                    <div className="demo-property-panel"><i /><i /><i /><i /></div>
                  </>
                )}
              </div>
              <div className="product-capability-copy">
                <h3>{capability.title}</h3>
                <p>{capability.description}</p>
                <ul>
                  {capability.tags.map((tag) => <li key={tag}>{tag}</li>)}
                </ul>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="product-section product-linkage">
        <div className="product-section-heading product-section-heading-light">
          <div>
            <p className="product-section-index">02 / ASSET LINKAGE</p>
            <h2>不是把页面拼在一起，<br />是把资产真正连起来</h2>
          </div>
          <p>
            每台设备拥有稳定的业务编号。模型节点、资产信息与指标映射围绕同一个 assetId 建立关系，让异常定位和后续扩展有据可查。
          </p>
        </div>
        <div className="product-linkage-diagram">
          <article>
            <span>MODEL NODE</span>
            <strong>模型节点</strong>
            <p>泵体 / 电机 / 阀门</p>
          </article>
          <div className="product-linkage-line"><i /></div>
          <div className="product-asset-core">
            <small>UNIFIED KEY</small>
            <strong>assetId</strong>
            <span>PUMP-01</span>
          </div>
          <div className="product-linkage-line"><i /></div>
          <article>
            <span>BUSINESS DATA</span>
            <strong>业务指标</strong>
            <p>状态 / 温度 / 能耗</p>
          </article>
        </div>
        <div className="product-linkage-note">
          <span>可追溯</span>
          <p>输入、配置、映射和异常路径都保留明确上下文，方便项目验收与后续运维。</p>
        </div>
      </section>

      <section className="product-section product-workflow" id="workflow">
        <div className="product-section-heading">
          <div>
            <p className="product-section-index">03 / DELIVERY FLOW</p>
            <h2>从素材到交付，一条工作流完成</h2>
          </div>
          <p>把一次性的项目经验沉淀为模板与公共组件，下一次交付从更高的起点开始。</p>
        </div>
        <ol className="product-step-list">
          {deliverySteps.map((step) => (
            <li key={step.index}>
              <span>{step.index}</span>
              <i />
              <h3>{step.title}</h3>
              <p>{step.description}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="product-section product-templates">
        <div className="product-template-intro">
          <p className="product-section-index">04 / REUSABLE TEMPLATES</p>
          <h2>行业场景，开箱即改</h2>
          <p>内置模板不是不可变的成品，而是可继续编辑、换色和绑定项目数据的交付起点。</p>
          <a href="#/templates">进入模板中心 <span aria-hidden="true">→</span></a>
        </div>
        <div className="product-template-stack">
          {templates.map((template, index) => (
            <article
              className={`product-template-card product-template-${template.color}`}
              key={template.code}
              style={{ "--template-index": index } as CSSProperties}
            >
              <header>
                <span>{template.code}</span>
                <i />
              </header>
              <div className="product-template-preview">
                <span /><span /><span />
                <div><i /><i /><i /><i /></div>
              </div>
              <footer>
                <strong>{template.name}</strong>
                <span>可编辑模板</span>
              </footer>
            </article>
          ))}
        </div>
      </section>

      <section className="product-section product-advantages">
        <div className="product-section-heading">
          <div>
            <p className="product-section-index">05 / WHY FACTORY TWIN</p>
            <h2>为真实交付而设计</h2>
          </div>
          <p>配置工具服务交付人员，运行页面服务客户现场。边界清楚，部署方式也更灵活。</p>
        </div>
        <div className="product-advantage-grid">
          {productAdvantages.map((advantage) => (
            <article key={advantage.mark}>
              <span>{advantage.mark}</span>
              <h3>{advantage.title}</h3>
              <p>{advantage.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="product-section product-deployment" id="deployment">
        <div className="product-deployment-copy">
          <p className="product-section-index">06 / DEPLOYMENT</p>
          <h2>部署到客户需要的地方</h2>
          <p>
            对数据边界敏感的项目，可将前端、API 与配置数据库部署在客户服务器或内网环境；需要公网协作时，也可以使用受控云环境完成交付验证。
          </p>
          <ul>
            <li><i />前后端同站点或统一反向代理</li>
            <li><i />客户数据留在约定的网络边界内</li>
            <li><i />交付配置与客户查看职责分离</li>
          </ul>
        </div>
        <div className="product-deployment-visual" aria-label="私有化与云端受控部署示意">
          <div className="deployment-customer">
            <span>CUSTOMER NETWORK</span>
            <strong>客户内网</strong>
            <div>
              <i>WEB</i>
              <i>API</i>
              <i>DB</i>
            </div>
          </div>
          <div className="deployment-connector">
            <i /><i /><i />
            <span>可选交付方式</span>
          </div>
          <div className="deployment-cloud">
            <span>CONTROLLED CLOUD</span>
            <strong>受控云环境</strong>
            <p>适合演示、验证与协同</p>
          </div>
        </div>
      </section>

      <section className="product-final-cta">
        <div>
          <p className="product-section-index">START YOUR DIGITAL TWIN DELIVERY</p>
          <h2>把下一次数字孪生交付，<br />做得更快、更稳、更清楚。</h2>
        </div>
        <a className="product-cta-primary product-cta-large" href="#/projects">
          进入 Factory Twin
          <span aria-hidden="true">→</span>
        </a>
      </section>

      <footer className="product-footer">
        <a className="product-brand" href="#/">
          <ProductMark />
          <span>
            <strong>Factory Twin</strong>
            <small>2D + 3D 数字孪生交付平台</small>
          </span>
        </a>
        <p>让模型、资产与业务数据形成可交付的现场视图。</p>
        <span>© 2026 FACTORY TWIN</span>
      </footer>
    </main>
  );
}

export default ProductLandingPage;
import type { CSSProperties } from "react";
