from PIL import Image
import numpy as np, cv2, json
img=Image.open('/tmp/story_cut.png'); a=np.array(img); al=a[...,3]
rgb=a[...,:3].astype(int); chroma=rgb.max(-1)-rgb.min(-1)
# erase the blue storyboard arrows (known positions, arrow-blue only)
arrows=[(370,320),(745,320),(1130,320),(390,790),(797,790),(1151,790)]
clear=np.zeros(al.shape,bool)
for ax,ay in arrows:
    box=np.zeros(al.shape,bool); box[ay-34:ay+34,ax-40:ax+40]=True
    blue=(rgb[...,2]>170)&(rgb[...,0]<120)&(rgb[...,1]>90)
    c=box&blue; c=cv2.dilate(c.astype(np.uint8),np.ones((5,5),np.uint8)).astype(bool)&box
    clear|=c
ch_=rgb.max(-1)-rgb.min(-1); br_=rgb.mean(-1)
blob=np.zeros(al.shape,bool); blob[434:475,1372:1462]=True
clear|=blob&(br_>165)
al=np.where(clear,0,al); a[...,3]=al
m=(al>90).astype(np.uint8)
d=cv2.dilate(m,cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(15,15)))
n,lab,st,cen=cv2.connectedComponentsWithStats(d,connectivity=8)
rowb=[(373,745,1131),(390,797,1151)]
poses={i:[] for i in range(8)}
for i in range(1,n):
    x,y,w,h,ar=st[i]; sel=(lab==i)&(m==1); area=sel.sum()
    if area<150: continue
    cx,cy=x+w/2,y+h/2; row=0 if cy<512 else 1
    r,g,b=[rgb[...,k][sel].mean() for k in range(3)]
    ch=chroma[sel].mean()
    # blue arrow between poses
    if b-r>120 and area<4500 and w/h>1.2 and abs(cy-(320 if row==0 else 789))<50: continue
    col=sum(cx>t for t in rowb[row])
    poses[row*4+col].append(dict(i=i,box=(x,y,x+w,y+h),area=area,ch=ch))
# drop checker-texture blobs (low colour, small) and measure anchors
info=[]
for p in range(8):
    comps=poses[p]; big=max(comps,key=lambda c:c['area'])
    comps=[c for c in comps if c is big or not (c['ch']<22 and c['area']<6000)]
    ids=[c['i'] for c in comps]; mask=np.isin(lab,ids)&(al>0)
    ys,xs=np.where(mask); bx=big['box']
    info.append(dict(mask=mask,big=bx,ext=(xs.min(),ys.min(),xs.max(),ys.max())))
    print(p+1,'comps',len(comps),'body',bx,'ext',info[-1]['ext'])
S=0.7
L=max((i['big'][0]+i['big'][2])/2-i['ext'][0] for i in info); R=max(i['ext'][2]-(i['big'][0]+i['big'][2])/2 for i in info)
U=max(i['big'][3]-i['ext'][1] for i in info); D=max(i['ext'][3]-i['big'][3] for i in info)+4
CW,CH=int(np.ceil((L+R)*S)),int(np.ceil((U+D)*S)); print('cell',CW,CH)
bw=int(np.median([(i['big'][2]-i['big'][0])*S for i in info]))
names=['idle','notice','bend','hold','confused','flip','happy','celebrate']
for p,inf in enumerate(info):
    rgba=a.copy(); rgba[...,3]=np.where(inf['mask'],al,0).astype(np.uint8)
    cx=(inf['big'][0]+inf['big'][2])/2; bot=inf['big'][3]
    x0=int(round(cx-L)); y0=int(round(bot-U))
    # crop with canvas padding
    canvas=np.zeros((int(U+D),int(L+R),4),np.uint8)
    sx0,sy0=max(0,x0),max(0,y0); sx1,sy1=min(a.shape[1],x0+canvas.shape[1]),min(a.shape[0],y0+canvas.shape[0])
    canvas[sy0-y0:sy1-y0,sx0-x0:sx1-x0]=rgba[sy0:sy1,sx0:sx1]
    im=Image.fromarray(canvas).resize((CW,CH),Image.LANCZOS)
    im.save(f'poses/{names[p]}.png',optimize=True)
json.dump({'cell':[CW,CH],'bodyW':bw,'names':names},open('poses/meta.json','w'))
