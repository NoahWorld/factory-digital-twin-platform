export function SiteCaptureRequirements() {
  return (
    <section className="site-capture-requirements" aria-labelledby="site-capture-requirements-title">
      <header>
        <div>
          <p className="eyebrow">拍摄前必读</p>
          <h3 id="site-capture-requirements-title">先确定范围，再采集现场</h3>
        </div>
        <span className="foundation-status is-pending">采集质量影响结果</span>
      </header>
      <div className="site-capture-requirement-grid">
        <article>
          <span aria-hidden="true">01</span>
          <div>
            <h4>同一个静态空间</h4>
            <p>首期面向<strong>单房间或连续局部车间</strong>。大型厂区、互不连通的房间分开采集；人员、设备和现场布置尽量保持静止。</p>
          </div>
        </article>
        <article>
          <span aria-hidden="true">02</span>
          <div>
            <h4>移动位置，保留重叠</h4>
            <p>缓慢移动拍摄，相邻画面充分重叠；关键区域建议至少覆盖<strong>3 个不同位置</strong>，兼顾墙角、通道和不同高度。只在原地转动相机不适合空间重建。</p>
          </div>
        </article>
        <article>
          <span aria-hidden="true">03</span>
          <div>
            <h4>清晰、稳定的原始画面</h4>
            <p>在同一时段拍摄，保持光照稳定；避免模糊、变焦和切换镜头。照片至少 <strong>480 × 360 像素</strong>、最多 4000 万像素；视频为 <strong>4–600 秒</strong>连续片段，最高 4K / 60 fps。不剪辑拼接，不添加滤镜或字幕。</p>
          </div>
        </article>
        <article className="is-caution">
          <span aria-hidden="true">04</span>
          <div>
            <h4>提前检查难以还原的区域</h4>
            <p><strong>玻璃、镜面金属、纯白墙和重复纹理</strong>可能造成定位失败、缺失或重影。运动物体和遮挡也会影响结果；未拍到的区域无法可靠还原。</p>
          </div>
        </article>
      </div>
      <p className="site-capture-scale-note"><strong>需要实际比例？</strong>现场记录一段两端清晰可辨的已知长度，保留对应照片，供后续标定。当前重建不进行标定，写实外观也不代表工程测量精度。</p>
      <div className="site-capture-availability">
        <strong>素材检查通过后，仍需进行空间重建和效果检查。</strong>
        <p>格式、数量和大小符合要求，并不保证定位或重建成功。后台会报告失败阶段；生成后请检查重点区域是否完整、是否存在重影。首版不还原随视角变化的镜面高光；漫游为自由相机浏览，不包含实体碰撞。</p>
      </div>
    </section>
  );
}
