import * as THREE from "three";
import { OutlinePass } from "three/examples/jsm/postprocessing/OutlinePass.js";
import { FullScreenQuad } from "three/examples/jsm/postprocessing/Pass.js";

/** Screen-space selection follows the actual animated mesh, without editing its materials. */
export class RuntimeSelectionOutline {
  private target: THREE.Object3D | null = null;
  private edges: THREE.WebGLRenderTarget | null = null;
  private outline: OutlinePass | null = null;
  private overlay: FullScreenQuad | null = null;
  private overlayMaterial: THREE.ShaderMaterial | null = null;
  private readonly clearColor = new THREE.Color();
  private disposed = false;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
  ) {}

  set(target: THREE.Object3D) {
    if (this.disposed) throw new Error("Cannot select a model after the selection outline was disposed.");
    this.target = target;
    if (!this.outline) {
      // Allocate only when a runtime model is selected. Ordinary/editor scenes keep their direct render path.
      const size = this.renderer.getSize(new THREE.Vector2());
      this.edges = new THREE.WebGLRenderTarget(size.x, size.y, { depthBuffer: false });
      this.edges.texture.name = "RuntimeSelectionOutline.edges";
      this.outline = new OutlinePass(size, this.scene, this.camera);
      this.outline.visibleEdgeColor.set(0xffffff);
      this.outline.hiddenEdgeColor.set(0x000000);
      this.outline.edgeStrength = 6;
      this.outline.edgeGlow = 0;
      this.outline.pulsePeriod = 0;
      this.outline.downSampleRatio = 1;
      // This target stores coverage, not a beauty image. Additive blending would
      // multiply the mask by its alpha a second time and make thin edges too faint.
      this.outline.overlayMaterial.blending = THREE.NoBlending;
      // Composite only the edge mask over the ordinary rendered frame. Passing the
      // entire scene through OutputPass would also tone-map clear colors and
      // toneMapped=false materials, changing the scene whenever selection changes.
      this.overlayMaterial = new THREE.ShaderMaterial({
        uniforms: {
          edges: { value: this.edges.texture },
          color: { value: new THREE.Color("#46e5ff") },
        },
        vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }",
        fragmentShader: `uniform sampler2D edges; uniform vec3 color; varying vec2 vUv;
          void main() {
            gl_FragColor = vec4(color, clamp(texture2D(edges, vUv).r, 0.0, 1.0));
            #include <colorspace_fragment>
          }`,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      });
      this.overlay = new FullScreenQuad(this.overlayMaterial);
      this.resize(size.x, size.y);
    }
    this.outline!.selectedObjects = [target];
  }

  clear() {
    this.target = null;
    if (this.outline) this.outline.selectedObjects = [];
  }

  resize(width: number, height: number) {
    if (!this.outline || !this.edges) return;
    const pixelRatio = this.renderer.getPixelRatio();
    this.edges.setSize(Math.round(width * pixelRatio), Math.round(height * pixelRatio));
    this.outline.setSize(this.edges.width, this.edges.height);
    this.outline.edgeThickness = 1.3 * pixelRatio;
  }

  private hasVisibleTarget() {
    if (!this.target || !this.scene.getObjectById(this.target.id)) return false;
    for (let parent: THREE.Object3D | null = this.target; parent; parent = parent.parent) {
      if (!parent.visible) return false;
    }
    let visibleMesh = false;
    this.target.traverseVisible(object => {
      if ((object as THREE.Mesh).isMesh) visibleMesh = true;
    });
    return visibleMesh;
  }

  render(renderBase?: () => void) {
    // Count every pass, so diagnostics do not report only the final fullscreen quad.
    const autoReset = this.renderer.info.autoReset;
    this.renderer.info.autoReset = false;
    this.renderer.info.reset();
    try {
      if (renderBase) renderBase();
      else this.renderer.render(this.scene, this.camera);
      if (this.outline && this.edges && this.overlay && this.hasVisibleTarget()) {
        const target = this.renderer.getRenderTarget();
        const autoClear = this.renderer.autoClear;
        const clearAlpha = this.renderer.getClearAlpha();
        const shadowAutoUpdate = this.renderer.shadowMap.autoUpdate;
        this.renderer.getClearColor(this.clearColor);
        try {
          // The beauty frame already updated shadows. Mask passes must not replace
          // them with maps generated while selected/non-selected objects are hidden.
          this.renderer.shadowMap.autoUpdate = false;
          this.renderer.autoClear = false;
          this.renderer.setRenderTarget(this.edges);
          this.renderer.setClearColor(0x000000, 0);
          this.renderer.clear();
          this.outline.render(this.renderer, this.edges, this.edges, 0, false);
          this.renderer.setRenderTarget(target);
          this.overlay.render(this.renderer);
        } finally {
          this.renderer.setRenderTarget(target);
          this.renderer.setClearColor(this.clearColor, clearAlpha);
          this.renderer.autoClear = autoClear;
          this.renderer.shadowMap.autoUpdate = shadowAutoUpdate;
        }
      }
    } finally {
      this.renderer.info.autoReset = autoReset;
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.clear();
    this.outline?.dispose();
    this.edges?.dispose();
    this.overlayMaterial?.dispose();
    this.overlay?.dispose();
    this.edges = null;
    this.outline = null;
    this.overlay = null;
    this.overlayMaterial = null;
  }
}
