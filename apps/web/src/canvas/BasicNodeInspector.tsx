import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { errorMessage, request } from "../api";
import { imageAssetsPath, type ImageAsset } from "./image-assets";
import { formatFileSize } from "./model-assets";
import {
  componentLabels,
  parseBasicProps,
  type BasicNodeType,
  type BasicOption,
  type CanvasNode,
} from "./types";

type BasicNodeInspectorProps = {
  editable: boolean;
  node: CanvasNode;
  onNodeChange: (node: CanvasNode) => void;
  onValidationChange: (message: string | null) => void;
  projectId: string;
};

type ImageAssetListResponse = {
  imageAssets: ImageAsset[];
  requestId: string;
};

type ImageAssetUploadResponse = {
  imageAsset: ImageAsset;
  requestId: string;
};

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_CAROUSEL_IMAGES = 12;

const cloneProps = (props: Record<string, unknown>): Record<string, unknown> =>
  JSON.parse(JSON.stringify(props)) as Record<string, unknown>;

const asText = (value: unknown): string => typeof value === "string" ? value : "";
const asNumber = (value: unknown): number => typeof value === "number" ? value : 0;
const asBoolean = (value: unknown): boolean => value === true;
const asOptions = (value: unknown): BasicOption[] => Array.isArray(value) ? value as BasicOption[] : [];

export function BasicNodeInspector({
  editable,
  node,
  onNodeChange,
  onValidationChange,
  projectId,
}: BasicNodeInspectorProps) {
  const type = node.type as BasicNodeType;
  const [draft, setDraft] = useState<Record<string, unknown>>(() => cloneProps(node.props));
  const [imageAssets, setImageAssets] = useState<ImageAsset[]>([]);
  const [assetError, setAssetError] = useState<string | null>(null);
  const [loadingAssets, setLoadingAssets] = useState(false);
  const [uploading, setUploading] = useState(false);
  const propsSignature = JSON.stringify(node.props);
  const validation = useMemo(() => parseBasicProps(type, draft), [draft, type]);
  const usesImages = type === "image" || type === "carousel";

  useEffect(() => {
    setDraft(cloneProps(node.props));
  }, [node.id, propsSignature]);

  useEffect(() => {
    onValidationChange(validation.ok ? null : validation.message);
    return () => onValidationChange(null);
  }, [onValidationChange, validation]);

  useEffect(() => {
    if (!usesImages) return;
    let active = true;
    setLoadingAssets(true);
    setAssetError(null);
    void request<ImageAssetListResponse>(imageAssetsPath(projectId))
      .then((result) => {
        if (active) setImageAssets(result.imageAssets);
      })
      .catch((reason) => {
        if (active) setAssetError(errorMessage(reason));
      })
      .finally(() => {
        if (active) setLoadingAssets(false);
      });
    return () => {
      active = false;
    };
  }, [projectId, usesImages]);

  const changeDraft = (patch: Record<string, unknown>) => {
    const nextDraft = { ...draft, ...patch };
    setDraft(nextDraft);
    const result = parseBasicProps(type, nextDraft);
    if (result.ok) onNodeChange({ ...node, props: result.value as unknown as Record<string, unknown> });
  };

  const changeOptions = (options: BasicOption[]) => {
    const optionValues = new Set(options.map((option) => option.value));
    const patch: Record<string, unknown> = { options };
    if (type === "checkbox-group") {
      patch.selectedValues = Array.isArray(draft.selectedValues)
        ? draft.selectedValues.filter((value) => typeof value === "string" && optionValues.has(value))
        : [];
    } else if (typeof draft.selectedValue === "string" && !optionValues.has(draft.selectedValue)) {
      patch.selectedValue = "";
    }
    changeDraft(patch);
  };

  const uploadImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const extension = file.name.split(".").at(-1)?.toLowerCase();
    if (extension !== "png" && extension !== "jpg" && extension !== "jpeg" && extension !== "webp") {
      setAssetError("只支持 PNG、JPEG 和 WebP 图片。");
      return;
    }
    if (file.size === 0) {
      setAssetError("不能上传空图片。");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setAssetError(`单张图片不能超过 ${formatFileSize(MAX_IMAGE_BYTES)}。`);
      return;
    }
    if (type === "carousel" && node.resourceRefs.length >= MAX_CAROUSEL_IMAGES) {
      setAssetError(`轮播图最多绑定 ${MAX_CAROUSEL_IMAGES} 张图片。`);
      return;
    }

    setUploading(true);
    setAssetError(null);
    try {
      const result = await request<ImageAssetUploadResponse>(
        `${imageAssetsPath(projectId)}?filename=${encodeURIComponent(file.name)}`,
        { method: "POST", body: file, headers: { "content-type": file.type || "application/octet-stream" } },
      );
      setImageAssets((current) => [
        result.imageAsset,
        ...current.filter((asset) => asset.id !== result.imageAsset.id),
      ]);
      const resourceRefs = type === "image"
        ? [result.imageAsset.id]
        : [...node.resourceRefs, result.imageAsset.id];
      onNodeChange({ ...node, resourceRefs });
    } catch (reason) {
      setAssetError(errorMessage(reason));
    } finally {
      setUploading(false);
    }
  };

  const setImageBinding = (assetId: string, checked = true) => {
    if (type === "image") {
      onNodeChange({ ...node, resourceRefs: assetId ? [assetId] : [] });
      return;
    }
    const resourceRefs = checked
      ? [...node.resourceRefs, assetId].filter((value, index, values) => values.indexOf(value) === index).slice(0, MAX_CAROUSEL_IMAGES)
      : node.resourceRefs.filter((value) => value !== assetId);
    onNodeChange({ ...node, resourceRefs });
  };

  const showsAppearance = type !== "image" && type !== "carousel";
  const showsFont = type === "plain-text" || type === "text-link" || type === "button" || type === "fullscreen-toggle";
  const showsOptions = type === "checkbox-group" || type === "radio-group" || type === "select";
  const options = asOptions(draft.options);

  return (
    <aside className="component-inspector">
      <header className="inspector-heading">
        <span className="eyebrow">Basic component</span>
        <h2>{componentLabels[type]}</h2>
        <p>组件 ID：{node.id.slice(0, 8)}</p>
      </header>

      <section className="inspector-section">
        <div className="inspector-section-title"><strong>内容配置</strong><span>组件自身配置</span></div>
        {type === "plain-text" || type === "text-link" || type === "button" ? (
          <label><span>显示文字</span><textarea disabled={!editable} maxLength={type === "plain-text" ? 1000 : 120} onChange={(event) => changeDraft({ text: event.target.value })} rows={type === "plain-text" ? 4 : 2} value={asText(draft.text)} /></label>
        ) : null}
        {type === "fullscreen-toggle" ? (
          <div className="inspector-inline-fields">
            <label><span>进入全屏文字</span><input disabled={!editable} maxLength={120} onChange={(event) => changeDraft({ enterText: event.target.value })} value={asText(draft.enterText)} /></label>
            <label><span>退出全屏文字</span><input disabled={!editable} maxLength={120} onChange={(event) => changeDraft({ exitText: event.target.value })} value={asText(draft.exitText)} /></label>
          </div>
        ) : null}
        {type === "text-link" || type === "button" ? (
          <label><span>跳转地址（HTTP / HTTPS）</span><input disabled={!editable} maxLength={2048} onChange={(event) => changeDraft({ href: event.target.value })} placeholder={type === "button" ? "可留空，稍后绑定动作" : "https://example.com"} type="url" value={asText(draft.href)} /></label>
        ) : null}
        {type === "switch" ? (
          <>
            <label><span>标签</span><input disabled={!editable} maxLength={120} onChange={(event) => changeDraft({ label: event.target.value })} value={asText(draft.label)} /></label>
            <div className="inspector-inline-fields">
              <label><span>开启文字</span><input disabled={!editable} maxLength={24} onChange={(event) => changeDraft({ onText: event.target.value })} value={asText(draft.onText)} /></label>
              <label><span>关闭文字</span><input disabled={!editable} maxLength={24} onChange={(event) => changeDraft({ offText: event.target.value })} value={asText(draft.offText)} /></label>
            </div>
            <label className="inspector-check-row"><input checked={asBoolean(draft.defaultChecked)} disabled={!editable} onChange={(event) => changeDraft({ defaultChecked: event.target.checked })} type="checkbox" /><span>默认开启</span></label>
          </>
        ) : null}
        {type === "checkbox-group" || type === "radio-group" ? (
          <label><span>分组标题</span><input disabled={!editable} maxLength={120} onChange={(event) => changeDraft({ title: event.target.value })} value={asText(draft.title)} /></label>
        ) : null}
        {type === "select" ? (
          <>
            <label><span>标签</span><input disabled={!editable} maxLength={120} onChange={(event) => changeDraft({ label: event.target.value })} value={asText(draft.label)} /></label>
            <label><span>占位文字</span><input disabled={!editable} maxLength={80} onChange={(event) => changeDraft({ placeholder: event.target.value })} value={asText(draft.placeholder)} /></label>
          </>
        ) : null}
        {type === "image" || type === "carousel" ? (
          <label><span>替代文字</span><input disabled={!editable} maxLength={160} onChange={(event) => changeDraft({ alt: event.target.value })} value={asText(draft.alt)} /></label>
        ) : null}
        {type === "image" || type === "carousel" ? (
          <label><span>图片填充</span><select disabled={!editable} onChange={(event) => changeDraft({ fit: event.target.value })} value={asText(draft.fit)}><option value="cover">覆盖容器</option><option value="contain">完整显示</option><option value="fill">拉伸填满</option></select></label>
        ) : null}
        {type === "plain-text" ? (
          <>
            <label><span>滚动方式</span><select disabled={!editable} onChange={(event) => changeDraft({ scrollMode: event.target.value })} value={asText(draft.scrollMode)}><option value="none">不滚动</option><option value="horizontal">水平滚动</option><option value="vertical">垂直滚动</option></select></label>
            <label><span>滚动一周时长（秒）</span><input disabled={!editable} max={120} min={3} onChange={(event) => changeDraft({ scrollDuration: Number(event.target.value) })} type="number" value={asNumber(draft.scrollDuration)} /></label>
          </>
        ) : null}
        {type === "carousel" ? (
          <>
            <label><span>切换间隔（秒）</span><input disabled={!editable} max={60} min={2} onChange={(event) => changeDraft({ interval: Number(event.target.value) })} type="number" value={asNumber(draft.interval)} /></label>
            <div className="inspector-checkbox-grid">
              <label><input checked={asBoolean(draft.autoplay)} disabled={!editable} onChange={(event) => changeDraft({ autoplay: event.target.checked })} type="checkbox" /><span>自动播放</span></label>
              <label><input checked={asBoolean(draft.showArrows)} disabled={!editable} onChange={(event) => changeDraft({ showArrows: event.target.checked })} type="checkbox" /><span>显示箭头</span></label>
              <label><input checked={asBoolean(draft.showDots)} disabled={!editable} onChange={(event) => changeDraft({ showDots: event.target.checked })} type="checkbox" /><span>显示指示点</span></label>
            </div>
          </>
        ) : null}
        {type === "text-link" || type === "button" ? (
          <div className="inspector-checkbox-grid">
            <label><input checked={asBoolean(draft.openInNewTab)} disabled={!editable} onChange={(event) => changeDraft({ openInNewTab: event.target.checked })} type="checkbox" /><span>新窗口打开</span></label>
            {type === "text-link" ? <label><input checked={asBoolean(draft.underline)} disabled={!editable} onChange={(event) => changeDraft({ underline: event.target.checked })} type="checkbox" /><span>显示下划线</span></label> : null}
            {type === "button" ? <label><input checked={asBoolean(draft.disabled)} disabled={!editable} onChange={(event) => changeDraft({ disabled: event.target.checked })} type="checkbox" /><span>禁用按钮</span></label> : null}
          </div>
        ) : null}
        {type === "fullscreen-toggle" ? (
          <label className="inspector-check-row"><input checked={asBoolean(draft.disabled)} disabled={!editable} onChange={(event) => changeDraft({ disabled: event.target.checked })} type="checkbox" /><span>禁用全屏切换</span></label>
        ) : null}
      </section>

      {showsOptions ? (
        <section className="inspector-section">
          <div className="inspector-section-title"><strong>选项</strong><span>最多 24 项</span></div>
          <div className="basic-option-editor">
            {options.map((option, index) => (
              <div className="basic-option-row" key={`${index}-${option.value}`}>
                <input aria-label={`选项 ${index + 1} 名称`} disabled={!editable} maxLength={80} onChange={(event) => changeOptions(options.map((item, currentIndex) => currentIndex === index ? { ...item, label: event.target.value } : item))} value={option.label} />
                <input aria-label={`选项 ${index + 1} 值`} disabled={!editable} maxLength={80} onChange={(event) => changeOptions(options.map((item, currentIndex) => currentIndex === index ? { ...item, value: event.target.value } : item))} value={option.value} />
                <button aria-label={`删除选项 ${index + 1}`} disabled={!editable || options.length <= 1} onClick={() => changeOptions(options.filter((_, currentIndex) => currentIndex !== index))} type="button">×</button>
              </div>
            ))}
          </div>
          <button className="secondary-button" disabled={!editable || options.length >= 24} onClick={() => changeOptions([...options, { label: `选项 ${options.length + 1}`, value: `option-${options.length + 1}` }])} type="button">添加选项</button>
          {type === "checkbox-group" ? (
            <div className="inspector-checkbox-grid">
              {options.map((option) => {
                const selected = Array.isArray(draft.selectedValues) && draft.selectedValues.includes(option.value);
                return <label key={option.value}><input checked={selected} disabled={!editable} onChange={(event) => changeDraft({ selectedValues: event.target.checked ? [...draft.selectedValues as string[], option.value] : (draft.selectedValues as string[]).filter((value) => value !== option.value) })} type="checkbox" /><span>{option.label}</span></label>;
              })}
            </div>
          ) : (
            <label><span>默认选项</span><select disabled={!editable} onChange={(event) => changeDraft({ selectedValue: event.target.value })} value={asText(draft.selectedValue)}><option value="">不预选</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          )}
          {type !== "select" ? <label><span>每行列数</span><input disabled={!editable} max={4} min={1} onChange={(event) => changeDraft({ columns: Number(event.target.value) })} type="number" value={asNumber(draft.columns)} /></label> : null}
        </section>
      ) : null}

      {usesImages ? (
        <section className="inspector-section">
          <div className="inspector-section-title"><strong>图片资源</strong><span>{type === "image" ? "单张" : `${node.resourceRefs.length}/${MAX_CAROUSEL_IMAGES}`}</span></div>
          {type === "image" ? (
            <select disabled={!editable || loadingAssets || uploading} onChange={(event) => setImageBinding(event.target.value)} value={node.resourceRefs[0] ?? ""}>
              <option value="">{loadingAssets ? "正在读取图片…" : "请选择图片"}</option>
              {imageAssets.map((asset) => <option key={asset.id} value={asset.id}>{asset.originalFilename} · {formatFileSize(asset.byteSize)}</option>)}
            </select>
          ) : (
            <div className="basic-image-asset-list">
              {imageAssets.length === 0 && !loadingAssets ? <p>项目中还没有图片资源。</p> : null}
              {imageAssets.map((asset) => {
                const selected = node.resourceRefs.includes(asset.id);
                return <label key={asset.id}><input checked={selected} disabled={!editable || (!selected && node.resourceRefs.length >= MAX_CAROUSEL_IMAGES)} onChange={(event) => setImageBinding(asset.id, event.target.checked)} type="checkbox" /><span><strong>{asset.originalFilename}</strong><small>{formatFileSize(asset.byteSize)}</small></span></label>;
              })}
            </div>
          )}
          <input accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp" className="model-file-input" disabled={!editable || uploading} id={`image-upload-${node.id}`} onChange={(event) => void uploadImage(event)} type="file" />
          <label className="secondary-button model-upload-button" htmlFor={`image-upload-${node.id}`}>{uploading ? "正在上传…" : "上传新图片"}</label>
          {assetError ? <p className="inspector-inline-error" role="alert">{assetError}</p> : null}
          <p className="inspector-help">图片文件独立存储；画布节点仅保存资源 ID。支持 PNG、JPEG、WebP，单张不超过 8 MB。</p>
        </section>
      ) : null}

      <section className="inspector-section">
        <div className="inspector-section-title"><strong>外观配置</strong><span>自适应尺寸</span></div>
        {showsFont ? (
          <div className="inspector-inline-fields">
            <label><span>字号</span><input disabled={!editable} max={120} min={10} onChange={(event) => changeDraft({ fontSize: Number(event.target.value) })} type="number" value={asNumber(draft.fontSize)} /></label>
            <label><span>字重</span><select disabled={!editable} onChange={(event) => changeDraft({ fontWeight: Number(event.target.value) })} value={asNumber(draft.fontWeight)}><option value={400}>常规</option><option value={500}>中等</option><option value={600}>半粗</option><option value={700}>粗体</option><option value={800}>特粗</option></select></label>
          </div>
        ) : null}
        {type === "plain-text" || type === "text-link" ? <label><span>对齐</span><select disabled={!editable} onChange={(event) => changeDraft({ align: event.target.value })} value={asText(draft.align)}><option value="left">左对齐</option><option value="center">居中</option><option value="right">右对齐</option></select></label> : null}
        <div className="inspector-decoration-colors">
          {showsAppearance ? <label><span>文字颜色</span><input className="inspector-color-input" disabled={!editable} onChange={(event) => changeDraft({ textColor: event.target.value })} type="color" value={asText(draft.textColor)} /></label> : null}
          {showsAppearance ? <label><span>强调颜色</span><input className="inspector-color-input" disabled={!editable} onChange={(event) => changeDraft({ accentColor: event.target.value })} type="color" value={asText(draft.accentColor)} /></label> : null}
          <label><span>背景颜色</span><input className="inspector-color-input" disabled={!editable} onChange={(event) => changeDraft({ [showsAppearance ? "fillColor" : "backgroundColor"]: event.target.value })} type="color" value={asText(draft[showsAppearance ? "fillColor" : "backgroundColor"])} /></label>
          <label><span>边框颜色</span><input className="inspector-color-input" disabled={!editable} onChange={(event) => changeDraft({ borderColor: event.target.value })} type="color" value={asText(draft.borderColor)} /></label>
        </div>
        <label><span>圆角</span><input disabled={!editable} max={100} min={0} onChange={(event) => changeDraft({ borderRadius: Number(event.target.value) })} type="number" value={asNumber(draft.borderRadius)} /></label>
        {!validation.ok ? <p className="inspector-validation-error" role="alert">{validation.message}</p> : null}
      </section>

      <div className="inspector-note">
        <strong>编辑态与预览态分离</strong>
        <p>编辑时控件不会触发跳转或改变运行状态；进入可视化预览后才可实际操作。</p>
      </div>
    </aside>
  );
}
