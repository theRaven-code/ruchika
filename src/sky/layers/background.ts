import { Matrix3, Mesh, PlaneGeometry, ShaderMaterial, Texture } from 'three'
import {
  ATMOSPHERE_GLSL,
  FULLSCREEN_VERTEX,
  UNPROJECT_GLSL,
  atmosphereUniforms,
  projectionUniforms,
} from '../shaders'

const fragmentShader = /* glsl */ `
varying vec2 vNdc;
uniform mat3 uWorldToEqj;
uniform sampler2D uMilkyWay;
uniform float uMilkyWayStrength;
uniform float uAtmosphere;
uniform float uExposure;
${UNPROJECT_GLSL}
${ATMOSPHERE_GLSL}

void main() {
  vec3 dir = skyUnproject(vNdc);
  vec3 col = vec3(0.0);

  if (uMilkyWayStrength > 0.001) {
    vec3 e = uWorldToEqj * dir;
    // Deep Star Maps: plate carree, RA 0h at the centre, increasing to the left.
    float ra = atan(e.y, e.x);
    float dec = asin(clamp(e.z, -1.0, 1.0));
    vec2 uv = vec2(fract(0.5 - ra / (2.0 * PI)), 0.5 + dec / PI);
    vec3 mw = texture2D(uMilkyWay, uv).rgb;
    col += pow(mw, vec3(2.4)) * uMilkyWayStrength;
  }

  if (uAtmosphere > 0.0) {
    col += skyRadiance(dir) * uAtmosphere;
  }
  gl_FragColor = vec4(tonemap(col * uExposure), 1.0);
}
`

export function createBackground(milkyWay: Texture) {
  const uniforms = {
    ...projectionUniforms(),
    ...atmosphereUniforms(),
    uCamRot: { value: new Matrix3() },
    uWorldToEqj: { value: new Matrix3() },
    uMilkyWay: { value: milkyWay },
    uMilkyWayStrength: { value: 0 },
    uAtmosphere: { value: 1 },
    uExposure: { value: 1 },
  }
  const material = new ShaderMaterial({
    uniforms,
    vertexShader: FULLSCREEN_VERTEX,
    fragmentShader,
    depthTest: false,
    depthWrite: false,
  })
  const mesh = new Mesh(new PlaneGeometry(2, 2), material)
  mesh.frustumCulled = false
  mesh.renderOrder = 0
  return { mesh, uniforms }
}
