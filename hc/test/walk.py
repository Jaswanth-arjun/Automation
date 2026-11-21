import asyncio, sys
from playwright.async_api import async_playwright
async def run(b,name,vp,secs):
    pg=await b.new_page(viewport=vp); errs=[]
    pg.on("console",lambda m: errs.append(m.text) if m.type in("error","warning") else None); pg.on("pageerror",lambda e: errs.append(str(e)))
    await pg.goto("http://localhost:8765/test/walk.html"); await pg.wait_for_function("window.__ready===true")
    shots=0
    for i in range(secs*2):
        await pg.wait_for_timeout(500)
        if name=="desktop" and i in (4,5,6,7,20,21): await pg.screenshot(path=f"/home/claude/w{shots}.png",clip={"x":0,"y":vp["height"]-190,"width":vp["width"],"height":190}); shots+=1
    log=await pg.evaluate("window.__log"); size=await pg.evaluate("window.__e.size")
    ov=await pg.evaluate("[document.documentElement.scrollWidth, innerWidth]")
    await pg.mouse.click(120,vp["height"]-30)   # click the page button where the hamster lane is (hamster far away or not hit)
    # build segments
    segs=[]; cur=None
    for t,a,f,x,fc,h in log:
        k=a or ('hold' if h is not None else None)
        if cur is None or cur['a']!=k or cur['fc']!=fc: cur={'a':k,'fc':fc,'x0':x,'x1':x,'t0':t,'frames':[],'t1':t}; segs.append(cur)
        cur['x1']=x; cur['t1']=t
        if a=='walking' and (not cur['frames'] or cur['frames'][-1]!=f): cur['frames'].append(f)
    walks=[s for s in segs if s['a']=='walking']; pauses=[s for s in segs if s['a']=='walkPause']
    # frame order check: each consecutive pair must be +1 mod 8 (allow first partial)
    bad=0; tot=0
    for s in walks:
        fr=s['frames']
        for a,b2 in zip(fr,fr[1:]):
            tot+=1
            if (a+1)%8!=b2: bad+=1
    movR=[s for s in walks if s['fc']==1]; movL=[s for s in walks if s['fc']==-1]
    mono=all(s['x1']>=s['x0']-0.5 for s in movR) and all(s['x1']<=s['x0']+0.5 for s in movL)
    still=all(abs(s['x1']-s['x0'])<0.5 for s in pauses)
    xs=[r[3] for r in log]
    print(f"== {name} {vp['width']}px (sprite {size}px) ==")
    print(f"walk legs: {len(walks)} (right {len(movR)}, left {len(movL)}) | pauses: {len(pauses)} lasting {[round((s['t1']-s['t0'])/1000,1) for s in pauses][:8]} s")
    print(f"frame-order transitions checked: {tot}, out-of-order: {bad}")
    print(f"x range: {min(xs)}..{max(xs)} (viewport {vp['width']}) | monotone while walking: {mono} | stationary during pauses: {still}")
    print(f"distance per leg px: {[round(abs(s['x1']-s['x0'])) for s in walks][:8]}")
    print(f"overflow-x: {ov[0]>ov[1]} | page button clicks: {await pg.evaluate('window.clicked||0')} | errors: {errs}")
    # walking fps measured
    for s in walks:
        if len(s['frames'])>=8:
            dur=(s['t1']-s['t0'])/1000; print(f"measured: {len(s['frames'])} frames in {dur:.2f}s = {len(s['frames'])/dur:.1f} fps"); break
    await pg.close()
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch()
        await run(b,"desktop",{"width":900,"height":600},75)
        await run(b,"mobile",{"width":375,"height":667},40)
        await b.close()
asyncio.run(main())
