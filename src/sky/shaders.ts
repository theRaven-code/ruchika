import type { IUniform } from 'three'

/**
 * Stereographic projection (the same family Stellarium uses for wide fields):
 * an angle θ from the view centre maps to radius tan(θ/2). `uProjScale` is
 * 1 / tan(fovY / 4) so the top edge of the viewport sits at fovY / 2.
 */
export const PROJECT_GLSL = /* glsl */ `
uniform float uProjScale;
uniform float uAspect;

// Camera looks down -Z. z is only used to clip points far behind the viewer.
vec4 skyProject(vec3 viewPos) {
  vec3 d = normalize(viewPos);
  float k = uProjScale / max(1.0 - d.z, 1e-5);
  return vec4(d.x * k / uAspect, d.y * k, d.z + 0.15, 1.0);
}
`

export const UNPROJECT_GLSL = /* glsl */ `
uniform float uProjScale;
uniform float uAspect;
uniform mat3 uCamRot;

vec3 skyUnproject(vec2 ndc) {
  vec2 p = vec2(ndc.x * uAspect, ndc.y) / uProjScale;
  float r2 = dot(p, p);
  return uCamRot * (vec3(2.0 * p, r2 - 1.0) / (1.0 + r2));
}
`

export const FULLSCREEN_VERTEX = /* glsl */ `
varying vec2 vNdc;
void main() {
  vNdc = position.xy;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

export type Uniforms = Record<string, IUniform>

export const projectionUniforms = (): Uniforms => ({
  uProjScale: { value: 1 },
  uAspect: { value: 1 },
})

/**
 * Sky radiance in linear HDR units: Preetham daylight scattering (ported from
 * three.js examples/jsm/objects/Sky.js, MIT) plus hand-tuned twilight, night
 * airglow and moonlight terms so the sky keeps colour after sunset.
 */
export const ATMOSPHERE_GLSL = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uMoonDir;
uniform float uMoonLight;
uniform float uTurbidity;
uniform float uRayleigh;

const float PI = 3.141592653589793;
const vec3 TOTAL_RAYLEIGH = vec3(5.804542996261093E-6, 1.3562911419845635E-5, 3.0265902468824876E-5);
const vec3 MIE_CONST = vec3(1.8399918514433978E14, 2.7798023919660528E14, 4.0790479543861094E14);

float sunIntensity(float zenithAngleCos) {
  zenithAngleCos = clamp(zenithAngleCos, -1.0, 1.0);
  return 1000.0 * max(0.0, 1.0 - exp(-((1.6110731556870734 - acos(zenithAngleCos)) / 1.5)));
}

float hgPhase(float cosTheta, float g) {
  float g2 = g * g;
  return 0.07957747154594767 * (1.0 - g2) / pow(1.0 - 2.0 * g * cosTheta + g2, 1.5);
}

vec3 preetham(vec3 dir, vec3 sunDir) {
  float sunE = sunIntensity(sunDir.y);
  vec3 betaR = TOTAL_RAYLEIGH * uRayleigh;
  vec3 betaM = 0.434 * (0.2 * uTurbidity) * 10E-18 * MIE_CONST * 0.005;
  float zenithAngle = acos(max(0.0, dir.y));
  float inv = 1.0 / (cos(zenithAngle) + 0.15 * pow(93.885 - degrees(zenithAngle), -1.253));
  vec3 fex = exp(-(betaR * 8.4E3 * inv + betaM * 1.25E3 * inv));
  float cosTheta = dot(dir, sunDir);
  float halfCos = cosTheta * 0.5 + 0.5;
  float rPhase = 0.05968310365946075 * (1.0 + halfCos * halfCos);
  vec3 betaTheta = betaR * rPhase + betaM * hgPhase(cosTheta, 0.8);
  vec3 lin = pow(sunE * (betaTheta / (betaR + betaM)) * (1.0 - fex), vec3(1.5));
  lin *= mix(vec3(1.0), pow(sunE * (betaTheta / (betaR + betaM)) * fex, vec3(0.5)),
             clamp(pow(1.0 - sunDir.y, 5.0), 0.0, 1.0));
  return lin * 0.04;
}

vec3 skyRadiance(vec3 dir) {
  float sunAlt = degrees(asin(clamp(uSunDir.y, -1.0, 1.0)));
  float up = max(dir.y, 0.0);
  vec3 col = vec3(0.0);

  if (sunAlt > -4.0) col += preetham(dir, uSunDir);

  // Twilight: warm band hugging the horizon under the Sun and a deepening
  // blue dome, fading out through nautical and astronomical twilight.
  float twilight = smoothstep(-19.0, -3.0, sunAlt) * (1.0 - smoothstep(2.0, 10.0, sunAlt));
  vec2 sunH = normalize(uSunDir.xz + vec2(1e-5));
  vec2 dirH = normalize(dir.xz + vec2(1e-5));
  // Clamped: pow() of a slightly negative base is NaN on the antisolar azimuth.
  float towardSun = clamp(0.5 + 0.5 * dot(sunH, dirH), 0.0, 1.0);
  float depth = clamp(-sunAlt / 18.0, 0.0, 1.0);
  float bandHeight = mix(0.45, 0.1, depth);
  vec3 warm = mix(vec3(1.0, 0.5, 0.22), vec3(0.6, 0.2, 0.14), depth);
  float glow = exp(-up / bandHeight) * pow(towardSun, 2.2) * exp(-depth * 3.2);
  vec3 dome = mix(vec3(0.045, 0.1, 0.27), vec3(0.002, 0.004, 0.012), pow(depth, 0.6));
  dome *= 0.55 + 0.45 * exp(-up * 2.5);
  // Belt of Venus: a faint pink band above the antisolar horizon.
  float belt = exp(-pow((up - mix(0.05, 0.16, depth)) / 0.06, 2.0)) * pow(1.0 - towardSun, 2.0)
             * (1.0 - smoothstep(0.0, 0.4, depth));
  col += twilight * (dome + warm * glow * 0.7 + vec3(0.35, 0.18, 0.22) * belt * 0.25);

  // Night sky: airglow brightens towards the horizon.
  col += mix(vec3(0.0026, 0.0031, 0.0056), vec3(0.0007, 0.001, 0.0024), sqrt(up));

  // Moonlit sky and the halo around the Moon.
  if (uMoonLight > 0.0) {
    float m = max(dot(dir, uMoonDir), 0.0);
    col += uMoonLight * (vec3(0.0045, 0.0075, 0.016) * (0.6 + 0.4 * exp(-up * 3.0))
         + vec3(0.03, 0.035, 0.045) * pow(m, 64.0));
  }
  return col;
}

vec3 tonemap(vec3 x) {
  x = clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
  return mix(x * 12.92, 1.055 * pow(x, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, x));
}
`

export const atmosphereUniforms = (): Uniforms => ({
  uSunDir: { value: null },
  uMoonDir: { value: null },
  uMoonLight: { value: 0 },
  uTurbidity: { value: 3.2 },
  uRayleigh: { value: 1.6 },
})
