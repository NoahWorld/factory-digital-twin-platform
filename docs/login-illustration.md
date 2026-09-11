# 登录页配图

- 用途：登录及首次初始化页面的工厂数字孪生场景示意，不代表真实客户项目。
- 生成方式：内置 imagegen，根据用户提供的工厂园区图片简化生成。
- 页面资源：`../apps/web/src/assets/login-factory.webp`（1536 × 1024），由 Vite 导入并生成带哈希的构建文件名。
- 网页导出：`cwebp -q 84 -m 6`，保留原构图和尺寸。

## 最终生成提示词

```text
Use case: precise-object-edit
Asset type: polished 3D illustration for the LEFT visual panel of an existing dark navy industrial digital-twin platform login page.
Input image: the attached factory campus image is the edit target. Simplify and recompose this image while preserving its recognizable architectural visualization style, white cutaway factory, blue solar roof, orange industrial robot arms, glass control room, and restrained cyan digital-twin accents.
Primary request: greatly reduce visual complexity, with one clear focal point. Keep ONE main cutaway factory containing only two orange robotic arms and one clean short production line. Keep one small attached glass control-room volume with a single readable-as-shapes cyan display. Remove the separate warehouse, racks, cardboard boxes, loading truck, cars, charging area, HVAC units, gates, fences, road markings, distant buildings, people and dense landscaping. Keep only two or three simple small trees near the edge.
Composition: landscape 3:2, complete compact isometric architectural diorama, centered with generous clean negative space and no cropped architecture. The factory sits on a thin rectangular gray platform. Main object fills about 80% of width. Upper left three-quarter camera. Preserve realistic industrial materials and believable construction with a cleaner, elegant model presentation. Background is continuous very dark navy #0b1c2d, gently lit behind the factory, so the scene integrates with the dark login page.
Digital-twin detail: only a subtle cyan outline on part of the production area and ONE small floating wireframe duplicate of a robot above the line. At most one restrained cyan connection leading to the attached control room. No giant arcs across the scene. Soft white studio lighting, cool neutral surfaces, subtle cyan rim lighting, orange only on the robots. Crisp architectural 3D render with broad legible forms and reduced micro-detail; sophisticated and calm, not a toy.
Constraints: no text, no letters, no numbers, no logos, no watermarks, no user-interface mockup, no charts covering the image. Deliver only the simplified illustration.
```
