# Illustrations du tutoriel « Comment jouer ? » : captures du vrai jeu, mises
# en scène (partie solo), enregistrées en WebP dans client/img/tuto/.
# Usage : python3 tools/tuto_captures.py            (toutes les images)
#         python3 tools/tuto_captures.py combat     (seulement certaines)
# Prérequis : pip install playwright pillow, et un Chromium pour Playwright.
import sys, io
from playwright.sync_api import sync_playwright
from PIL import Image
import os, tempfile
ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT=os.path.join(ROOT,'client','img','tuto')+'/'
RAW=os.path.join(tempfile.gettempdir(),'tuto_')
only=set(sys.argv[1:])
def save(pg, name, clip=None, w=900):
    if only and name not in only: return
    png=pg.screenshot(clip=clip) if clip else pg.screenshot()
    open(RAW+name+'.png','wb').write(png)
    im=Image.open(io.BytesIO(png)).convert('RGB')
    if im.width>w: im=im.resize((w, round(im.height*w/im.width)), Image.LANCZOS)
    im.save(OUT+name+'.webp','WEBP',quality=72,method=6)
    print(name, im.size)

SETUP = """() => {
  const me=G.players[G.me]; const bots=G.players.filter(p=>p.id!==G.me);
  const ps=[...G.planets].sort((a,b)=>b.radius-a.radius);
  const A=ps[0], B=ps[1], C=ps[2];
  window._A=A; window._B=B; window._C=C;
  const n=A.sectors;
  for(let s=0;s<n;s++){const c=A.cells[0][s]; if(s<Math.floor(n*0.55)){c.owner=G.me;c.pop=60+Math.random()*60;} else if(s<Math.floor(n*0.8)){c.owner=bots[0].id;c.pop=50+Math.random()*40;}}
  me.colonyPlaced=true; bots[0].colonyPlaced=true;
  const put=(s,b)=>{A.cells[0][s].building=b;};
  put(4,'city');put(10,'industry');put(14,'industry');put(20,'silo');put(23,'silo');put(26,'silo');put(31,'shield');put(36,'colony');put(42,'tradeport');put(Math.floor(n*0.5),'military');put(Math.floor(n*0.45),'aa');
  for(const s of [20,23,26]) A.cells[0][s].missiles=1;
  put(Math.floor(n*0.65),'city'); put(Math.floor(n*0.7),'silo');
  for(let s=0;s<Math.floor(B.sectors*0.4);s++){B.cells[0][s].owner=bots[1].id;B.cells[0][s].pop=60;} bots[1].colonyPlaced=true; B.cells[0][5].building='city';
  for(let s=0;s<Math.floor(C.sectors*0.3);s++){C.cells[0][s].owner=bots[2].id;C.cells[0][s].pop=50;} bots[2].colonyPlaced=true;
  G.phase='playing'; me.money=2400; document.getElementById('prompt').hidden=true;
}"""
FRONT = """() => { const A=window._A, n=A.sectors; const me=G.players[G.me];
  const f=Math.floor(n*0.55); me.money+=200; window._atk=attackCell(me, A.cells[0][f]); }"""
def cam_on(pg, sector_frac, zoom):
    pg.evaluate(f"""()=>{{const A=window._A; lockPlanet(A); UI.targetZoom=null; UI.cam.zoom={zoom};
      const a=A.rotation+Math.PI*2*{sector_frac}; UI.camOffset.x=Math.cos(a)*A.radius*0.85; UI.camOffset.y=Math.sin(a)*A.radius*0.85;}}""")

with sync_playwright() as p:
    b=p.chromium.launch(); pg=b.new_page(viewport={'width':1280,'height':760}); errs=[]
    pg.on('pageerror',lambda e: errs.append(str(e)))
    pg.goto('file://'+os.path.join(ROOT,'client','index.html')+'?server=off'); pg.wait_for_timeout(800)
    pg.fill('#in-pseudo','Vous')
    pg.click('#btn-solo'); pg.wait_for_timeout(500)
    # Fondation : planète verrouillée pendant le placement
    pg.evaluate("()=>{const ps=[...G.planets].sort((a,b)=>b.radius-a.radius); lockPlanet(ps[0]);}"); pg.wait_for_timeout(1400)
    A0=pg.evaluate("()=>{const p=[...G.planets].sort((a,b)=>b.radius-a.radius)[0]; const a=p.rotation+0.3; return [W/2+(p.x+Math.cos(a)*p.radius*0.97-UI.cam.x)*UI.cam.zoom, H/2+(p.y+Math.sin(a)*p.radius*0.97-UI.cam.y)*UI.cam.zoom]}")
    pg.mouse.move(*A0); pg.wait_for_timeout(300)
    save(pg,'fondation')
    pg.evaluate("()=>unlockPlanet()")
    pg.evaluate(SETUP); pg.wait_for_timeout(300)
    pg.evaluate("()=>{const t=performance.now(); }")
    pg.evaluate(FRONT); pg.wait_for_timeout(1500)
    # Vue du système
    pg.evaluate("()=>{unlockPlanet(); UI.cam.x=0; UI.cam.y=0; UI.cam.zoom=(Math.min(W,H)*0.5)/(G.planets.reduce((m,p)=>Math.max(m,p.orbitRadius),0)*1.12);}"); pg.wait_for_timeout(600)
    save(pg,'systeme')
    # Combat au front
    cam_on(pg, pg.evaluate("()=>0.55+0.5/window._A.sectors"), 11); pg.wait_for_timeout(900)
    pg.evaluate("()=>{G.paused=true}"); pg.wait_for_timeout(200)
    print('attaque', pg.evaluate('()=>window._atk')); save(pg,'combat', clip={'x':260,'y':140,'width':700,'height':440}, w=700)
    pg.evaluate("()=>{G.paused=false}")
    # Bâtiments
    pg.evaluate("""()=>{const A=window._A; G.paused=true; if(G.particles) G.particles.length=0; lockPlanet(A); UI.targetZoom=null;
      A.rotation=-Math.PI/2-(23.5/A.sectors)*Math.PI*2; UI.cam.zoom=560/A.radius; UI.camOffset.x=0; UI.camOffset.y=-A.radius*0.62;
      document.body.classList.add('shot'); const st=document.createElement('style'); st.id='shotcss'; st.textContent='body.shot .glass, body.shot #minimap { visibility:hidden !important }'; document.head.appendChild(st);}""")
    pg.wait_for_timeout(500)
    save(pg,'batiments', clip={'x':140,'y':70,'width':1000,'height':480}, w=900)
    pg.evaluate("()=>{G.paused=false; document.body.classList.remove('shot');}")
    # Interface complète
    pg.evaluate("()=>{const A=window._A; lockPlanet(A); UI.camOffset.x=0; UI.camOffset.y=0; UI.targetZoom=(Math.min(W,H)*0.30)/A.radius;}"); pg.wait_for_timeout(1500)
    save(pg,'interface', w=1100)
    # Missiles : visée en salve vers la planète C
    pg.evaluate("()=>{const A=window._A; lockPlanet(A); UI.targetZoom=1.3; UI.cam.zoom=1.3; UI.aiming=true; updateMissilebar();}"); pg.wait_for_timeout(1200)
    tgt=pg.evaluate("()=>{const B=window._B, A=window._A; const x=(A.x*0.35+B.x*0.65), y=(A.y*0.35+B.y*0.65); return [W/2+(x-UI.cam.x)*UI.cam.zoom, H/2+(y-UI.cam.y)*UI.cam.zoom]}")
    tgt=[min(max(tgt[0],200),1080), min(max(tgt[1],150),600)]
    pg.mouse.move(*tgt); pg.wait_for_timeout(400)
    save(pg,'missiles')
    pg.mouse.click(*tgt); pg.wait_for_timeout(2600)
    pg.keyboard.press('Escape')
    # Cratères : impacts sur la planète B
    pg.evaluate("""()=>{const B=window._B; for(const [a,d] of [[0.3,1.0],[0.42,0.98],[1.6,1.02],[1.7,0.9],[3.0,1.0],[3.08,0.85],[3.16,0.7],[4.4,1.0]]){
       const ang=B.rotation+a; missileImpact({x:B.x+Math.cos(ang)*B.radius*d, y:B.y+Math.sin(ang)*B.radius*d, owner:G.me}, B);}
       lockPlanet(B); UI.camOffset.x=0; UI.camOffset.y=0; UI.targetZoom=(Math.min(W,H)*0.33)/B.radius; }"""); pg.wait_for_timeout(2500)
    pg.evaluate("()=>{G.paused=true}"); pg.wait_for_timeout(200)
    save(pg,'crateres', clip={'x':340,'y':100,'width':600,'height':560})
    pg.evaluate("()=>{G.paused=false}")
    # Colonisation : visée sur la planète C
    pg.evaluate("()=>{const A=window._A; lockPlanet(A); UI.cam.zoom=1.1; UI.targetZoom=1.1; UI.aimingColony=true; updateMissilebar();}"); pg.wait_for_timeout(1200)
    ct=pg.evaluate("()=>{const C=window._C; return [W/2+(C.x+C.radius*1.25-UI.cam.x)*UI.cam.zoom, H/2+(C.y-UI.cam.y)*UI.cam.zoom]}")
    ct=[min(max(ct[0],100),1180), min(max(ct[1],100),660)]
    pg.mouse.move(ct[0]-30,ct[1]); pg.mouse.move(*ct); pg.wait_for_timeout(500)
    save(pg,'colonisation')
    pg.keyboard.press('Escape')
    # Gestion à distance
    pg.evaluate("()=>{unlockPlanet(); UI.cam.x=0; UI.cam.y=0; UI.cam.zoom=0.85;}"); pg.wait_for_timeout(600)
    save(pg,'distance')
    # Diplomatie : clic droit sur un joueur du tableau
    rows=pg.locator('#scoreboard .sb-row, #scoreboard [data-pid]')
    print('lignes tableau', rows.count())
    r=rows.nth(1).bounding_box(); pg.mouse.click(r['x']+40, r['y']+r['height']/2, button='right'); pg.wait_for_timeout(400)
    save(pg,'diplomatie', clip={'x':0,'y':0,'width':560,'height':300}, w=560)
    print('erreurs', errs); b.close()
