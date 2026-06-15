import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { useReducedMotion } from "@/hooks/useReducedMotion";

/**
 * Marble background — a WebGL fragment shader that domain-warps fractal noise
 * (iq's warp technique) into smooth swirling veins, like the inside of a glass
 * marble. Slowly animated and gently swelled around the cursor. Cool palette,
 * theme-aware, and reduced-motion-safe (renders a single still frame).
 *
 * Raw WebGL (no three.js) so it stays light. If WebGL/compile fails it simply
 * renders nothing — the aurora underneath still shows.
 */

const VERT = `
attribute vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }
`;

const FRAG = `
precision highp float;
uniform vec2 u_res;
uniform float u_time;
uniform vec2 u_mouse;
uniform float u_dark;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 345.45));
  p += dot(p, p + 34.345);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p = p * 2.0 + vec2(13.7, 7.3);
    a *= 0.5;
  }
  return v;
}
void main() {
  vec2 uv = gl_FragCoord.xy / u_res.xy;
  float aspect = u_res.x / u_res.y;
  vec2 p = vec2(uv.x * aspect, uv.y) * 2.2;
  p.y -= u_time * 0.038; // slow upward drift of the marble and its veins
  float t = u_time * 0.032;

  vec2 m = u_mouse / u_res.xy;
  float md = distance(vec2(uv.x * aspect, uv.y), vec2(m.x * aspect, m.y));

  // Double domain warp → marble swirl.
  vec2 q = vec2(fbm(p + t), fbm(p + vec2(5.2, 1.3) - t));
  vec2 r = vec2(
    fbm(p + 3.5 * q + vec2(1.7, 9.2) + 0.5 * t),
    fbm(p + 3.5 * q + vec2(8.3, 2.8) - 0.5 * t)
  );
  float f = fbm(p + 3.5 * r);
  f += 0.18 * exp(-md * 3.5); // cursor swells the marble

  // Muted, desaturated stone palette (slate / gray-blue / mauve).
  vec3 deep   = vec3(0.22, 0.24, 0.30);
  vec3 blue   = vec3(0.44, 0.49, 0.58);
  vec3 teal   = vec3(0.42, 0.52, 0.54);
  vec3 violet = vec3(0.50, 0.47, 0.56);

  // Tighter transition between regions → crisper marble edges.
  vec3 col = mix(deep, blue, smoothstep(0.34, 0.62, f));
  col = mix(col, teal, clamp(length(q) * 0.8, 0.0, 1.0));
  col = mix(col, violet, clamp(length(r) * 0.7, 0.0, 1.0));

  // Keep the background light: wash the base toward off-white first.
  if (u_dark < 0.5) {
    col = mix(vec3(0.93, 0.94, 0.97), col, 0.34);
  }

  // Deeper veins, added after the wash so they stay rich and dark.
  float vd = abs(f - 0.5);
  vec3 deepVein = (u_dark < 0.5) ? vec3(0.16, 0.19, 0.30) : vec3(0.08, 0.10, 0.18);
  col = mix(col, deepVein, smoothstep(0.026, 0.0, vd) * 0.5);

  // Sometimes a thin, sharp vein flares up and pierces the frost. A sparse,
  // slowly-drifting field gates where (and when) that happens.
  float pierce = smoothstep(0.60, 0.82, fbm(p * 0.45 + vec2(3.0, u_time * 0.012)));
  col = mix(col, deepVein, smoothstep(0.008, 0.0, vd) * pierce * 0.9);

  gl_FragColor = vec4(col, 0.95);
}
`;

export function MarbleField({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl =
      canvas.getContext("webgl", { alpha: true, antialias: true, premultipliedAlpha: false }) ??
      canvas.getContext("experimental-webgl", { alpha: true });
    if (!gl || !(gl instanceof WebGLRenderingContext)) return;

    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type);
      if (!sh) return null;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        console.warn("[MarbleField] shader:", gl.getShaderInfoLog(sh));
        return null;
      }
      return sh;
    };

    const vs = compile(gl.VERTEX_SHADER, VERT);
    const fs = compile(gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return;

    const prog = gl.createProgram();
    if (!prog) return;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.warn("[MarbleField] link:", gl.getProgramInfoLog(prog));
      return;
    }
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "p");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(prog, "u_res");
    const uTime = gl.getUniformLocation(prog, "u_time");
    const uMouse = gl.getUniformLocation(prog, "u_mouse");
    const uDark = gl.getUniformLocation(prog, "u_dark");

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    let raf = 0;
    let running = true;
    const mouse = { x: -9999, y: -9999 };

    const resize = () => {
      // The marble sits under a soft wash at low opacity, so render the backing
      // store well below display resolution and let the browser upscale —
      // invisibly softer, but a fraction of the fragment-shader cost.
      const dpr = Math.min(window.devicePixelRatio || 1, 1);
      const scale = 0.6;
      canvas.width = Math.max(1, Math.floor(canvas.clientWidth * dpr * scale));
      canvas.height = Math.max(1, Math.floor(canvas.clientHeight * dpr * scale));
      gl.viewport(0, 0, canvas.width, canvas.height);
    };

    const frame = (timeMs: number) => {
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uTime, timeMs * 0.001);
      gl.uniform2f(uMouse, mouse.x, mouse.y);
      gl.uniform1f(uDark, document.documentElement.classList.contains("dark") ? 1 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    // Cap to ~30fps and skip work while the tab is hidden or the background has
    // fully faded out (data-bg-hidden, set by the landing once it scrolls past
    // the fade). It keeps running during scroll while still visible — at low
    // resolution + 30fps its GPU cost coexists fine with scroll compositing.
    const FRAME_MS = 1000 / 30;
    let last = -Infinity;
    const loop = (timeMs: number) => {
      if (!running) return;
      raf = requestAnimationFrame(loop);
      if (document.hidden) return;
      if (document.documentElement.hasAttribute("data-bg-hidden")) return;
      if (timeMs - last < FRAME_MS) return;
      last = timeMs;
      frame(timeMs);
    };

    const onMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const sx = canvas.width / rect.width;
      const sy = canvas.height / rect.height;
      mouse.x = (e.clientX - rect.left) * sx;
      // WebGL origin is bottom-left; flip Y.
      mouse.y = canvas.height - (e.clientY - rect.top) * sy;
    };
    const onLeave = () => {
      mouse.x = -9999;
      mouse.y = -9999;
    };

    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerleave", onLeave);

    if (reduced) {
      frame(3000);
    } else {
      raf = requestAnimationFrame(loop);
    }

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerleave", onLeave);
      gl.deleteProgram(prog);
      gl.deleteBuffer(buf);
    };
  }, [reduced]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={cn("block h-full w-full", className)}
    />
  );
}

export default MarbleField;
