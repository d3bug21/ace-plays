import * as THREE from 'three';
import type { StageEnvironment, PooledLight } from '../stages/types';
import { mergeStatic } from '../kit/kit';

// Atmosphere for every stage: gradient sky, soft sun shadows that follow Ace,
// a full underwater pack and gentle weather. Stage authors only describe
// colours in StageEnvironment; everything else lives here.

const skyVert = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 p = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * p;
    gl_Position.z = gl_Position.w; // always at the far plane
  }
`;
const skyFrag = /* glsl */ `
  uniform vec3 uTop;
  uniform vec3 uHorizon;
  uniform vec3 uBottom;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform float uSunSize;
  varying vec3 vDir;
  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;
    vec3 col = h > 0.0 ? mix(uHorizon, uTop, pow(smoothstep(0.0, 1.0, h), 0.6)) : mix(uHorizon, uBottom, smoothstep(0.0, -0.4, h));
    float sd = max(dot(d, normalize(uSunDir)), 0.0);
    col += uSunColor * (pow(sd, 900.0 / uSunSize) * 1.2 + pow(sd, 14.0) * 0.22);
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const shaftVert = /* glsl */ `
  varying vec2 vUv;
  varying float vDepth;
  void main() {
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;
const shaftFrag = /* glsl */ `
  uniform float uTime;
  uniform float uSeed;
  uniform vec3 uColor;
  uniform float uOpacity;
  varying vec2 vUv;
  varying float vDepth;
  void main() {
    float edge = smoothstep(0.0, 0.35, vUv.x) * smoothstep(1.0, 0.65, vUv.x);
    float fadeY = smoothstep(0.0, 0.5, vUv.y) * smoothstep(1.0, 0.85, vUv.y);
    float flick = 0.75 + 0.25 * sin(uTime * 0.7 + uSeed * 6.0 + vUv.x * 3.0);
    float nearFade = smoothstep(1.5, 6.0, vDepth);
    float a = edge * fadeY * flick * uOpacity * nearFade;
    gl_FragColor = vec4(uColor, a);
  }
`;

const surfVert = /* glsl */ `
  varying vec2 vXZ;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vXZ = wp.xz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;
const surfFrag = /* glsl */ `
  uniform float uTime;
  uniform vec3 uColor;
  uniform vec3 uCamPos;
  uniform vec3 uFogCol;
  uniform float uFogDensity;
  uniform float uSurfY;
  varying vec2 vXZ;
  void main() {
    vec2 p = vXZ * 0.16;
    float w = sin(p.x * 3.0 + uTime * 0.8) * sin(p.y * 2.6 - uTime * 0.6) + sin((p.x + p.y) * 4.3 + uTime * 1.1) * 0.5;
    float w2 = sin(p.x * 7.1 - uTime * 1.3 + p.y * 2.0) * 0.5 + 0.5;
    float bright = 0.62 + 0.3 * smoothstep(-0.6, 1.2, w) + 0.08 * w2;
    vec3 d = vec3(vXZ.x, uSurfY, vXZ.y) - uCamPos;
    float dist = length(d);
    float fogF = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
    // Snell's window: brighter straight above, fading towards the fog at grazing angles.
    float up = clamp(d.y / max(dist, 0.001), 0.0, 1.0);
    vec3 col = mix(uFogCol * 1.15, uColor * bright, smoothstep(0.15, 0.8, up));
    col = mix(col, uFogCol, fogF * 0.85);
    gl_FragColor = vec4(col, 0.92);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** Patch a MeshStandardMaterial with animated procedural caustics (underwater floors). */
export const causticUniforms = { uCausticTime: { value: 0 }, uCausticStrength: { value: 0.6 }, uCausticColor: { value: new THREE.Color(0xd8fbf4) } };
export function applyCaustics(m: THREE.MeshStandardMaterial, scale = 0.35): THREE.MeshStandardMaterial {
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uCausticTime = causticUniforms.uCausticTime;
    shader.uniforms.uCausticStrength = causticUniforms.uCausticStrength;
    shader.uniforms.uCausticColor = causticUniforms.uCausticColor;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCWorld;\nvarying vec3 vCNormal;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvCWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvCNormal = normalize(mat3(modelMatrix) * objectNormal);');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vCWorld;
        varying vec3 vCNormal;
        uniform float uCausticTime;
        uniform float uCausticStrength;
        uniform vec3 uCausticColor;
        float causticFn(vec2 p, float t) {
          vec2 i = p;
          float c = 1.0;
          float inten = 0.005;
          for (int n = 0; n < 3; n++) {
            float tt = t * (1.0 - (3.5 / float(n + 1)));
            i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
            c += 1.0 / length(vec2(p.x / (sin(i.x + tt) / inten), p.y / (cos(i.y + tt) / inten)));
          }
          c /= 3.0;
          c = 1.17 - pow(c, 1.4);
          return clamp(pow(abs(c), 8.0), 0.0, 1.0);
        }`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          float up = smoothstep(0.2, 0.9, vCNormal.y);
          float cs = causticFn(mod(vCWorld.xz * ${scale.toFixed(3)}, 6.2831 * 8.0), uCausticTime * 0.6);
          totalEmissiveRadiance += uCausticColor * cs * uCausticStrength * up * diffuseColor.rgb;
        }`,
      );
  };
  m.customProgramCacheKey = () => `caustic${scale}`;
  return m;
}

export class Environment {
  readonly group = new THREE.Group();
  readonly hemi = new THREE.HemisphereLight(0xffffff, 0x888888, 1);
  readonly sun = new THREE.DirectionalLight(0xffffff, 2);
  readonly ambient = new THREE.AmbientLight(0xffffff, 0);
  private sky: THREE.Mesh;
  private skyMat: THREE.ShaderMaterial;
  private shafts: THREE.Mesh[] = [];
  private shaftGroup = new THREE.Group();
  private snow: THREE.Points;
  private snowPos: Float32Array;
  private snowVel: Float32Array;
  private weather: THREE.Points;
  private weatherPos: Float32Array;
  private surface: THREE.Mesh;
  private surfaceMat: THREE.ShaderMaterial;
  private lights: { light: THREE.PointLight; used: boolean }[] = [];
  env: StageEnvironment | null = null;
  private sunDir = new THREE.Vector3(0.4, 1, 0.3).normalize();
  private shadowSize = 36;

  constructor(scene: THREE.Scene) {
    this.skyMat = new THREE.ShaderMaterial({
      uniforms: {
        uTop: { value: new THREE.Color() },
        uHorizon: { value: new THREE.Color() },
        uBottom: { value: new THREE.Color() },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunColor: { value: new THREE.Color(0xfff3d8) },
        uSunSize: { value: 1 },
      },
      vertexShader: skyVert,
      fragmentShader: skyFrag,
      side: THREE.BackSide,
      depthWrite: false,
      toneMapped: false,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16), this.skyMat);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -10;
    this.group.add(this.sky);

    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -this.shadowSize;
    sc.right = this.shadowSize;
    sc.top = this.shadowSize;
    sc.bottom = -this.shadowSize;
    sc.near = 1;
    sc.far = 160;
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.04;
    this.sun.shadow.radius = 3;
    this.group.add(this.hemi, this.sun, this.sun.target, this.ambient);

    // Underwater light shafts (camera-relative field).
    const shaftGeo = new THREE.PlaneGeometry(1, 1, 1, 1);
    shaftGeo.translate(0, 0.5, 0);
    for (let i = 0; i < 14; i++) {
      const m = new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uSeed: { value: Math.random() }, uColor: { value: new THREE.Color(0xdff7f0) }, uOpacity: { value: 0.12 } },
        vertexShader: shaftVert,
        fragmentShader: shaftFrag,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      const s = new THREE.Mesh(shaftGeo, m);
      s.userData.offset = new THREE.Vector3((Math.random() - 0.5) * 60, 0, (Math.random() - 0.5) * 60);
      s.userData.w = 1.5 + Math.random() * 3;
      s.renderOrder = 30;
      this.shafts.push(s);
      this.shaftGroup.add(s);
    }
    this.group.add(this.shaftGroup);

    // Marine snow: drifting particles around the camera.
    const N = 1400;
    this.snowPos = new Float32Array(N * 3);
    this.snowVel = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      this.snowPos[i * 3] = (Math.random() - 0.5) * 40;
      this.snowPos[i * 3 + 1] = (Math.random() - 0.5) * 24;
      this.snowPos[i * 3 + 2] = (Math.random() - 0.5) * 40;
      this.snowVel[i] = 0.1 + Math.random() * 0.25;
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(this.snowPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.snow = new THREE.Points(
      sg,
      new THREE.PointsMaterial({ color: 0xe8f4ee, size: 0.06, transparent: true, opacity: 0.55, depthWrite: false, map: dotTexture(), alphaTest: 0.01 }),
    );
    this.snow.frustumCulled = false;
    this.group.add(this.snow);

    // Weather (snowfall / pollen / motes).
    const W = 1800;
    this.weatherPos = new Float32Array(W * 3);
    for (let i = 0; i < W; i++) {
      this.weatherPos[i * 3] = (Math.random() - 0.5) * 60;
      this.weatherPos[i * 3 + 1] = Math.random() * 30;
      this.weatherPos[i * 3 + 2] = (Math.random() - 0.5) * 60;
    }
    const wg = new THREE.BufferGeometry();
    wg.setAttribute('position', new THREE.BufferAttribute(this.weatherPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.weather = new THREE.Points(
      wg,
      new THREE.PointsMaterial({ color: 0xffffff, size: 0.12, transparent: true, opacity: 0.85, depthWrite: false, map: dotTexture(), alphaTest: 0.01 }),
    );
    this.weather.frustumCulled = false;
    this.group.add(this.weather);

    // Water surface seen from below.
    this.surfaceMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(0xcdeee9) }, uCamPos: { value: new THREE.Vector3() }, uFogCol: { value: new THREE.Color() }, uFogDensity: { value: 0.03 }, uSurfY: { value: 0 } },
      vertexShader: surfVert,
      fragmentShader: surfFrag,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.surface = new THREE.Mesh(new THREE.PlaneGeometry(400, 400, 1, 1), this.surfaceMat);
    this.surface.rotation.x = Math.PI / 2;
    this.group.add(this.surface);

    // Fixed pool of point lights: always present (intensity 0 when free) so
    // shader programs never recompile when glow balls appear.
    for (let i = 0; i < 8; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 8, 1.6);
      l.position.set(0, -1000, 0);
      this.group.add(l);
      this.lights.push({ light: l, used: false });
    }
    scene.add(this.group);
  }

  borrowLight(): PooledLight | null {
    const slot = this.lights.find((l) => !l.used);
    if (!slot) return null;
    slot.used = true;
    return {
      light: slot.light,
      release: () => {
        slot.used = false;
        slot.light.intensity = 0;
        slot.light.position.set(0, -1000, 0);
      },
    };
  }

  releaseAllLights(): void {
    for (const l of this.lights) {
      l.used = false;
      l.light.intensity = 0;
      l.light.position.set(0, -1000, 0);
    }
  }

  apply(env: StageEnvironment, scene: THREE.Scene, renderer: THREE.WebGLRenderer, quality: 'fancy' | 'simple'): void {
    this.env = env;
    if (env.sky) {
      this.sky.visible = true;
      this.skyMat.uniforms.uTop.value.set(env.sky.top);
      this.skyMat.uniforms.uHorizon.value.set(env.sky.horizon);
      this.skyMat.uniforms.uBottom.value.set(env.sky.bottom);
      this.skyMat.uniforms.uSunColor.value.set(env.sky.sunColor ?? '#fff3d8');
      this.skyMat.uniforms.uSunSize.value = env.sky.sunSize ?? 1;
      scene.background = null;
    } else {
      this.sky.visible = false;
      scene.background = new THREE.Color(env.background ?? env.fog.color);
    }
    scene.fog = new THREE.FogExp2(new THREE.Color(env.fog.color), env.fog.density);
    this.hemi.color.set(env.hemi.sky);
    this.hemi.groundColor.set(env.hemi.ground);
    this.hemi.intensity = env.hemi.intensity;
    this.sun.color.set(env.sun.color);
    this.sun.intensity = env.sun.intensity;
    this.sunDir.set(env.sun.dir[0], env.sun.dir[1], env.sun.dir[2]).normalize();
    this.skyMat.uniforms.uSunDir.value.copy(this.sunDir);
    this.sun.castShadow = env.sun.shadows && quality === 'fancy';
    this.sun.shadow.mapSize.set(quality === 'fancy' ? 2048 : 1024, quality === 'fancy' ? 2048 : 1024);
    this.sun.shadow.map?.dispose();
    (this.sun.shadow as unknown as { map: THREE.WebGLRenderTarget | null }).map = null;
    this.ambient.color.set(env.ambient?.color ?? '#ffffff');
    this.ambient.intensity = env.ambient?.intensity ?? 0;
    renderer.toneMappingExposure = env.exposure;
    const uw = env.underwater;
    this.shaftGroup.visible = !!uw && uw.shafts > 0;
    this.snow.visible = !!uw && uw.snow > 0;
    this.surface.visible = !!uw && uw.surfaceY !== null;
    if (uw) {
      if (uw.surfaceY !== null) {
        this.surface.position.y = uw.surfaceY;
        this.surfaceMat.uniforms.uSurfY.value = uw.surfaceY;
      }
      this.surfaceMat.uniforms.uFogCol.value.set(env.fog.color);
      this.surfaceMat.uniforms.uFogDensity.value = env.fog.density;
      for (const s of this.shafts) (s.material as THREE.ShaderMaterial).uniforms.uOpacity.value = 0.13 * uw.shafts;
      (this.snow.material as THREE.PointsMaterial).opacity = 0.5 * Math.min(1.5, uw.snow);
      this.surfaceMat.uniforms.uColor.value.set(uw.tint).lerp(new THREE.Color(0xffffff), 0.35);
    }
    const w = env.weather;
    this.weather.visible = !!w;
    if (w) {
      const pm = this.weather.material as THREE.PointsMaterial;
      pm.color.set(w.color);
      pm.size = w.kind === 'snow' ? 0.14 : w.kind === 'pollen' ? 0.07 : 0.06;
      pm.opacity = w.kind === 'snow' ? 0.9 : 0.6;
      this.weather.geometry.setDrawRange(0, Math.floor(1800 * Math.min(1, w.density)));
    }
    this.releaseAllLights();
  }

  update(dt: number, t: number, cam: THREE.Camera, focus: THREE.Vector3): void {
    this.sky.position.copy(cam.position);
    // Shadow frustum follows Ace, snapped to texels to avoid shimmering.
    const texel = (this.shadowSize * 2) / this.sun.shadow.mapSize.x;
    const fx = Math.round(focus.x / texel) * texel;
    const fz = Math.round(focus.z / texel) * texel;
    this.sun.target.position.set(fx, focus.y, fz);
    this.sun.position.set(fx + this.sunDir.x * 70, focus.y + this.sunDir.y * 70, fz + this.sunDir.z * 70);
    this.sun.target.updateMatrixWorld();
    causticUniforms.uCausticTime.value = t;
    const env = this.env;
    if (!env) return;
    if (env.underwater) {
      const uw = env.underwater;
      const top = uw.surfaceY ?? cam.position.y + 14;
      for (let i = 0; i < this.shafts.length; i++) {
        const s = this.shafts[i];
        const off = s.userData.offset as THREE.Vector3;
        // Each shaft repeats on a 60 m tile; use the copy nearest the camera.
        const wx = off.x + Math.round((cam.position.x - off.x) / 60) * 60;
        const wz = off.z + Math.round((cam.position.z - off.z) / 60) * 60;
        const height = 26;
        s.position.set(wx, top - height, wz);
        s.scale.set(s.userData.w as number, height, 1);
        s.rotation.set(0, Math.atan2(cam.position.x - wx, cam.position.z - wz), 0.18 + Math.sin(t * 0.2 + i) * 0.05);
        (s.material as THREE.ShaderMaterial).uniforms.uTime.value = t;
      }
      const p = this.snowPos;
      for (let i = 0; i < p.length / 3; i++) {
        p[i * 3 + 1] -= this.snowVel[i] * dt * 0.4;
        p[i * 3] += Math.sin(t * 0.3 + i) * dt * 0.05;
        // Wrap around camera.
        for (let k = 0; k < 3; k++) {
          const half = k === 1 ? 12 : 20;
          const c = k === 0 ? cam.position.x : k === 1 ? cam.position.y : cam.position.z;
          let v = p[i * 3 + k] - c;
          if (v > half) v -= half * 2;
          else if (v < -half) v += half * 2;
          p[i * 3 + k] = c + v;
        }
      }
      (this.snow.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      this.surfaceMat.uniforms.uTime.value = t;
      this.surfaceMat.uniforms.uCamPos.value.copy(cam.position);
    }
    if (env.weather) {
      const w = env.weather;
      const p = this.weatherPos;
      const fall = w.kind === 'snow' ? 1.3 : w.kind === 'leaves' ? 0.8 : 0.15;
      for (let i = 0; i < p.length / 3; i++) {
        p[i * 3 + 1] -= fall * dt * (0.6 + (i % 7) * 0.08);
        p[i * 3] += Math.sin(t * 0.6 + i * 0.7) * dt * 0.35;
        p[i * 3 + 2] += Math.cos(t * 0.5 + i * 0.3) * dt * 0.3;
        if (w.kind !== 'snow') p[i * 3 + 1] += Math.sin(t + i) * dt * 0.2;
        for (const k of [0, 2]) {
          const c = k === 0 ? cam.position.x : cam.position.z;
          let v = p[i * 3 + k] - c;
          if (v > 30) v -= 60;
          else if (v < -30) v += 60;
          p[i * 3 + k] = c + v;
        }
        const yb = cam.position.y - 6;
        if (p[i * 3 + 1] < yb) p[i * 3 + 1] += 24;
        else if (p[i * 3 + 1] > yb + 24) p[i * 3 + 1] -= 24;
      }
      (this.weather.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    }
  }
}

let dotTex: THREE.Texture | null = null;
function dotTexture(): THREE.Texture {
  if (dotTex) return dotTex;
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(16, 16, 0, 16, 16, 15);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.5, 'rgba(255,255,255,0.6)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 32, 32);
  dotTex = new THREE.CanvasTexture(c);
  return dotTex;
}

/** Soft, slowly drifting cloud puffs for open-sky stages. */
export function makeClouds(count: number, radius: number, height: number, color = 0xffffff, seed = 3): THREE.Group {
  const g = new THREE.Group();
  const m = new THREE.MeshStandardMaterial({ color, roughness: 1, emissive: color, emissiveIntensity: 0.35, transparent: true, opacity: 0.92, fog: false });
  const sphere = new THREE.SphereGeometry(1, 16, 10);
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < count; i++) {
    const cloud = new THREE.Group();
    const n = 4 + Math.floor(rnd() * 4);
    for (let k = 0; k < n; k++) {
      const p = new THREE.Mesh(sphere, m);
      const sz = 3 + rnd() * 4;
      p.scale.set(sz * 1.3, sz * 0.7, sz);
      p.position.set((k - n / 2) * 3.2 + rnd() * 2, rnd() * 1.5, rnd() * 3);
      cloud.add(p);
    }
    const a = (i / count) * Math.PI * 2 + rnd();
    const r = radius * (0.6 + rnd() * 0.4);
    cloud.position.set(Math.cos(a) * r, height + rnd() * 20, Math.sin(a) * r);
    cloud.rotation.y = rnd() * Math.PI;
    cloud.userData.speed = 0.01 + rnd() * 0.02;
    g.add(cloud);
  }
  // One draw call for the whole sky of clouds.
  const merged = mergeStatic(g, false, false);
  merged.userData.tick = (dt: number) => {
    merged.rotation.y += dt * 0.004;
  };
  return merged;
}
