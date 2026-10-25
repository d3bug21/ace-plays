import * as THREE from 'three';

// Wobbly thin-film soap bubble. Iridescence is deliberately desaturated so the
// bubbles shimmer gently instead of shouting rainbow colours.

const vertex = /* glsl */ `
  uniform float uTime;
  uniform float uWobble;
  varying vec3 vN;
  varying vec3 vV;
  varying vec3 vWorld;
  varying float vSeed;
  #include <common>
  #include <fog_pars_vertex>
  void main() {
    mat4 mm = modelMatrix;
    #ifdef USE_INSTANCING
      mm = modelMatrix * instanceMatrix;
    #endif
    vec3 origin = vec3(mm[3][0], mm[3][1], mm[3][2]);
    float seed = dot(origin, vec3(1.7, 3.1, 2.3));
    vec3 p = position;
    float w = sin(uTime * 6.0 + p.y * 4.0 + seed) * 0.55 + sin(uTime * 4.7 + p.x * 5.0 - seed * 1.3) * 0.45;
    p += normal * w * uWobble;
    vec4 wp = mm * vec4(p, 1.0);
    vWorld = wp.xyz;
    vN = normalize(mat3(mm) * normal);
    vV = normalize(cameraPosition - wp.xyz);
    vSeed = seed;
    vec4 mvPosition = viewMatrix * wp;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const fragment = /* glsl */ `
  uniform float uTime;
  uniform float uOpacity;
  uniform vec3 uTint;
  uniform vec3 uLightDir;
  uniform float uFilm;
  uniform float uGlow;
  varying vec3 vN;
  varying vec3 vV;
  varying vec3 vWorld;
  varying float vSeed;
  #include <common>
  #include <fog_pars_fragment>
  void main() {
    vec3 N = normalize(vN);
    vec3 V = normalize(vV);
    float ndv = dot(N, V);
    if (!gl_FrontFacing) N = -N;
    float fres = 1.0 - abs(ndv);
    float f = pow(fres, 2.4);
    float swirl = sin(vWorld.y * 3.1 + uTime * 1.3 + vSeed) * 0.16
                + sin(dot(N, vec3(2.0, 1.0, 3.0)) * 2.3 + uTime * 0.9 + vSeed * 0.5) * 0.12;
    float h = fres * 1.15 + swirl + uTime * 0.04;
    vec3 film = 0.5 + 0.5 * cos(6.2831 * (h + vec3(0.0, 0.33, 0.67)));
    float lum = dot(film, vec3(0.333));
    film = mix(vec3(lum), film, 0.5 * uFilm);
    vec3 col = mix(uTint, film, 0.55 * uFilm + 0.15);
    vec3 R = reflect(-V, N);
    float spec = pow(max(dot(R, normalize(uLightDir)), 0.0), 70.0);
    float spec2 = pow(max(dot(R, normalize(vec3(-0.5, 0.25, 0.6))), 0.0), 24.0) * 0.35;
    float rim = smoothstep(0.55, 1.0, fres);
    float alpha = clamp(0.05 + f * 0.7 + spec * 0.95 + spec2 + rim * 0.08, 0.0, 1.0) * uOpacity;
    vec3 outCol = col * (0.55 + f * 0.9) + vec3(spec + spec2) * 1.2 + uTint * uGlow;
    gl_FragColor = vec4(outCol, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

export interface BubbleMaterialOptions {
  tint?: THREE.ColorRepresentation;
  opacity?: number;
  wobble?: number;
  film?: number;
  glow?: number;
}

const materials: THREE.ShaderMaterial[] = [];

export function createBubbleMaterial(opts: BubbleMaterialOptions = {}): THREE.ShaderMaterial {
  const m = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        uWobble: { value: opts.wobble ?? 0.035 },
        uOpacity: { value: opts.opacity ?? 1 },
        uTint: { value: new THREE.Color(opts.tint ?? 0xcfe8ee) },
        uLightDir: { value: new THREE.Vector3(0.4, 0.8, 0.45) },
        uFilm: { value: opts.film ?? 1 },
        uGlow: { value: opts.glow ?? 0 },
      },
    ]),
    vertexShader: vertex,
    fragmentShader: fragment,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: true,
  });
  materials.push(m);
  return m;
}

/** Advance the shared wobble clock for every bubble material. */
export function tickBubbleMaterials(time: number): void {
  for (const m of materials) m.uniforms.uTime.value = time;
}

export function releaseBubbleMaterial(m: THREE.ShaderMaterial): void {
  const i = materials.indexOf(m);
  if (i >= 0) materials.splice(i, 1);
  m.dispose();
}

let sharedGeo: THREE.SphereGeometry | null = null;
export function bubbleGeometry(): THREE.SphereGeometry {
  if (!sharedGeo) sharedGeo = new THREE.SphereGeometry(1, 32, 20);
  return sharedGeo;
}
