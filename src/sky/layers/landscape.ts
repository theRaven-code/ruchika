import {
  CustomBlending,
  DataTexture,
  DataUtils,
  HalfFloatType,
  LinearFilter,
  Matrix3,
  Mesh,
  OneFactor,
  OneMinusSrcAlphaFactor,
  PlaneGeometry,
  RepeatWrapping,
  ClampToEdgeWrapping,
  RGBAFormat,
  ShaderMaterial,
} from 'three'
import type { HorizonData } from '../data'
import {
  ATMOSPHERE_GLSL,
  FULLSCREEN_VERTEX,
  UNPROJECT_GLSL,
  atmosphereUniforms,
  projectionUniforms,
} from '../shaders'

const MAX_LAYERS = 6

const fragmentShader = /* glsl */ `
varying vec2 vNdc;
uniform sampler2D uHorizon;
uniform float uLayers;
uniform float uDay;
uniform float uLandExposure;
uniform float uRefDist[${MAX_LAYERS}];
${UNPROJECT_GLSL}
${ATMOSPHERE_GLSL}

float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

float hash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// Value noise that wraps every 'period' cells in x so the panorama has no seam.
float wrappedNoise(vec2 p, float period) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float x0 = mod(i.x, period);
  float x1 = mod(i.x + 1.0, period);
  float a = hash21(vec2(x0, i.y));
  float b = hash21(vec2(x1, i.y));
  float c = hash21(vec2(x0, i.y + 1.0));
  float d = hash21(vec2(x1, i.y + 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// Forest edge along a ridge: a continuous canopy with conifers poking out.
// Cells are sized in metres at the band's reference distance so trees keep a
// sensible width; their angular height uses the true ridge distance.
float treeLift(float azN, float distM, int layer) {
  float refDist = uRefDist[layer];
  float canopyCells = floor(6.2831853 * refDist / 30.0);
  float liftM = 5.0 + 6.0 * wrappedNoise(vec2(azN * canopyCells, float(layer) * 13.0), canopyCells);
  for (int k = 0; k < 2; k++) {
    float cellM = k == 0 ? 6.5 : 10.0;
    float cells = floor(6.2831853 * refDist / cellM);
    float s = azN * cells;
    float cell = mod(floor(s), cells);
    float f = fract(s);
    float seed = cell + float(layer * 2 + k) * 7919.0;
    if (hash11(seed) > (layer == 0 ? 0.5 : 0.8)) continue;
    float height = mix(10.0, 24.0, hash11(seed * 1.37 + 3.1));
    float width = mix(0.55, 0.95, hash11(seed * 2.11 + 7.7));
    float cone = max(0.0, 1.0 - abs(f - 0.5) * 2.0 / width);
    // Slightly ragged sides, like tiers of branches.
    cone *= 0.92 + 0.08 * step(0.5, fract(cone * 5.0 + hash11(seed) ));
    liftM = max(liftM, height * cone);
  }
  return degrees(atan(liftM / max(distM, 40.0)));
}

vec3 layerColor(int layer, float depthDeg, float distM, float azN, float alt, vec3 haze, vec3 ambient) {
  float t = float(layer) / max(uLayers - 1.0, 1.0);
  vec3 albedo = mix(vec3(0.07, 0.105, 0.05), vec3(0.12, 0.14, 0.14), pow(t, 0.8));

  // Skylight from above plus direct sun on slopes facing away from the Sun;
  // slopes toward the Sun are backlit.
  float az = azN * 6.2831853;
  vec2 dirH = vec2(sin(az), -cos(az));
  vec2 sunH = normalize(uSunDir.xz + vec2(1e-5));
  float away = 0.5 - 0.5 * dot(dirH, sunH);
  float sunUp = smoothstep(-1.0, 15.0, degrees(asin(clamp(uSunDir.y, -1.0, 1.0))));
  float ambientLum = dot(ambient, vec3(0.2126, 0.7152, 0.0722));
  vec3 skylight = mix(vec3(ambientLum), ambient, 0.45);
  vec3 light = skylight * 1.3 + vec3(1.0, 0.92, 0.8) * ambientLum * 2.6 * sunUp * away * away;

  // Forest texture, scaled so features are tens of metres across.
  float refDist = uRefDist[layer];
  float period = floor(6.2831853 * refDist / 25.0);
  vec2 q = vec2(azN * period, radians(alt) * refDist / 25.0);
  float n = wrappedNoise(q, period) * 0.5 + wrappedNoise(q * 3.0, period * 3.0) * 0.3
          + wrappedNoise(q * 9.0, period * 9.0) * 0.2;

  vec3 col = albedo * light * (0.6 + 0.8 * n);
  col *= mix(1.0, 0.7, smoothstep(2.0, 25.0, depthDeg));
  // Starlight floor so the night landscape is not a flat void.
  col += vec3(0.0003, 0.0004, 0.0007) * (0.7 + 0.6 * n) * (1.0 + 2.0 * t);
  // Aerial perspective: distant ridges dissolve into the horizon sky, less so
  // at night so silhouettes stay readable against the starlit sky.
  // Uses the band's reference distance: per-sample ridge distances jump between
  // azimuths and would streak the haze.
  float aerial = (1.0 - exp(-refDist / 42000.0)) * mix(0.6, 1.0, uDay);
  return mix(col, haze, aerial);
}

void main() {
  vec3 dir = skyUnproject(vNdc);
  float alt = degrees(asin(clamp(dir.y, -1.0, 1.0)));
  float aa = max(fwidth(alt), 1e-4) * 0.8;
  if (alt > 45.0) discard;

  float azN = fract(atan(dir.x, -dir.z) / 6.2831853);
  vec3 haze = skyRadiance(normalize(vec3(dir.x, 0.02, dir.z)));
  vec3 ambient = skyRadiance(vec3(0.0, 1.0, 0.0));

  vec4 h[${MAX_LAYERS}];
  for (int i = 0; i < ${MAX_LAYERS}; i++) {
    h[i] = texture2D(uHorizon, vec2(azN, (float(i) + 0.5) / ${MAX_LAYERS}.0));
  }

  vec3 acc = vec3(0.0);
  float transmit = 1.0;
  for (int i = 0; i < ${MAX_LAYERS}; i++) {
    if (float(i) >= uLayers || transmit < 0.003) break;
    float ridge = h[i].r;
    if (ridge < -80.0) continue;
    float distM = h[i].g * 1000.0;
    if (i < 3) ridge += treeLift(azN, distM, i);
    float coverage = clamp((ridge - alt) / aa + 0.5, 0.0, 1.0);
    if (coverage <= 0.0) continue;
    acc += transmit * coverage * layerColor(i, ridge - alt, distM, azN, alt, haze, ambient);
    transmit *= 1.0 - coverage;
  }
  float alpha = 1.0 - transmit;
  if (alpha <= 0.0) discard;
  gl_FragColor = vec4(tonemap(acc * uLandExposure / alpha) * alpha, alpha);
}
`

export function createLandscape(horizon: HorizonData) {
  const layers = Math.min(horizon.altitude.length, MAX_LAYERS)
  const samples = horizon.altitude[0].length
  const data = new Uint16Array(samples * MAX_LAYERS * 4)
  for (let l = 0; l < MAX_LAYERS; l++) {
    for (let i = 0; i < samples; i++) {
      const k = (l * samples + i) * 4
      const alt = l < layers ? horizon.altitude[l][i] / 100 : -90
      data[k] = DataUtils.toHalfFloat(alt)
      data[k + 1] = DataUtils.toHalfFloat(l < layers ? horizon.distance[l][i] / 1000 : 0)
      data[k + 2] = 0
      data[k + 3] = DataUtils.toHalfFloat(1)
    }
  }
  const texture = new DataTexture(data, samples, MAX_LAYERS, RGBAFormat, HalfFloatType)
  texture.wrapS = RepeatWrapping
  texture.wrapT = ClampToEdgeWrapping
  texture.minFilter = LinearFilter
  texture.magFilter = LinearFilter
  texture.generateMipmaps = false
  texture.needsUpdate = true

  const refDist = horizon.bands.slice(0, MAX_LAYERS).map(([a, b]) => Math.sqrt(a * b))
  while (refDist.length < MAX_LAYERS) refDist.push(1e5)

  const uniforms = {
    ...projectionUniforms(),
    ...atmosphereUniforms(),
    uCamRot: { value: new Matrix3() },
    uHorizon: { value: texture },
    uLayers: { value: layers },
    uDay: { value: 0 },
    uLandExposure: { value: 1 },
    uRefDist: { value: refDist },
  }
  const material = new ShaderMaterial({
    uniforms,
    vertexShader: FULLSCREEN_VERTEX,
    fragmentShader,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: CustomBlending,
    blendSrc: OneFactor,
    blendDst: OneMinusSrcAlphaFactor,
  })
  const mesh = new Mesh(new PlaneGeometry(2, 2), material)
  mesh.frustumCulled = false
  mesh.renderOrder = 80

  /** Highest ridge (degrees) toward an azimuth, ignoring trees. */
  function ridgeAltitude(azDeg: number) {
    const x = (((azDeg % 360) + 360) % 360) / horizon.step
    const i0 = Math.floor(x) % samples
    const i1 = (i0 + 1) % samples
    const f = x - Math.floor(x)
    let best = -90
    for (let l = 0; l < layers; l++) {
      const a = horizon.altitude[l][i0] * (1 - f) + horizon.altitude[l][i1] * f
      best = Math.max(best, a / 100)
    }
    return best
  }

  return { mesh, uniforms, ridgeAltitude }
}
