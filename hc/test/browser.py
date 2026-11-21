import asyncio, json, sys
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        errs=[]
        for name,vp,qs,secs in [("desktop",{"width":1280,"height":720},"",45),("mobile",{"width":375,"height":667},"",20),("reduced",{"width":1000,"height":700},"?rm=1",15)]:
            pg = await b.new_page(viewport=vp, has_touch=(name=="mobile"))
            pg.on("console", lambda m: errs.append((name,m.text)) if m.type in("error","warning") else None)
            pg.on("pageerror", lambda e: errs.append((name,str(e))))
            await pg.goto("http://localhost:8765/test/page.html"+qs); await pg.wait_for_function("window.__ready===true")
            await pg.wait_for_timeout(secs*1000)
            r = await pg.evaluate("""()=>{const c=document.querySelector('canvas[data-anim]');const cr=c.getBoundingClientRect();const root=c.parentElement.parentElement;
              const rr=root.getBoundingClientRect();
              return {log:window.__log, scrollW:document.documentElement.scrollWidth, innerW:innerWidth, pos:getComputedStyle(root).position,
                 rootBottomGap: innerHeight-rr.bottom, petBottomGap: innerHeight-cr.bottom, petW:cr.width, nonEmpty:(()=>{const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let n=0;for(let i=3;i<d.length;i+=4)if(d[i]>0)n++;return n})()}}""")
            seq=[x['anim'] or ('hold' if x['hold'] is not None else 'wait') for x in r['log']]
            anims=sorted(set(seq)); modes=sorted(set(x['mode'] for x in r['log']))
            xs=[x['x'] for x in r['log']]
            print(f"\n== {name} {vp['width']}px ==")
            print("overflow-x:", r['scrollW']>r['innerW'], "| position:", r['pos'], "| pet bottom gap(px):", round(r['petBottomGap']), "| pet width:", round(r['petW']))
            print("distinct anims:", len(anims), anims); print("modes seen:", modes, "| x range:", min(xs), max(xs))
            print("canvas has drawn pixels:", r['nonEmpty']>0)
            # test button not blocked
            await pg.click("#b"); print("button clicks received:", await pg.evaluate("window.clicked"))
            await pg.close()
        print("\nconsole errors/warnings:", errs)
        await b.close()
asyncio.run(main())
