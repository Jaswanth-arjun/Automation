import asyncio
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(); errs=[]
        pg=await b.new_page(viewport={"width":1100,"height":700}); 
        pg.on("console",lambda m: errs.append(m.text) if m.type in("error","warning") else None); pg.on("pageerror",lambda e: errs.append(str(e)))
        await pg.goto("file:///mnt/user-data/outputs/hamster-preview.html"); await pg.wait_for_timeout(1500)
        seen={}; n=0
        for i in range(90):
            s=await pg.evaluate("(()=>{const s=window.__e.getState();return [s.anim,Math.round(s.x),s.mode]})()")
            seen.setdefault(s[0],0); seen[s[0]]+=1
            if i in (3,12,25,40,60,80): await pg.screenshot(path=f"/home/claude/shot{n}.png",clip={"x":0,"y":480,"width":1100,"height":220}); n+=1
            await pg.wait_for_timeout(700)
        print("actions seen:",seen); print("errors:",errs); await b.close()
asyncio.run(main())
