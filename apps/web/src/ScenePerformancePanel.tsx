import { useEffect,useRef,useState } from "react";
import type { ScenePerformanceSnapshot } from "./canvas/scene-viewport-runtime";
const number = (value:number|null,digits=1) => value === null || !Number.isFinite(value) ? "—":value.toLocaleString("zh-CN",{ maximumFractionDigits:digits });
export function ScenePerformancePanel({ projectId,versionId,onClose }:{ projectId:string;versionId?:string;onClose():void }) {
  const [rows,setRows] = useState<ScenePerformanceSnapshot[]>([]),[error,setError] = useState(false),[loading,setLoading] = useState(true);const refresh = useRef(() => {});
  useEffect(() => {
    let active = true,timer:ReturnType<typeof setInterval>|undefined;setRows([]);setError(false);setLoading(true);
    void import("./canvas/scene-viewport-runtime").then((runtime) => {
      if (!active) return;const read = () => { if (active) setRows(runtime.scenePerformanceDiagnostics().filter((row) => row.projectId === projectId && row.versionId === (versionId ?? null))); };
      refresh.current = read;read();setLoading(false);timer = setInterval(read,1000);
    }).catch(() => { if (active) { setError(true);setLoading(false); } });
    return () => { active = false;clearInterval(timer);refresh.current = () => {}; };
  },[projectId,versionId]);
  return <div className="data-source-panel-backdrop" role="dialog" aria-modal="true" aria-label="场景性能">
    <section className="data-source-panel scene-performance-panel"><header className="data-source-panel-header"><div><p className="eyebrow">SCENE PERFORMANCE</p><h2>场景性能</h2></div><button className="data-source-panel-close" type="button" aria-label="关闭场景性能" onClick={onClose}>×</button></header>
      <div className="scene-performance-content"><p>显示本页已加载三维视窗的实际提交量和最近240帧统计。每秒刷新；切换场景会重新计时，暂停视窗不作为当前帧率。</p><button className="secondary-button" type="button" disabled={loading || error} onClick={() => refresh.current()}>刷新统计</button>
        {error ? <p role="alert">性能模块读取失败，请重新加载此运行页面。</p>:loading ? <p role="status">正在读取场景统计…</p>:!rows.length ? <p role="status">当前页面没有运行中的三维视窗。</p>:rows.map((row,index) => <section className="scene-performance-card" key={row.id} data-renderer-diagnostics={JSON.stringify(row)}><header><strong>视窗 {index+1}</strong><span>{row.errors ? `${row.errors} 个实例读取失败`:row.pending ? `正在加载 ${row.pending} 个实例`:row.active ? "正在渲染":"渲染已暂停"}</span></header><dl>
          <div><dt>平均帧率</dt><dd>{row.active && row.ready ? number(row.meanFps):"—"} FPS</dd></div><div><dt>帧间隔 p95</dt><dd>{row.active && row.ready ? number(row.p95FrameMs):"—"} ms</dd></div><div><dt>提交耗时 p95</dt><dd>{row.active && row.ready ? number(row.p95SubmitMs):"—"} ms</dd></div>
          <div><dt>当前配置首帧提交</dt><dd>{number(row.firstFrameMs)} ms</dd></div><div><dt>渲染尺寸</dt><dd>{row.width} × {row.height}</dd></div><div><dt>提交三角面</dt><dd>{number(row.triangles,0)}</dd></div><div><dt>每帧绘制调用</dt><dd>{number(row.calls,0)}</dd></div><div><dt>已加载实例</dt><dd>{row.instances}</dd></div>
          <div><dt>共享副本（几何 / 材质 / 纹理）</dt><dd>{row.ownedResources.geometries} / {row.ownedResources.materials} / {row.ownedResources.textures}</dd></div><div><dt>累计渲染帧</dt><dd>{number(row.frame,0)}</dd></div><div><dt>帧间隔样本</dt><dd>{row.samples}</dd></div>
        </dl><p>提交耗时是浏览器发出渲染指令的耗时；三角面数是渲染器实际提交量，资源计数不是显存大小。</p></section>)}
      </div>
    </section>
  </div>;
}
