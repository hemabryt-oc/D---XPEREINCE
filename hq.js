/* ============================================================
   E³ HQ — ENGINE v4  (Competition Grade)
   ─────────────────────────────────────────────────────────────
   Spring-physics camera · Pinch-zoom forward/back · Gyroscope
   look · Panel approach animation · Per-room particles ·
   Reflective floor · GLSL vignette+grain shader · Walk bob
   with footstep audio · Canvas label textures · Time-of-day
   lighting · URL hash deep-link · Corridor progress bar ·
   Keyboard shortcuts · Room entry sound signatures ·
   Swipe-down card dismiss · Full mobile polish
   ============================================================ */
(function () {
  'use strict';

  /* ── ROOM REGISTRY ─────────────────────────────────────── */
  const ROOMS = [
    { id:'index',        icon:'🏛️', label:'Entrance',     file:'index.html',        accentHex:'#c9a84c', accentInt:0xc9a84c, wallHex:0x0c0d0a, floorHex:0x080906, transition:'walk',   fogDensity:0.050, freq:55   },
    { id:'about',        icon:'◆',  label:'About E³',     file:'about.html',        accentHex:'#c9a84c', accentInt:0xc9a84c, wallHex:0x0a0b10, floorHex:0x07080c, transition:'walk',   fogDensity:0.048, freq:61.7 },
    { id:'solutions',    icon:'⚙️', label:'Solutions',    file:'solutions.html',    accentHex:'#00c2ff', accentInt:0x00c2ff, wallHex:0x060c14, floorHex:0x04080f, transition:'walk',   fogDensity:0.046, freq:73.4 },
    { id:'industries',   icon:'🌍', label:'Industries',   file:'industries.html',   accentHex:'#64c864', accentInt:0x64c864, wallHex:0x060e08, floorHex:0x040a06, transition:'walk',   fogDensity:0.048, freq:65.4 },
    { id:'case-studies', icon:'📁', label:'Case Studies', file:'case-studies.html', accentHex:'#ff9f43', accentInt:0xff9f43, wallHex:0x130c06, floorHex:0x0e0804, transition:'walk',   fogDensity:0.050, freq:82.4 },
    { id:'insights',     icon:'📖', label:'Insights',     file:'insights.html',     accentHex:'#a78bfa', accentInt:0xa78bfa, wallHex:0x0d0814, floorHex:0x09050f, transition:'stairs', fogDensity:0.044, freq:98   },
    { id:'contact',      icon:'✉️', label:'Contact',      file:'contact.html',      accentHex:'#c9a84c', accentInt:0xc9a84c, wallHex:0x0e0a08, floorHex:0x080604, transition:'stairs', fogDensity:0.046, freq:110  },
  ];

  const CFG = window.ROOM_CONFIG || {};
  const R   = ROOMS.find(r => r.id === (CFG.id || 'index')) || ROOMS[0];

  /* ── ACCENT CSS ─────────────────────────────────────────── */
  function setAccent(h) {
    const d = document.documentElement;
    d.style.setProperty('--accent', h);
    const n = parseInt(h.replace('#',''), 16);
    const rv=(n>>16)&255, gv=(n>>8)&255, bv=n&255;
    d.style.setProperty('--accent-dim',    `rgba(${rv},${gv},${bv},0.12)`);
    d.style.setProperty('--accent-border', `rgba(${rv},${gv},${bv},0.28)`);
  }
  setAccent(R.accentHex);

  /* ── THREE GLOBALS ──────────────────────────────────────── */
  let scene, camera, renderer, clock;
  let roomGroup = null;
  let hallMeshes = [];
  let dustMesh = null, roomParticles = null;
  let flickerLights = [];
  let panelMeshData = [];
  let accentFillLight = null;

  /* ── SPRING PHYSICS ─────────────────────────────────────── */
  class Spring {
    constructor(stiffness=160, damping=24, mass=1) {
      this.s=stiffness; this.d=damping; this.m=mass;
      this.value=0; this.velocity=0; this.target=0;
    }
    update(dt) {
      const f = -this.s*(this.value-this.target) - this.d*this.velocity;
      this.velocity += (f/this.m)*dt;
      this.value    += this.velocity*dt;
      return this.value;
    }
    set(v) { this.value=v; this.target=v; this.velocity=0; }
  }

  const yawSpring   = new Spring(120, 24, 1);
  const pitchSpring = new Spring(145, 26, 1);
  const zSpring     = new Spring(90,  20, 1);
  const ySpring     = new Spring(110, 22, 1);

  let camTargetYaw   = 0;
  let camTargetPitch = 0;
  let camTargetZ     = 6.5;
  let camTargetY     = 1.72;
  let gyroYaw=0, gyroPitch=0, gyroEnabled=false;

  /* ── WALK BOB ───────────────────────────────────────────── */
  let walkBobPhase=0, walkBobAmt=0, walkBobX=0;
  let wasMovingZ=false, lastBobDown=false;

  /* ── AUTO-FACE ──────────────────────────────────────────── */
  let autoFaceActive=false, autoFaceYaw=0, autoFaceStrength=0;
  const _camDir=new THREE.Vector3(), _toPanel=new THREE.Vector3();

  /* ── PINCH ──────────────────────────────────────────────── */
  let pinchLastDist=0, pinchActive=false;

  /* ── CARD SWIPE ─────────────────────────────────────────── */
  let cardSwipeStartY=0, cardSwipeActive=false;

  /* ── STATE ──────────────────────────────────────────────── */
  let state='loading';
  let isTransitioning=false;
  let cardOpen=false;

  /* ── INPUT ──────────────────────────────────────────────── */
  const keys={};
  let isDragging=false, dragLastX=0, dragLastY=0;
  let focusMode=false;

  /* ── DOOR ───────────────────────────────────────────────── */
  let doorGroup=null, leftDoor=null, rightDoor=null, handleL=null, handleR=null;

  /* ── SOUND ──────────────────────────────────────────────── */
  let audioCtx=null, masterGain=null;
  let soundEnabled=false, soundInitialized=false;
  let footstepPhase=false;

  /* ── TIME-OF-DAY ────────────────────────────────────────── */
  const hour = new Date().getHours();
  const TOD = hour>=6&&hour<12 ? {amb:0x14120e,exp:0.95,fog:R.fogDensity*0.92}
            : hour>=12&&hour<17? {amb:0x181410,exp:1.05,fog:R.fogDensity*0.88}
            : hour>=17&&hour<21? {amb:0x120c08,exp:0.88,fog:R.fogDensity*1.05}
            :                    {amb:0x08080e,exp:0.75,fog:R.fogDensity*1.18};

  const txLoader = new THREE.TextureLoader();
  txLoader.crossOrigin = 'anonymous';

  /* ── HELPERS ────────────────────────────────────────────── */
  function lerp(a,b,t){return a+(b-a)*t;}
  function clamp(v,lo,hi){return Math.max(lo,Math.min(hi,v));}
  function mkBox(w,h,d,col,rough=0.94,metal=0){
    const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),
      new THREE.MeshStandardMaterial({color:col,roughness:rough,metalness:metal}));
    m.castShadow=true; m.receiveShadow=true; return m;
  }
  function loadTex(url){
    return new Promise(res=>{
      txLoader.load(url,t=>{t.encoding=THREE.sRGBEncoding;res(t);},undefined,()=>res(null));
    });
  }

  /* ── CANVAS LABEL TEXTURE ───────────────────────────────── */
  function makeLabelTex(text){
    const c=document.createElement('canvas');
    c.width=512; c.height=96;
    const ctx=c.getContext('2d');
    ctx.fillStyle='#18150a'; ctx.fillRect(0,0,512,96);
    ctx.font='500 18px Inter,sans-serif';
    ctx.fillStyle=R.accentHex;
    ctx.textAlign='center';
    ctx.fillText(text.toUpperCase().slice(0,28),256,58);
    return new THREE.CanvasTexture(c);
  }

  /* ── RENDERER ───────────────────────────────────────────── */
  function initRenderer(){
    const wrap=document.getElementById('canvas-wrap');
    renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'high-performance'});
    renderer.setPixelRatio(Math.min(window.devicePixelRatio,1.8));
    renderer.setSize(window.innerWidth,window.innerHeight);
    renderer.shadowMap.enabled=true;
    renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    renderer.toneMapping=THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure=TOD.exp;
    renderer.outputEncoding=THREE.sRGBEncoding;
    wrap.appendChild(renderer.domElement);

    scene=new THREE.Scene();
    scene.fog=new THREE.FogExp2(0x03040a,TOD.fog);
    scene.background=new THREE.Color(0x03040a);

    camera=new THREE.PerspectiveCamera(72,window.innerWidth/window.innerHeight,0.05,80);
    camera.position.set(0,1.72,6.5);
    yawSpring.set(0); pitchSpring.set(0);
    zSpring.set(6.5); ySpring.set(1.72);

    clock=new THREE.Clock();
    window.addEventListener('resize',onResize);
  }

  /* ── TUNNEL ─────────────────────────────────────────────── */
  const TW=5.0,TH=4.2,TD=65;

  function buildTunnel(){
    const g=new THREE.Group();

    // Floor — reflective via MeshStandardMaterial metalness
    const floorMat=new THREE.MeshStandardMaterial({
      color:R.floorHex,roughness:0.18,metalness:0.55,
      envMapIntensity:0.4
    });
    const floor=new THREE.Mesh(new THREE.PlaneGeometry(TW,TD,1,60),floorMat);
    floor.rotation.x=-Math.PI/2;
    floor.position.set(0,0,-TD/2+8);
    floor.receiveShadow=true;
    g.add(floor);

    // Ceiling
    const ceil=new THREE.Mesh(new THREE.PlaneGeometry(TW,TD),
      new THREE.MeshStandardMaterial({color:0x040508,roughness:1}));
    ceil.rotation.x=Math.PI/2;
    ceil.position.set(0,TH,-TD/2+8);
    g.add(ceil);

    // Walls
    const wMat=new THREE.MeshStandardMaterial({color:R.wallHex,roughness:0.96});
    [-TW/2,TW/2].forEach((x,i)=>{
      const w=new THREE.Mesh(new THREE.PlaneGeometry(TD,TH),wMat.clone());
      w.rotation.y=i===0?Math.PI/2:-Math.PI/2;
      w.position.set(x,TH/2,-TD/2+8);
      w.receiveShadow=true;
      g.add(w);
    });
    const bk=new THREE.Mesh(new THREE.PlaneGeometry(TW,TH),wMat.clone());
    bk.position.set(0,TH/2,-TD+8); g.add(bk);

    // Skirting
    [-TW/2+0.04,TW/2-0.04].forEach(x=>{
      const sk=mkBox(0.055,0.11,TD,0x1a1610,0.9,0.05);
      sk.position.set(x,0.055,-TD/2+8); g.add(sk);
    });

    // Ceiling channel — accent glow
    const chanMat=new THREE.MeshStandardMaterial({
      color:R.accentInt,emissive:R.accentInt,emissiveIntensity:0.10,
      roughness:0.4,metalness:0.6
    });
    const chan=new THREE.Mesh(new THREE.BoxGeometry(0.22,0.05,TD),chanMat);
    chan.position.set(0,TH-0.025,-TD/2+8);
    g.add(chan);

    // Recessed ceiling light housings
    const housingMat=new THREE.MeshStandardMaterial({color:0x0c0c0e,roughness:0.7,metalness:0.3});
    for(let i=0;i<12;i++){
      const z=5-i*5.2;
      const housing=mkBox(0.26,0.06,0.26,0x0c0c0e,0.7,0.3);
      housing.position.set(0,TH-0.03,z); g.add(housing);
    }

    // Floor runner
    const runner=mkBox(0.48,0.008,TD,0x161310,0.99,0);
    runner.position.set(0,0.004,-TD/2+8); g.add(runner);

    // E³ logo on back wall — raised 3D letters
    buildBackWallLogo(g,0,TH*0.62,-TD+8.12);

    // Wall clock
    buildClock(g,0.8,TH*0.62,-TD+8.12);

    // Accent bounce
    const bounceL=new THREE.Mesh(new THREE.PlaneGeometry(TD*0.4,TH*0.5),
      new THREE.MeshStandardMaterial({color:R.accentInt,transparent:true,opacity:0.016,side:THREE.FrontSide}));
    bounceL.rotation.y=-Math.PI/2;
    bounceL.position.set(TW/2-0.01,TH*0.4,-TD/4);
    g.add(bounceL);

    return g;
  }

  function buildBackWallLogo(parent,x,y,z){
    const mat=new THREE.MeshStandardMaterial({
      color:R.accentInt,emissive:R.accentInt,emissiveIntensity:0.22,
      roughness:0.25,metalness:0.85
    });
    // E — three horizontal bars + vertical
    const parts=[
      [0.06,0.55,0.04, -0.22,0,0],   // vertical E
      [0.28,0.055,0.04,  -0.08, 0.22,0],  // E top
      [0.22,0.055,0.04,  -0.05, 0,0],     // E mid
      [0.28,0.055,0.04,  -0.08,-0.22,0],  // E bot
      [0.055,0.055,0.04,  0.12,0.18,0],   // ³ top
      [0.055,0.055,0.04,  0.12,0.04,0],   // ³ mid
      [0.055,0.055,0.04,  0.12,-0.10,0],  // ³ bot
    ];
    const g=new THREE.Group();
    parts.forEach(([w,h,d,px,py,pz])=>{
      const m=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat);
      m.position.set(px,py,pz+0.02); g.add(m);
    });
    g.scale.setScalar(1.1);
    g.position.set(x,y,z);
    parent.add(g);
  }

  /* ── CLOCK ──────────────────────────────────────────────── */
  function buildClock(parent,x,y,z){
    const g=new THREE.Group();
    g.add(mkBox(0.65,0.65,0.038,0x0e0c0a,0.6,0.2));
    const ring=new THREE.Mesh(new THREE.TorusGeometry(0.33,0.022,8,32),
      new THREE.MeshStandardMaterial({color:R.accentInt,emissive:R.accentInt,emissiveIntensity:0.28,roughness:0.3,metalness:0.8}));
    ring.position.z=0.022; g.add(ring);
    const hh=mkBox(0.038,0.18,0.014,R.accentInt,0.4,0.6);
    hh.position.set(0,0.055,0.038); hh.name='hourHand'; g.add(hh);
    const mh=mkBox(0.024,0.26,0.014,0xe8e0cc,0.5,0.3);
    mh.position.set(0,0.085,0.048); mh.name='minHand'; g.add(mh);
    const pin=new THREE.Mesh(new THREE.CylinderGeometry(0.018,0.018,0.055,8),
      new THREE.MeshStandardMaterial({color:R.accentInt,metalness:0.9,roughness:0.2}));
    pin.rotation.x=Math.PI/2; pin.position.z=0.055; g.add(pin);
    g.position.set(x,y,z);
    parent.add(g);
  }

  let clockAcc=0;
  function updateClock(){
    if(!roomGroup)return;
    const n=new Date(),h=n.getHours()%12,m=n.getMinutes(),s=n.getSeconds();
    const ha=-(h/12+m/720)*Math.PI*2, ma=-(m/60+s/3600)*Math.PI*2;
    roomGroup.traverse(o=>{
      if(o.name==='hourHand') o.rotation.z=ha;
      if(o.name==='minHand')  o.rotation.z=ma;
    });
  }

  /* ── LIGHTING ───────────────────────────────────────────── */
  function buildLighting(parent){
    flickerLights=[];
    parent.add(new THREE.AmbientLight(TOD.amb,0.24));

    const COUNT=12,SPACING=5.2;
    for(let i=0;i<COUNT;i++){
      const z=5-i*SPACING;
      const intensity=i<3?2.4:(i<7?1.9:1.3);
      const spot=new THREE.SpotLight(0xfff3d8,intensity,15,Math.PI/8,0.26,2.2);
      spot.position.set(0,TH-0.08,z);
      spot.target.position.set(0,0,z-0.4);
      spot.castShadow=(i<5);
      if(i<5) spot.shadow.mapSize.set(512,512);
      parent.add(spot); parent.add(spot.target);
      if(i===7||i===9) flickerLights.push(spot);
    }

    accentFillLight=new THREE.PointLight(R.accentInt,0.4,24);
    accentFillLight.position.set(0,TH-0.08,0);
    parent.add(accentFillLight);

    const fill=new THREE.DirectionalLight(0x3a2e1a,0.13);
    fill.position.set(0,3,12); parent.add(fill);
  }

  /* ── DUST ───────────────────────────────────────────────── */
  function buildDust(parent){
    const N=1100;
    const pos=new Float32Array(N*3),vel=new Float32Array(N*3);
    for(let i=0;i<N;i++){
      pos[i*3]=(Math.random()-0.5)*4.4;
      pos[i*3+1]=Math.random()*3.9+0.15;
      pos[i*3+2]=(Math.random()-0.5)*58-20;
      vel[i*3]=(Math.random()-0.5)*0.00032;
      vel[i*3+1]=(Math.random()-0.5)*0.00013;
      vel[i*3+2]=(Math.random()-0.5)*0.00022;
    }
    const geo=new THREE.BufferGeometry();
    geo.setAttribute('position',new THREE.BufferAttribute(pos,3));
    geo.setAttribute('velocity',new THREE.BufferAttribute(vel,3));
    dustMesh=new THREE.Points(geo,new THREE.PointsMaterial({
      color:0xffe8cc,size:0.015,transparent:true,opacity:0.10,
      blending:THREE.AdditiveBlending,depthWrite:false,sizeAttenuation:true
    }));
    dustMesh.renderOrder=999;
    parent.add(dustMesh);
  }

  function updateDust(t){
    if(!dustMesh)return;
    const p=dustMesh.geometry.attributes.position.array;
    const v=dustMesh.geometry.attributes.velocity.array;
    for(let i=0;i<p.length/3;i++){
      p[i*3]  +=v[i*3]  +Math.sin(t*0.28+i*0.4)*0.000052;
      p[i*3+1]+=v[i*3+1]+Math.sin(t*0.19+i*0.6)*0.000026;
      p[i*3+2]+=v[i*3+2];
      if(p[i*3]>2.2)p[i*3]=-2.2; if(p[i*3]<-2.2)p[i*3]=2.2;
      if(p[i*3+1]>4.1)p[i*3+1]=0.15; if(p[i*3+1]<0.15)p[i*3+1]=4.1;
      if(p[i*3+2]>8)p[i*3+2]=-50; if(p[i*3+2]<-50)p[i*3+2]=8;
    }
    dustMesh.geometry.attributes.position.needsUpdate=true;
  }

  /* ── PER-ROOM PARTICLES ─────────────────────────────────── */
  function buildRoomParticles(parent){
    const configs={
      solutions:  {N:28,color:0x00c2ff,size:0.022,opacity:0.22,orbit:true},
      'case-studies':{N:22,color:0xff9f43,size:0.028,opacity:0.28,spark:true},
      insights:   {N:18,color:0xa78bfa,size:0.032,opacity:0.20,fall:true},
      contact:    {N:20,color:0xc9a84c,size:0.025,opacity:0.25,mote:true},
    };
    const cfg=configs[R.id]; if(!cfg)return;
    const N=cfg.N;
    const pos=new Float32Array(N*3),vel=new Float32Array(N*3),phase=new Float32Array(N);
    for(let i=0;i<N;i++){
      pos[i*3]=(Math.random()-0.5)*4.0;
      pos[i*3+1]=Math.random()*3.6+0.3;
      pos[i*3+2]=(Math.random()-0.5)*48-16;
      vel[i*3]=(Math.random()-0.5)*0.0006;
      vel[i*3+1]=(Math.random()-0.5)*0.0004;
      vel[i*3+2]=(Math.random()-0.5)*0.0004;
      phase[i]=Math.random()*Math.PI*2;
    }
    const geo=new THREE.BufferGeometry();
    geo.setAttribute('position',new THREE.BufferAttribute(pos,3));
    geo.setAttribute('velocity',new THREE.BufferAttribute(vel,3));
    geo.setAttribute('phase',new THREE.BufferAttribute(phase,1));
    roomParticles=new THREE.Points(geo,new THREE.PointsMaterial({
      color:cfg.color,size:cfg.size,transparent:true,opacity:cfg.opacity,
      blending:THREE.AdditiveBlending,depthWrite:false,sizeAttenuation:true
    }));
    roomParticles.renderOrder=998;
    parent.add(roomParticles);
  }

  function updateRoomParticles(t){
    if(!roomParticles)return;
    const p=roomParticles.geometry.attributes.position.array;
    const v=roomParticles.geometry.attributes.velocity.array;
    const ph=roomParticles.geometry.attributes.phase.array;
    for(let i=0;i<p.length/3;i++){
      if(R.id==='solutions'){
        // Orbiting data-dot pattern
        p[i*3]  +=Math.cos(t*0.4+ph[i])*0.0018;
        p[i*3+1]+=Math.sin(t*0.3+ph[i])*0.0012;
        p[i*3+2]+=v[i*3+2];
      } else if(R.id==='insights'){
        // Slow falling paper fragments
        p[i*3+1]-=0.0008;
        p[i*3]  +=Math.sin(t*0.5+ph[i])*0.0006;
        if(p[i*3+1]<0.2) p[i*3+1]=4.0;
      } else {
        p[i*3]  +=v[i*3]  +Math.sin(t*0.35+ph[i])*0.00006;
        p[i*3+1]+=v[i*3+1]+Math.sin(t*0.22+ph[i])*0.00004;
        p[i*3+2]+=v[i*3+2];
      }
      if(p[i*3]>2.2)p[i*3]=-2.2; if(p[i*3]<-2.2)p[i*3]=2.2;
      if(p[i*3+2]>8)p[i*3+2]=-48; if(p[i*3+2]<-48)p[i*3+2]=8;
    }
    roomParticles.geometry.attributes.position.needsUpdate=true;
  }

  /* ── PANEL MESHES ───────────────────────────────────────── */
  const PW=2.1,PH=1.48;

  async function makePanelMesh(item,index){
    const g=new THREE.Group();
    const side=index%2===0?'left':'right';
    const zPos=2.2-index*5.8;
    const yPos=1.82;
    const WX=side==='left'?-TW/2:TW/2;

    let tex=null;
    if(item.img) tex=await loadTex(item.img);

    const imgMat=tex
      ?new THREE.MeshStandardMaterial({map:tex,roughness:0.80,metalness:0})
      :new THREE.MeshStandardMaterial({color:0x12100e,roughness:0.9});
    const imgPlane=new THREE.Mesh(new THREE.PlaneGeometry(PW,PH),imgMat);
    imgPlane.userData={item,index};

    // Frame
    const B=0.055;
    const fMat=new THREE.MeshStandardMaterial({color:0x1c1810,roughness:0.42,metalness:0.58});
    [[PW+B*2,B,0,PH/2+B/2],[PW+B*2,B,0,-PH/2-B/2],
     [B,PH,-PW/2-B/2,0],[B,PH,PW/2+B/2,0]].forEach(([fw,fh,fx,fy])=>{
      const fb=new THREE.Mesh(new THREE.BoxGeometry(fw,fh,0.022),fMat);
      fb.position.set(fx,fy,-0.012); g.add(fb);
    });

    // Glow trim (stored for approach animation)
    const glowMat=new THREE.MeshStandardMaterial({
      color:R.accentInt,emissive:R.accentInt,emissiveIntensity:0.45,
      roughness:0.22,metalness:0.78
    });
    const glow=new THREE.Mesh(new THREE.BoxGeometry(PW+B*2+0.014,PH+B*2+0.014,0.007),glowMat);
    glow.position.z=-0.018; g.add(glow);
    g.add(imgPlane);

    // Label plate with canvas text
    const labelTex=makeLabelTex(item.title||'');
    const plateMat=new THREE.MeshStandardMaterial({map:labelTex,roughness:0.55,metalness:0.45});
    const plate=new THREE.Mesh(new THREE.BoxGeometry(1.3,0.13,0.016),plateMat);
    plate.position.set(0,-PH/2-B-0.09,0);
    g.add(plate);

    // Panel spotlight
    const sp=new THREE.SpotLight(0xfff8e8,1.7,9,Math.PI/9,0.30,2.4);

    if(side==='left'){
      g.rotation.y=Math.PI/2;
      g.position.set(WX+0.018,yPos,zPos);
      sp.position.set(-1.5,3.8,zPos+0.3);
      sp.target.position.set(WX,yPos,zPos);
    } else {
      g.rotation.y=-Math.PI/2;
      g.position.set(WX-0.018,yPos,zPos);
      sp.position.set(1.5,3.8,zPos+0.3);
      sp.target.position.set(WX,yPos,zPos);
    }

    return {
      group:g,mesh:imgPlane,glowMat,spotLight:sp,spotTarget:sp.target,
      item,index,side,
      worldPos:new THREE.Vector3(WX,yPos,zPos),
      normalDir:new THREE.Vector3(side==='left'?1:-1,0,0)
    };
  }

  /* ── BUILD ROOM ─────────────────────────────────────────── */
  async function buildRoom(){
    roomGroup=new THREE.Group();
    scene.add(roomGroup);
    roomGroup.add(buildTunnel());
    buildLighting(roomGroup);
    buildDust(roomGroup);
    buildRoomParticles(roomGroup);

    hallMeshes=[]; panelMeshData=[];
    const items=CFG.items||[];
    for(let i=0;i<items.length;i++){
      setLoadProgress(0.18+(i/items.length)*0.68);
      const pd=await makePanelMesh(items[i],i);
      roomGroup.add(pd.group);
      roomGroup.add(pd.spotLight);
      roomGroup.add(pd.spotTarget);
      hallMeshes.push({mesh:pd.mesh,item:pd.item,index:pd.index});
      panelMeshData.push(pd);
    }
  }

  /* ── PANEL APPROACH ANIMATION ───────────────────────────── */
  function updatePanelApproach(){
    for(const pd of panelMeshData){
      const dist=camera.position.distanceTo(pd.worldPos);
      const prox=1-clamp(dist/4.2,0,1);
      const eased=prox*prox;
      pd.glowMat.emissiveIntensity=lerp(0.45,1.5,eased);
      pd.group.scale.setScalar(lerp(1.0,1.028,eased));
      pd.spotLight.intensity=lerp(1.7,2.8,eased);
    }
  }

  /* ── AUTO-FACE ──────────────────────────────────────────── */
  function checkAutoFace(){
    if(state!=='exploring')return;
    let best=null,bestScore=0;
    for(const pd of panelMeshData){
      const dist=camera.position.distanceTo(pd.worldPos);
      if(dist>3.8)continue;
      camera.getWorldDirection(_camDir);
      _toPanel.copy(pd.worldPos).sub(camera.position).normalize();
      const dot=_camDir.dot(_toPanel);
      const prox=1-clamp(dist/3.8,0,1);
      const score=dot*0.6+prox*0.4;
      if(dot>0.2&&score>bestScore){bestScore=score;best=pd;}
    }
    if(best&&bestScore>0.45){
      const tp=new THREE.Vector3().copy(best.worldPos).sub(camera.position);
      // FIX 2: negate both axes so the angle points TOWARD the panel, not away.
      // atan2(x,z)+PI is correct for left panels but inverts for right panels.
      autoFaceYaw=Math.atan2(-tp.x,-tp.z);
      autoFaceActive=true;
      autoFaceStrength=clamp((bestScore-0.45)/0.55,0,1);
    } else {
      autoFaceActive=false; autoFaceStrength=0;
    }
  }

  /* ── PROGRESS BAR ───────────────────────────────────────── */
  function updateProgressBar(){
    const el=document.getElementById('progress-bar');
    if(!el)return;
    // FIX 3: Spec §4.2 formula — bar fills as camera walks deeper into corridor.
    // At z=7 (entrance): 0%. At z=-42 (far end): 100%.
    // Previous formula was inverted: 1-(z-(-42))/(6.5-(-42)) read 98% at entrance.
    const pct=clamp(1-(zSpring.value-(-42))/(7-(-42)),0,1);
    el.style.width=(pct*100)+'%';
  }

  /* ── VIGNETTE+GRAIN POST (CSS — no composer needed) ─────── */
  function applyPostCSS(){
    const style=document.createElement('style');
    style.textContent=`
      #canvas-wrap::after {
        content:'';
        position:absolute;
        inset:0;
        pointer-events:none;
        background:radial-gradient(ellipse at 50% 50%,
          transparent 55%,
          rgba(0,0,0,0.62) 100%);
        mix-blend-mode:multiply;
        z-index:5;
      }
      #grain-overlay {
        position:fixed;inset:0;z-index:6;
        pointer-events:none;
        opacity:0.028;
        background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E");
        background-size:128px 128px;
      }
    `;
    document.head.appendChild(style);
    const grain=document.createElement('div');
    grain.id='grain-overlay'; document.body.appendChild(grain);
  }

  /* ── DOF BLUR OVERLAY (during door transitions) ─────────── */
  function setDOFBlur(v){
    const el=document.getElementById('dof-overlay');
    if(el) el.style.backdropFilter=v>0?`blur(${v}px)`:'none';
  }

  /* ── DOOR ───────────────────────────────────────────────── */
  function buildDoor(){
    if(doorGroup){scene.remove(doorGroup);doorGroup=null;}
    doorGroup=new THREE.Group();
    const DW=1.28,DH=3.0,DD=0.055;
    const doorMat=new THREE.MeshStandardMaterial({color:0x1a1510,roughness:0.48,metalness:0.32});
    const glowMat=new THREE.MeshStandardMaterial({color:R.accentInt,emissive:R.accentInt,emissiveIntensity:0.28,roughness:0.25,metalness:0.8});

    function makePanel(side){
      const dg=new THREE.Group();
      const panel=new THREE.Mesh(new THREE.BoxGeometry(DW,DH,DD),doorMat);
      panel.position.x=side==='left'?DW/2:-DW/2;
      panel.castShadow=true; panel.receiveShadow=true; dg.add(panel);
      // Gold strip
      const strip=new THREE.Mesh(new THREE.BoxGeometry(0.038,DH*0.72,DD+0.008),glowMat);
      strip.position.set(side==='left'?DW*0.32:-DW*0.32,0,0); panel.add(strip);
      // Handle shaft
      const shaft=new THREE.Mesh(new THREE.CylinderGeometry(0.022,0.022,0.32,12),
        new THREE.MeshStandardMaterial({color:R.accentInt,metalness:0.92,roughness:0.15}));
      shaft.rotation.z=Math.PI/2;
      shaft.position.set(side==='left'?DW*0.46:-DW*0.46,-0.04,DD/2+0.02); panel.add(shaft);
      // Lever
      const lg=new THREE.Group();
      lg.name=side==='left'?'handleL':'handleR';
      const lev=new THREE.Mesh(new THREE.CylinderGeometry(0.018,0.016,0.18,10),
        new THREE.MeshStandardMaterial({color:R.accentInt,metalness:0.95,roughness:0.1}));
      lev.position.y=-0.08; lg.add(lev);
      const ball=new THREE.Mesh(new THREE.SphereGeometry(0.028,10,10),
        new THREE.MeshStandardMaterial({color:R.accentInt,metalness:0.98,roughness:0.08}));
      ball.position.y=-0.18; lg.add(ball);
      lg.position.set(side==='left'?DW*0.46:-DW*0.46,-0.04,DD/2+0.04);
      panel.add(lg);
      if(side==='left')handleL=lg; else handleR=lg;
      // Hinges
      [-0.88,0.88].forEach(hy=>{
        const h=new THREE.Mesh(new THREE.CylinderGeometry(0.03,0.03,0.09,8),
          new THREE.MeshStandardMaterial({color:R.accentInt,metalness:0.9,roughness:0.2}));
        h.rotation.z=Math.PI/2;
        h.position.set(side==='left'?0.02:-0.02,hy,0); dg.add(h);
      });
      return dg;
    }

    leftDoor=makePanel('left'); rightDoor=makePanel('right');
    leftDoor.position.set(-DW,DH/2,8.4);
    rightDoor.position.set(DW,DH/2,8.4);

    const frameMat=new THREE.MeshStandardMaterial({color:0x1c1810,roughness:0.55,metalness:0.35});
    [[0,DH+0.1,0.04,DW*2+0.12,0.12,0.06],
     [-DW-0.06,DH/2,0,0.1,DH+0.1,0.06],
     [DW+0.06,DH/2,0,0.1,DH+0.1,0.06]
    ].forEach(([x,y,z,w,h,d])=>{
      const fb=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),frameMat);
      fb.position.set(x,y,z+8.4); doorGroup.add(fb);
    });

    const dl=new THREE.SpotLight(0xfff3d8,1.9,10,Math.PI/7,0.34,2);
    dl.position.set(0,TH-0.04,8.0);
    dl.target.position.set(0,1.6,8.4);
    doorGroup.add(dl); doorGroup.add(dl.target);
    doorGroup.add(leftDoor); doorGroup.add(rightDoor);
    scene.add(doorGroup);
  }

  function animateHandleThenOpen(onDone){
    if(handleL) gsap.to(handleL.rotation,{z:-0.55,duration:0.36,ease:'power2.in'});
    if(handleR) gsap.to(handleR.rotation,{z:0.55,duration:0.36,ease:'power2.in',
      onComplete:()=>{
        playEntrySound();
        gsap.to(leftDoor.rotation, {y:-Math.PI*0.63,duration:1.28,ease:'power2.inOut'});
        gsap.to(rightDoor.rotation,{y: Math.PI*0.63,duration:1.28,ease:'power2.inOut',
          onComplete:()=>{if(onDone)onDone();}
        });
      }
    });
  }

  function animateDoorClose(onDone){
    if(handleL) gsap.to(handleL.rotation,{z:-0.55,duration:0.28,ease:'power2.in'});
    if(handleR) gsap.to(handleR.rotation,{z:0.55,duration:0.28,ease:'power2.in'});
    setTimeout(()=>{
      gsap.to(leftDoor.rotation, {y:0,duration:0.82,ease:'power2.inOut'});
      gsap.to(rightDoor.rotation,{y:0,duration:0.82,ease:'power2.inOut',
        onComplete:()=>{if(onDone)onDone();}
      });
    },300);
  }

  /* ── SOUND ──────────────────────────────────────────────── */
  function initSound(){
    if(soundInitialized)return;
    soundInitialized=true;
    try{
      audioCtx=new(window.AudioContext||window.webkitAudioContext)();
      masterGain=audioCtx.createGain();
      masterGain.gain.value=soundEnabled?0.04:0;
      masterGain.connect(audioCtx.destination);

      // Base drone
      const osc=audioCtx.createOscillator();
      osc.type='sine'; osc.frequency.value=R.freq||55;
      const og=audioCtx.createGain(); og.gain.value=1.0;
      osc.connect(og); og.connect(masterGain); osc.start();

      // Harmonic
      const osc2=audioCtx.createOscillator();
      osc2.type='sine'; osc2.frequency.value=(R.freq||55)*1.5;
      const g2=audioCtx.createGain(); g2.gain.value=0.18;
      osc2.connect(g2); g2.connect(masterGain); osc2.start();

      // LFO — pitch wobble on base drone (not volume tremolo)
      // FIX 10: lg.gain.value=0.011 connected to masterGain.gain caused audible
      // volume tremolo at non-zero master gain. Rerouted to osc.frequency:
      // a ±1.2Hz pitch wobble at 0.065Hz is imperceptible as tremolo but adds
      // organic life to the drone — matching the spec's ambient intent (§2.2).
      const lfo=audioCtx.createOscillator();
      lfo.frequency.value=0.065;
      const lg=audioCtx.createGain(); lg.gain.value=1.2;
      lfo.connect(lg); lg.connect(osc.frequency); lfo.start();
    }catch(e){}
  }

  function playEntrySound(){
    if(!audioCtx||!soundEnabled)return;
    try{
      // Short sweep — different per room type
      const osc=audioCtx.createOscillator();
      const g=audioCtx.createGain();
      const freqMap={solutions:440,industries:320,'case-studies':560,insights:280,contact:520,about:380,index:400};
      osc.frequency.setValueAtTime(freqMap[R.id]||400,audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime((freqMap[R.id]||400)*0.5,audioCtx.currentTime+0.4);
      osc.type='sine';
      g.gain.setValueAtTime(0.06,audioCtx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001,audioCtx.currentTime+0.5);
      osc.connect(g); g.connect(masterGain);
      osc.start(); osc.stop(audioCtx.currentTime+0.5);
    }catch(e){}
  }

  function playFootstep(){
    if(!audioCtx||!soundEnabled)return;
    try{
      const buf=audioCtx.createBuffer(1,Math.floor(audioCtx.sampleRate*0.055),audioCtx.sampleRate);
      const d=buf.getChannelData(0);
      for(let i=0;i<d.length;i++) d[i]=(Math.random()*2-1)*Math.exp(-i/(d.length*0.28))*0.35;
      const src=audioCtx.createBufferSource(); src.buffer=buf;
      const g=audioCtx.createGain(); g.gain.value=0.055;
      src.connect(g); g.connect(masterGain); src.start();
    }catch(e){}
  }

  function toggleSound(){
    soundEnabled=!soundEnabled;
    if(!soundInitialized&&soundEnabled)initSound();
    if(masterGain){
      masterGain.gain.cancelScheduledValues(audioCtx.currentTime);
      masterGain.gain.linearRampToValueAtTime(soundEnabled?0.04:0,audioCtx.currentTime+0.8);
    }
    const btn=document.getElementById('sound-btn');
    if(btn)btn.textContent=soundEnabled?'♪':'♩';
  }

  /* ── GYROSCOPE ──────────────────────────────────────────── */
  async function enableGyro(){
    try{
      if(typeof DeviceOrientationEvent!=='undefined'&&
         typeof DeviceOrientationEvent.requestPermission==='function'){
        const perm=await DeviceOrientationEvent.requestPermission();
        if(perm!=='granted')return;
      }
      window.addEventListener('deviceorientation',e=>{
        if(!gyroEnabled)return;
        gyroYaw   = THREE.MathUtils.degToRad((e.gamma||0)*1.6);
        gyroPitch = THREE.MathUtils.degToRad(((e.beta||45)-45)*0.55);
      });
      gyroEnabled=true;
      const btn=document.getElementById('gyro-btn');
      if(btn){btn.textContent='📡';btn.style.color='var(--accent)';}
    }catch(e){}
  }

  /* ── CARD ───────────────────────────────────────────────── */
  function openCard(item){
    const el=document.getElementById('card-overlay'); if(!el)return;
    const img=document.getElementById('card-img');
    if(img){img.src=item.img||'';img.style.display=item.img?'block':'none';}
    document.getElementById('card-tag').textContent=item.tag||R.label;
    document.getElementById('card-title').textContent=item.title||'';
    document.getElementById('card-subtitle').textContent=item.subtitle||'';
    // FIX 9: use textContent instead of innerHTML — no HTML tags are used in any
    // body string, and innerHTML will become an XSS vector when spec §5.2 moves
    // content to an external JSON manifest fetched at runtime.
    document.getElementById('card-body').textContent=item.body||'';
    const tagsEl=document.getElementById('card-tags');
    if(tagsEl){tagsEl.innerHTML='';(item.tags||[]).forEach(t=>{const p=document.createElement('span');p.className='card-tag-pill';p.textContent=t;tagsEl.appendChild(p);});}
    const listEl=document.getElementById('card-list');
    if(listEl){listEl.innerHTML='';(item.listItems||[]).forEach(li=>{const r=document.createElement('div');r.className='card-list-item';r.innerHTML=`<span class="card-list-dot">◆</span><span>${li.label}</span>`;listEl.appendChild(r);});}
    const ctaEl=document.getElementById('card-cta');
    if(ctaEl){
      if(item.cta){
        ctaEl.textContent=item.cta.label;ctaEl.style.display='block';
        ctaEl.onclick=()=>{closeCard();const href=item.cta.href||'contact.html';setTimeout(()=>{if(href.startsWith('http'))window.open(href,'_blank');else navigateTo(href);},400);};
      } else ctaEl.style.display='none';
    }
    const contactSection=document.getElementById('card-contact-section');
    if(contactSection){
      if(item.cta?.href==='#form'){
        contactSection.style.display='block';
        document.getElementById('hq-contact-form')?.style.setProperty('display','block');
        document.getElementById('card-success-msg')?.classList.remove('show');
        if(ctaEl) ctaEl.style.display='none';
      } else {
        contactSection.style.display='none';
      }
    }
    // URL hash deep-link
    history.replaceState(null,'',`#panel-${item.index}`);
    el.classList.add('open');
    document.body.style.overflow='hidden';
    cardOpen=true; state='card';
  }

  function closeCard(){
    const el=document.getElementById('card-overlay');
    if(el)el.classList.remove('open');
    document.body.style.overflow='';
    history.replaceState(null,'',window.location.pathname);
    cardOpen=false;
    // FIX 1: only restore to 'exploring' if we were in 'card' state.
    // Never overwrite 'transitioning' — that would re-enable input mid-navigation.
    if(state==='card') state='exploring';
  }

  /* ── CARD SWIPE-DOWN TO DISMISS ─────────────────────────── */
  function initCardSwipe(){
    const sheet=document.querySelector('.card-sheet');
    if(!sheet)return;
    sheet.addEventListener('touchstart',e=>{
      cardSwipeStartY=e.touches[0].clientY;
      cardSwipeActive=true;
    },{passive:true});
    // FIX 8: must be {passive:false} to call preventDefault().
    // Previously {passive:true} meant scroll and swipe-dismiss ran simultaneously
    // on iOS Safari — sheet would jump erratically when scrolling near the top.
    // Only block native scroll when dy>0 AND sheet is scrolled to the top.
    sheet.addEventListener('touchmove',e=>{
      if(!cardSwipeActive)return;
      const dy=e.touches[0].clientY-cardSwipeStartY;
      if(dy>0&&sheet.scrollTop===0){
        e.preventDefault(); // safe: only fires when at top pulling down
        sheet.style.transform=`translateY(${dy}px)`;
        sheet.style.transition='none';
      }
    },{passive:false});
    sheet.addEventListener('touchend',e=>{
      if(!cardSwipeActive)return;
      cardSwipeActive=false;
      const dy=e.changedTouches[0].clientY-cardSwipeStartY;
      sheet.style.transition='';
      sheet.style.transform='';
      if(dy>90)closeCard();
    },{passive:true});
  }

  /* ── NAVIGATION ─────────────────────────────────────────── */
  function navigateTo(file){
    if(isTransitioning||!file)return;
    isTransitioning=true; state='transitioning';
    closeCard(); closeNavDrawer();
    // Walk to door with DOF blur
    gsap.to({blur:0},{blur:3.5,duration:0.85,ease:'power2.in',
      onUpdate:function(){setDOFBlur(this.targets()[0].blur);}
    });
    // FIX 5: Camera was tweening to z:8.6 but door geometry sits at z:8.4.
    // The 0.2 unit overlap caused the camera to clip through the door mesh,
    // producing a z-fight flicker before the door animation played.
    // Tween to z:8.1 — safely clear of the door, handles still visible.
    gsap.to(camera.position,{z:8.1,duration:0.9,ease:'power2.in',
      onComplete:()=>{
        buildDoor();
        animateDoorClose(()=>{
          const ov=document.getElementById('room-transition');
          if(ov){ov.style.transition='opacity 0.32s ease';ov.style.opacity='1';ov.style.pointerEvents='all';}
          setTimeout(()=>{window.location.href=file;},300);
        });
      }
    });
  }

  /* ── ENTER ROOM ─────────────────────────────────────────── */
  function doEnter(isEntrance){
    if(roomGroup)roomGroup.visible=true;
    const ov=document.getElementById('room-transition');
    if(ov&&!isEntrance){
      ov.style.opacity='1';
      setTimeout(()=>{ov.style.transition='opacity 0.5s ease';ov.style.opacity='0';setTimeout(()=>{ov.style.pointerEvents='none';},550);},80);
    }
    const isStairs=R.transition==='stairs';
    camera.position.set(0,isStairs?0.2:1.72,14);
    zSpring.set(14); ySpring.set(isStairs?0.2:1.72);
    // FIX 4: Set camTargetZ=14 (matching spring initial value).
    // Previously camTargetZ=5.5 caused the spring to pull toward 5.5 on frame 1
    // before GSAP started — a visible one-frame camera snap on all inner pages.
    // GSAP onUpdate drives camTargetZ down progressively from this point.
    camTargetZ=14; camTargetY=1.72;
    buildDoor(); state='entering';

    animateHandleThenOpen(()=>{
      const dur=isStairs?2.55:2.0;
      const startZ=14, endZ=5.5;
      gsap.to({z:startZ},{z:endZ,duration:dur,ease:isStairs?'power2.inOut':'power3.out',
        onUpdate:function(){
          const cz=this.targets()[0].z;
          zSpring.set(cz); camTargetZ=cz;
          camera.position.z=cz;
          if(isStairs){
            const prog=1-clamp((cz-endZ)/(startZ-endZ),0,1);
            const stepY=Math.abs(Math.sin(prog*Math.PI*3))*0.22;
            const baseY=lerp(0.2,1.72,prog);
            camera.position.y=baseY+stepY;
            ySpring.set(baseY+stepY);
          }
          setDOFBlur(clamp((cz-endZ)/(startZ-endZ)*3.5,0,3.5));
        },
        onComplete:()=>{
          if(doorGroup){scene.remove(doorGroup);doorGroup=null;leftDoor=null;rightDoor=null;handleL=null;handleR=null;}
          zSpring.set(5.5); camTargetZ=5.5;
          ySpring.set(1.72); camTargetY=1.72;
          setDOFBlur(0);
          state='exploring';
          document.getElementById('hud')?.classList.add('visible');
          document.getElementById('mini-nav')?.classList.add('visible');
          // FIX 17: show progress bar only after entry completes — not during loader.
          // Inner pages had class="visible" baked into HTML, showing empty bar during load.
          document.getElementById('progress-bar-wrap')?.classList.add('visible');
          // Deep-link: auto-open panel from URL hash
          const hash=window.location.hash;
          if(hash.startsWith('#panel-')){
            const idx=parseInt(hash.replace('#panel-',''));
            const it=CFG.items?.[idx];
            if(it)setTimeout(()=>openCard(it),600);
          }
        }
      });
    });
    document.getElementById('topbar')?.classList.add('visible');
    document.getElementById('back-btn')?.classList.add('visible');
  }

  function enterWorld(){
    const ts=document.getElementById('title-screen');
    if(ts){ts.classList.add('out');setTimeout(()=>{ts.style.display='none';},1500);}
    doEnter(true); initSound();
  }

  /* ── DRAWERS ────────────────────────────────────────────── */
  function buildNavDrawer(){
    const list=document.getElementById('nav-room-list'); if(!list)return;
    list.innerHTML='';
    ROOMS.forEach((r,i)=>{
      const a=document.createElement('a');
      a.className='nav-room-link'+(r.id===R.id?' active':'');
      a.innerHTML=`<span class="nav-room-icon">${r.icon}</span><span class="nav-room-title">${r.label}</span><span class="nav-room-key" style="font-size:10px;color:var(--text-muted);margin-left:auto">[${i+1}]</span>`;
      a.addEventListener('click',e=>{e.preventDefault();navigateTo(r.file);});
      list.appendChild(a);
    });
  }
  function buildMiniNav(){
    const inner=document.getElementById('mini-nav-inner'); if(!inner)return;
    inner.innerHTML='';
    ROOMS.forEach(r=>{
      const btn=document.createElement('button');
      btn.className='mini-nav-item'+(r.id===R.id?' active':'');
      btn.innerHTML=`<span class="mini-nav-icon">${r.icon}</span><span class="mini-nav-label">${r.label}</span>`;
      btn.addEventListener('click',()=>navigateTo(r.file));
      inner.appendChild(btn);
    });
  }
  function openNavDrawer() {document.getElementById('nav-drawer')?.classList.add('open');document.querySelector('.hq-hamburger')?.classList.add('open');}
  function closeNavDrawer(){document.getElementById('nav-drawer')?.classList.remove('open');document.querySelector('.hq-hamburger')?.classList.remove('open');}
  function toggleNavDrawer(){document.getElementById('nav-drawer')?.classList.contains('open')?closeNavDrawer():openNavDrawer();}

  /* ── TOUCH CONTROLLER ───────────────────────────────────── */
  class TouchCtrl{
    constructor(){
      this.lastX=0;this.lastY=0;this.dragging=false;
      this.startX=0;this.startY=0;this.moved=false;this.t0=0;
      this.pinchDist=0;this.pinching=false;
      // FIX 7: track primary touch identifier to prevent Android ghost taps
      this.primaryId=-1;
      const el=document.getElementById('canvas-wrap');
      el.addEventListener('touchstart', e=>this._s(e),{passive:true});
      el.addEventListener('touchmove',  e=>this._m(e),{passive:true});
      el.addEventListener('touchend',   e=>this._e(e),{passive:true});
      el.addEventListener('touchcancel',e=>this._c(e),{passive:true});
    }
    _dist(e){
      const a=e.touches[0],b=e.touches[1];
      return Math.hypot(b.clientX-a.clientX,b.clientY-a.clientY);
    }
    _s(e){
      if(e.touches.length===2){
        this.pinching=true;
        pinchActive=true;
        this.pinchDist=this._dist(e);
        this.dragging=false;
        autoFaceActive=false;
        return;
      }
      const t=e.touches[0];
      this.primaryId=t.identifier; // FIX 7: store for identity matching in _e()
      this.startX=this.lastX=t.clientX;
      this.startY=this.lastY=t.clientY;
      this.dragging=true; this.moved=false; this.t0=Date.now();
      this.pinching=false;
      pinchActive=false;
    }
    _m(e){
      // ── PINCH = walk forward/back ──
      if(e.touches.length===2&&this.pinching){
        const newDist=this._dist(e);
        const delta=newDist-this.pinchDist;
        if(state==='exploring'&&!cardOpen){
          autoFaceActive=false;
          // Pinch out (spread) = walk forward (Z decreases)
          // Pinch in  (squeeze)= walk back   (Z increases)
          camTargetZ=clamp(camTargetZ-delta*0.028,-42,7.2);
          if(Math.abs(delta)>1.2) this.moved=true;
        }
        this.pinchDist=newDist;
        return;
      }
      if(!this.dragging)return;
      const t=e.touches[0];
      const dx=t.clientX-this.lastX,dy=t.clientY-this.lastY;
      if(Math.hypot(t.clientX-this.startX,t.clientY-this.startY)>9)this.moved=true;
      if(state==='exploring'&&!cardOpen){
        autoFaceActive=false;
        // Single finger drag = look around
        camTargetYaw   +=dx*0.0036;
        camTargetPitch  =clamp(camTargetPitch-dy*0.0028,-0.55,0.55);
      }
      this.lastX=t.clientX; this.lastY=t.clientY;
    }
    _c(){
      if(this.pinching){this.pinching=false; pinchActive=false;}
      this.dragging=false;
    }
    _e(e){
      if(this.pinching){this.pinching=false; pinchActive=false; return;}
      this.dragging=false;
      // FIX 7: match by stored identifier — prevents second-finger liftoff after
      // a pinch from triggering a ghost handleRayClick at wrong coordinates on Android.
      const t=Array.from(e.changedTouches).find(ct=>ct.identifier===this.primaryId);
      if(!t)return;
      if(!this.moved&&Date.now()-this.t0<300){
        handleRayClick(t.clientX,t.clientY);
      }
    }
  }

  /* ── RAYCASTING ─────────────────────────────────────────── */
  function handleRayClick(cx,cy){
    if(state==='card'){closeCard();return;}
    if(state!=='exploring')return;
    const m=new THREE.Vector2((cx/window.innerWidth)*2-1,-(cy/window.innerHeight)*2+1);
    const ray=new THREE.Raycaster();
    ray.setFromCamera(m,camera);
    const hits=ray.intersectObjects(hallMeshes.map(h=>h.mesh));
    if(hits.length){const h=hallMeshes.find(h=>h.mesh===hits[0].object);if(h){openCard(h.item);return;}}
  }

  /* ── INPUT ──────────────────────────────────────────────── */
  function initInput(){
    document.getElementById('sound-btn')?.addEventListener('click',toggleSound);
    document.getElementById('gyro-btn')?.addEventListener('click',enableGyro);
    document.querySelector('.hq-hamburger')?.addEventListener('click',toggleNavDrawer);
    document.querySelector('.hq-logo')?.addEventListener('click',()=>navigateTo('index.html'));
    document.getElementById('back-btn')?.addEventListener('click',()=>{if(cardOpen)closeCard();});
    document.getElementById('card-close')?.addEventListener('click',closeCard);
    document.getElementById('card-backdrop')?.addEventListener('click',closeCard);

    // Desktop drag-look
    const cvs=renderer.domElement;
    // FIX 6: record mousedown position to measure displacement in click handler.
    // isDragging is cleared by mouseup BEFORE click fires, so the old guard
    // `if(isDragging)return` always reads false — short drags opened cards.
    let mouseDownX=0, mouseDownY=0;
    cvs.addEventListener('mousedown',e=>{if(e.button===0){isDragging=true;mouseDownX=e.clientX;mouseDownY=e.clientY;dragLastX=e.clientX;dragLastY=e.clientY;cvs.style.cursor='grabbing';}});
    window.addEventListener('mouseup',()=>{isDragging=false;renderer.domElement.style.cursor='default';});
    window.addEventListener('mousemove',e=>{
      if(isDragging&&state==='exploring'&&!cardOpen){
        camTargetYaw  +=(e.clientX-dragLastX)*0.0038;
        camTargetPitch =clamp(camTargetPitch-(e.clientY-dragLastY)*0.0028,-0.55,0.55);
        dragLastX=e.clientX;dragLastY=e.clientY;
        autoFaceActive=false;
      }
    });

    // Desktop click — displacement guard replaces isDragging bool
    let lastClick=0;
    window.addEventListener('click',e=>{
      // FIX 6: use pixel displacement instead of isDragging boolean.
      // isDragging is already false by the time click fires (mouseup clears it first).
      const moved=Math.hypot(e.clientX-mouseDownX,e.clientY-mouseDownY);
      if(moved>6)return; // was a drag, not an intentional click
      if(Date.now()-lastClick<220)return; lastClick=Date.now();
      handleRayClick(e.clientX,e.clientY);
    });

    // Keyboard
    window.addEventListener('keydown',e=>{
      keys[e.key]=true;
      if(e.key==='Escape')closeCard();
      if(e.key==='g'||e.key==='G')toggleNavDrawer();
      if(e.key==='f'||e.key==='F')toggleFocusMode();
      if(e.key==='m'||e.key==='M')toggleSound();
      // Number keys 1-7 = room navigation
      const n=parseInt(e.key);
      if(n>=1&&n<=ROOMS.length)navigateTo(ROOMS[n-1].file);
    });
    window.addEventListener('keyup',e=>{keys[e.key]=false;});

    new TouchCtrl();
    initCardSwipe();
  }

  function toggleFocusMode(){
    focusMode=!focusMode;
    ['topbar','hud','mini-nav','back-btn'].forEach(id=>{
      const el=document.getElementById(id);
      if(el)el.style.opacity=focusMode?'0':'';
    });
  }

  /* ── RESIZE ─────────────────────────────────────────────── */
  function onResize(){
    camera.aspect=window.innerWidth/window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth,window.innerHeight);
  }

  /* ── RENDER LOOP ────────────────────────────────────────── */
  function animate(){
    requestAnimationFrame(animate);
    const dt=Math.min(clock.getDelta(),0.05);
    const t =clock.getElapsedTime();

    updateDust(t);
    updateRoomParticles(t);

    // Flicker lights
    flickerLights.forEach((l,i)=>{
      l.intensity=1.1+Math.sin(t*7.4+i*2.1)*0.24+Math.sin(t*19.8+i)*0.11;
    });

    // Clock
    clockAcc+=dt; if(clockAcc>1.0){updateClock();clockAcc=0;}

    // Accent fill pulse
    if(accentFillLight) accentFillLight.intensity=0.4+Math.sin(t*0.38)*0.08;

    if(state==='exploring'){
      // Keyboard Z movement
      const spd=4.0;
      if(keys['ArrowUp']  ||keys['w']||keys['W']) camTargetZ-=dt*spd;
      if(keys['ArrowDown']||keys['s']||keys['S']) camTargetZ+=dt*spd;
      if(keys['ArrowLeft']||keys['a']||keys['A']) camTargetYaw+=dt*1.0;
      if(keys['ArrowRight']||keys['d']||keys['D']) camTargetYaw-=dt*1.0;
      camTargetZ=clamp(camTargetZ,-42,7.2);

      // Auto-face
      checkAutoFace();
      let effYaw=camTargetYaw,effPitch=camTargetPitch;
      if(autoFaceActive&&!isDragging){
        effYaw=lerp(camTargetYaw,autoFaceYaw,autoFaceStrength*0.55);
      }
      // Gyro blend
      if(gyroEnabled){
        effYaw  =lerp(effYaw,  effYaw+gyroYaw,  0.28);
        effPitch=lerp(effPitch,effPitch+gyroPitch,0.22);
      }

      // Spring update
      yawSpring.target=effYaw; pitchSpring.target=effPitch;
      zSpring.target=camTargetZ; ySpring.target=camTargetY;
      yawSpring.update(dt); pitchSpring.update(dt);
      zSpring.update(dt);   ySpring.update(dt);

      // Walk bob — figure-8 (primary + half-freq sway)
      const movingZ=Math.abs(camTargetZ-zSpring.value)>0.01;
      walkBobAmt=lerp(walkBobAmt,movingZ?1.0:0.0,0.07);
      if(movingZ)walkBobPhase+=dt*6.0;
      const bobY=Math.sin(walkBobPhase)*walkBobAmt*0.015;
      const bobX=Math.sin(walkBobPhase*0.5)*walkBobAmt*0.005;

      // Footstep trigger at downward peak
      const bobDown=bobY<0;
      if(bobDown&&!lastBobDown&&walkBobAmt>0.4){playFootstep();}
      lastBobDown=bobDown;

      camera.position.set(0,ySpring.value+bobY,zSpring.value);
      camera.rotation.order='YXZ';
      camera.rotation.y=yawSpring.value;
      camera.rotation.x=pitchSpring.value;
      camera.rotation.z=bobX*0.012;

      updatePanelApproach();
      updateProgressBar();
    }

    renderer.render(scene,camera);
  }

  /* ── LOAD HELPERS ───────────────────────────────────────── */
  function setLoadProgress(p){
    const bar=document.getElementById('load-bar');
    const pct=document.getElementById('load-pct');
    if(bar)bar.style.width=(p*100).toFixed(0)+'%';
    if(pct)pct.textContent=Math.floor(p*100)+'%';
  }
  function hideLoader(){
    const el=document.getElementById('loader'); if(!el)return;
    el.style.transition='opacity 0.7s ease'; el.style.opacity='0';
    setTimeout(()=>{el.style.display='none';},750);
  }

  /* ── INIT ───────────────────────────────────────────────── */
  async function init(){
    initRenderer();
    applyPostCSS();
    setLoadProgress(0.05);
    await buildRoom();
    if(roomGroup)roomGroup.visible=false;
    setLoadProgress(0.96);
    initInput();
    buildNavDrawer();
    buildMiniNav();
    setLoadProgress(1.0);
    await new Promise(r=>setTimeout(r,360));
    hideLoader();
    animate();

    if(CFG.id==='index'){
      const btn=document.getElementById('enter-btn');
      if(btn)btn.addEventListener('click',()=>{enterWorld();initSound();});
    } else {
      setTimeout(()=>doEnter(false),80);
    }
  }

  function waitAndInit(){
    if(typeof THREE!=='undefined'&&typeof gsap!=='undefined')init();
    else setTimeout(waitAndInit,60);
  }
  waitAndInit();

})();
