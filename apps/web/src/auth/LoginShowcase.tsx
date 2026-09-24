import { useEffect, useMemo, useState } from "react";
import { BatchModel3DNode } from "../canvas/BatchModel3DNode";
import { loginShowcaseNode } from "./login-showcase-scene";
import "./LoginShowcase.css";

export function LoginShowcase() {
  const [animate, setAnimate] = useState(() => !window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setAnimate(!preference.matches);
    preference.addEventListener("change", onChange);
    return () => preference.removeEventListener("change", onChange);
  }, []);

  const node = useMemo(() => ({
    ...loginShowcaseNode,
    props: { ...loginShowcaseNode.props, autoRotate: animate, playAnimations: animate },
  }), [animate]);

  return (
    <figure
      className="auth-illustration login-showcase"
      draggable={false}
      onDragStart={(event) => event.preventDefault()}
      onContextMenu={(event) => event.preventDefault()}
      aria-label="工业机械臂与装配工位的三维动画演示"
    >
      <div className="login-showcase-stage">
        <BatchModel3DNode
          node={node}
          projectId="public-login-showcase"
          editable={false}
          interactive={false}
          cameraControlsEnabled={false}
          runtimeControlsEnabled={false}
          selectedSceneNodePath={null}
          onSceneNodeSelect={() => { /* Decorative scene: picking is disabled. */ }}
        />
      </div>
      <figcaption>工业装配单元</figcaption>
      <button
        className="login-showcase-motion"
        type="button"
        aria-label={animate ? "暂停展示动画" : "播放展示动画"}
        title={animate ? "暂停动画" : "播放动画"}
        onClick={() => setAnimate((value) => !value)}
      >
        <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" fill="currentColor">
          {animate ? <path d="M5 4h3v12H5zm7 0h3v12h-3z" /> : <path d="m6 3 11 7-11 7z" />}
        </svg>
      </button>
    </figure>
  );
}
