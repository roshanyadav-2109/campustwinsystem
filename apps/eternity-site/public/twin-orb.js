/* Twin — the CampusTwin assistant: a living cell that goes through the stages of division.
   Usage: <canvas class="twin-orb" data-size="40"></canvas>  then  TwinOrb.mount(canvas)
   Cycle (11 s): rest → stretches and springs back (no division) → nucleus divides →
   furrow pinches, eases, pinches through → two daughter cells hop → merge back. */
(function () {
  const VS = "attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}";
  const FS = `precision highp float;
uniform vec2 R;uniform float T;uniform float Q;uniform float E;uniform float D;uniform float W;uniform float N;uniform float H;
float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1,0)),f.x),mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float v=0.,a=.5;for(int i=0;i<5;i++){v+=a*n(p);p=p*2.03+vec2(1.7,9.2);a*=.5;}return v;}
void main(){
  vec2 uv0=(gl_FragCoord.xy-.5*R)/min(R.x,R.y)*1.16;
  float tilt=.14*sin(T*.45);float cs=cos(tilt),sn=sin(tilt);
  vec2 uv=vec2(cs*uv0.x+sn*uv0.y,-sn*uv0.x+cs*uv0.y);
  /* jelly wobble */
  uv+=.009*Q*vec2(sin(uv0.y*13.+T*3.1),cos(uv0.x*12.+T*2.7));
  /* elongation along the division axis */
  vec2 q=uv/vec2(1.+E,1.-E*.42);
  float sep=smoothstep(0.,.2,D);
  float r=.30*mix(1.,.66,smoothstep(0.,.28,D))*(1.+.018*sin(T*1.8));
  vec2 c1=vec2(-D,H*.045*abs(sin(T*3.4))),c2=vec2(D,H*.045*abs(sin(T*3.4+1.7)));
  float fa=r*r/max(dot(q-c1,q-c1),1e-5),fb=r*r/max(dot(q-c2,q-c2),1e-5);
  float f=(fa+fb)*mix(.5,1.,sep);
  /* cleavage furrow: a waist that pinches in the middle */
  f*=1.-W*.62*exp(-(q.x*q.x)/(.006+.02*(1.-W)));
  float px=1.6/min(R.x,R.y);
  float edge=smoothstep(1.-px*2.5,1.+px*2.5,f);
  vec2 g=uv*1.8;vec2 w=vec2(fbm(g+T*.12),fbm(g+vec2(5.2,1.3)-T*.1));float l=fbm(g+1.6*w);
  float rim=1.-smoothstep(1.,2.6,f);
  /* warm glass membrane */
  float ml=clamp(.55+(-uv.x*.6+uv.y*.8)*.9+(l-.5)*.3,0.,1.);
  vec3 col=mix(vec3(1.,.9,.78),vec3(1.,.985,.95),ml);
  col=mix(col,vec3(1.,.7,.36),rim*.8);
  float alpha=edge*(.94+rim*.05);
  /* nuclei: one nucleus that stretches into a dumbbell and splits, then rides with each daughter */
  float nr=mix(.072,.084,N)*(1.+.04*sin(T*2.3));
  vec2 j1=.012*vec2(sin(T*2.2),cos(T*2.7)),j2=.012*vec2(cos(T*2.5),sin(T*2.1));
  vec2 n1=mix(vec2(-.12*N,0.),c1,smoothstep(.06,.28,D))+j1*N,n2=mix(vec2(.12*N,0.),c2,smoothstep(.06,.28,D))+j2*N;
  float fi=nr*nr/max(dot(q-n1,q-n1),1e-5),fr=nr*nr/max(dot(q-n2,q-n2),1e-5);
  float nf=(fi+fr)*mix(.62,1.,N),ne=smoothstep(1.-px*2.5,1.+px*2.5,nf)*edge;
  float wA=fi/max(fi+fr,1e-5);
  float nl=clamp(.5+(-q.x*.8+q.y)*2.2+(l-.5)*.3,0.,1.);
  vec3 gold=mix(vec3(.95,.6,0.),vec3(1.,.87,.38),smoothstep(.3,1.,nl));
  vec3 orng=mix(vec3(.92,.34,.03),vec3(1.,.66,.32),smoothstep(.3,1.,nl));
  col=mix(col,mix(orng,gold,smoothstep(.3,.7,wA)),ne);alpha=mix(alpha,1.,ne);
  float glow=smoothstep(.35,1.,f)*(1.-edge)*smoothstep(.58,.42,max(abs(uv0.x),abs(uv0.y)));
  vec3 gc=vec3(1.,.66,.28);
  gl_FragColor=vec4(col*alpha,alpha);
}`;
  /* targets per stage: [start, E elongation, D half-separation, W furrow, N nuclear split, H hop] */
  const CYCLE = 11;
  const STAGES = [
    [0.0, 0, 0, 0, 0, 0],          // rest
    [1.6, .30, 0, 0, .35, 0],      // tries: stretches, nucleus starts to stretch
    [2.4, 0, 0, 0, 0, 0],          // springs back, no division
    [4.0, .32, 0, 0, 1, 0],        // stretches again, nucleus divides
    [5.0, .34, .10, .62, 1, 0],    // furrow forms
    [6.0, .30, .08, .42, 1, 0],    // furrow eases, straining
    [6.4, .18, .28, 1, 1, 0],      // pinches through
    [7.3, 0, .28, 1, 1, 1],        // two daughter cells, hopping
    [9.6, .14, 0, 0, 0, 0],        // merge back
    [10.5, 0, 0, 0, 0, 0]          // rest
  ];
  const KEYS = 5, STIFF = [130, 120, 150, 90, 70], DAMP = [11, 13, 14, 12, 12];
  /* the spring motion is solved once into a lookup table, shared by every Twin on the page */
  const HZ = 120, LUT = (() => {
    const n = Math.ceil(CYCLE * HZ) + 1, out = new Float32Array(n * KEYS), x = [0, 0, 0, 0, 0], v = [0, 0, 0, 0, 0], dt = 1 / HZ;
    let si = 0;
    for (let i = 0; i < n; i++) {
      const s = i * dt;
      for (let k = 0; k < KEYS; k++) out[i * KEYS + k] = x[k];
      while (si + 1 < STAGES.length && s >= STAGES[si + 1][0]) si++;
      for (let k = 0; k < KEYS; k++) { const a = STIFF[k] * (STAGES[si][k + 1] - x[k]) - DAMP[k] * v[k]; v[k] += a * dt; x[k] += v[k] * dt; }
    }
    return out;
  })();
  function sim(t) {
    const f = (t % CYCLE) * HZ, i = Math.floor(f), u = f - i, x = [];
    for (let k = 0; k < KEYS; k++) x[k] = LUT[i * KEYS + k] + (LUT[(i + 1) * KEYS + k] - LUT[i * KEYS + k]) * u;
    return { E: x[0], D: Math.max(0, x[1]), W: Math.min(1.1, Math.max(0, x[2])), N: Math.min(1, Math.max(0, x[3])), H: Math.max(0, x[4]) };
  }
  function mount(canvas, opt = {}) {
    const size = +(canvas.dataset.size || 40), wob = canvas.dataset.calm != null ? .35 : 1;
    /* render resolution follows browser zoom / screen density, with headroom so small sizes stay crisp */
    const fit = () => { const px = Math.round(size * Math.min(Math.max((window.devicePixelRatio || 1) * 1.25, 1.5), 4)); if (canvas.width !== px) canvas.width = canvas.height = px; };
    fit();
    canvas.style.width = canvas.style.height = size + "px";
    const gl = canvas.getContext("webgl", { premultipliedAlpha: true, alpha: true, antialias: true });
    if (!gl) { canvas.replaceWith(Object.assign(document.createElement("span"), { className: "twin-fallback" })); return; }
    const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); return o; };
    const pr = gl.createProgram(); gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(pr); gl.useProgram(pr);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(pr, "p"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const U = {}; ["R", "T", "Q", "E", "D", "W", "N", "H"].forEach(k => U[k] = gl.getUniformLocation(pr, k));
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    const off = opt.offset != null ? opt.offset : Math.random() * CYCLE, t0 = performance.now();
    function draw(t) {
      const p = sim(t);
      fit(); gl.viewport(0, 0, canvas.width, canvas.height); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(U.R, canvas.width, canvas.height); gl.uniform1f(U.T, t); gl.uniform1f(U.Q, wob);
      gl.uniform1f(U.E, p.E); gl.uniform1f(U.D, p.D); gl.uniform1f(U.W, p.W); gl.uniform1f(U.N, p.N); gl.uniform1f(U.H, p.H);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    if (opt.time != null) { draw(opt.time); return { draw }; }
    let vis = true; new IntersectionObserver(e => vis = e[0].isIntersecting).observe(canvas);
    (function loop() { if (vis) draw(off + (performance.now() - t0) / 1000); requestAnimationFrame(loop); })();
    return { draw };
  }
  window.TwinOrb = { mount };
})();
