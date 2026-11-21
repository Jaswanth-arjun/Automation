from PIL import Image
import numpy as np, cv2, json
def L(n):
    a=np.array(Image.open(f'poses/{n}.png').convert('RGBA')); rgb=a[...,:3].astype(int)
    y=((rgb[...,0]>200)&(rgb[...,1]>185)&(rgb[...,2]<120)).astype(np.uint8)
    y[:, :196]=0   # only the sparkle zone at the right edge, never the hamster
    a[:112,203:,3]=0   # leftover grey sparkle dots right of the ear
    y=cv2.dilate(y,np.ones((7,7),np.uint8)); a[...,3]=np.where((y==1)&(a[...,3]>0)&(np.arange(a.shape[1])[None,:]>=196),0,a[...,3]); return a
def save(a,p): Image.fromarray(a).save(p,optimize=True)
def eyes(a,ymin,ymax,xmin=0,xmax=255):
    rgb=a[...,:3].astype(int); r,g,b=rgb[...,0],rgb[...,1],rgb[...,2]
    dark=((r<125)&(g<95)&(b<85)&(r>=b)&(a[...,3]>200)).astype(np.uint8)
    dark[:ymin]=0;dark[ymax:]=0;dark[:,:xmin]=0;dark[:,xmax:]=0
    o=cv2.morphologyEx(dark,cv2.MORPH_OPEN,cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(7,7)))
    n,lab,st,cen=cv2.connectedComponentsWithStats(o)
    comps=[(st[i,4],i) for i in range(1,n) if 120<st[i,4]<1500]
    comps=sorted(comps,reverse=True)[:2]
    out=[]
    for ar,i in comps:
        m=(lab==i).astype(np.uint8)
        m=cv2.dilate(m,cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(7,7)))   # recover lash ring / highlights
        # fill holes (white highlights)
        inv=1-m; k,l2=cv2.connectedComponents(inv,connectivity=4)
        bord=set(np.unique(np.r_[l2[0],l2[-1],l2[:,0],l2[:,-1]])); m=(~np.isin(l2,list(bord))).astype(np.uint8)
        ys,xs=np.where(m); out.append((m,(float(xs.mean()),float(ys.mean())),(int(xs.min()),int(ys.min()),int(xs.max()),int(ys.max()))))
    out.sort(key=lambda e:e[1][0]); return out   # left eye first
def ell_mask(shape,cx,cy,rx,ry,f=3.0):
    H,W=shape; yy,xx=np.mgrid[0:H,0:W].astype(np.float32)
    d=np.sqrt(((xx-cx)/rx)**2+((yy-cy)/ry)**2); return np.clip((1-d)*min(rx,ry)/f,0,1)
def split_eyes(a,es,name):
    base=a.copy(); rgb=a[...,:3]
    allm=np.zeros(a.shape[:2],np.uint8)
    for m,_,_ in es: allm|=(m>0.02).astype(np.uint8)
    inp=cv2.inpaint(np.ascontiguousarray(rgb),allm*255,5,cv2.INPAINT_TELEA)
    base[...,:3]=np.where(allm[...,None]==1,inp,rgb)
    meta=[]
    for k,(m,c,bb) in enumerate(es):
        e=np.zeros_like(a); soft=m
        e[...,:3]=a[...,:3]; e[...,3]=(np.clip(soft,0,1)*255).astype(np.uint8)
        save(e,f'rig/{name}_eye{"LR"[k]}.png'); meta.append({'c':c,'bb':bb})
    return base,meta
meta={}
# ---------- IDLE rig
a=L('idle'); EY={'idle':[(97,153,20,18),(164,141,18,19)],'hold':[(101,177,21,20),(171,166,17,19)]}
es=[(ell_mask(a.shape[:2],*e),(e[0],e[1]),(e[0]-e[2],e[1]-e[3],e[0]+e[2],e[1]+e[3])) for e in EY['idle']]
base,m_eyes=split_eyes(a,es,'idle'); meta['idle']={'eyes':m_eyes}
H,W=a.shape[:2]; yy,xx=np.mgrid[0:H,0:W].astype(np.float32)
wh=np.clip((214-yy)/14,0,1)                      # 1 above y200 (head) -> 0 below y214 (body)
def ell(cx,cy,rx,ry,f):
    d=np.sqrt(((xx-cx)/rx)**2+((yy-cy)/ry)**2); return np.clip((1-d)*min(rx,ry)/f,0,1)
earL=ell(46,108,25,29,7); earR=ell(171,87,33,27,7)
al=base[...,3].astype(np.float32)
# ---- arms: two layers that can swing from the shoulders; the chest underneath is filled in
armL=ell(105,228,31,25,5)*np.clip((133.5-xx)/2+.5,0,1); armR=ell(162,228,31,25,5)*np.clip((xx-133.5)/2+.5,0,1)
armAny=np.maximum(armL,armR); hole=(armAny>0.03).astype(np.uint8)
hole=cv2.dilate(hole,np.ones((3,3),np.uint8))
row=cv2.GaussianBlur(base[256:262,:,:3].astype(np.float32).mean(0,keepdims=True),(0,0),sigmaX=4)   # belly colour per column
fillc=np.repeat(row,base.shape[0],axis=0)
fillc=cv2.GaussianBlur(fillc,(0,0),sigmaX=2)
base2=base.copy(); base2[...,:3]=np.where(hole[...,None]==1,fillc.astype(np.uint8),base[...,:3])
base2[...,:3]=np.where(cv2.GaussianBlur(hole.astype(np.float32),(0,0),1.5)[...,None]>0.02,np.where(hole[...,None]==1,base2[...,:3],cv2.GaussianBlur(base2[...,:3],(0,0),1.2)),base2[...,:3])
for n,e in (('L',armL),('R',armR)):
    p=base.copy(); p[...,3]=(al*e).astype(np.uint8); save(p,f'rig/idle_arm{n}.png')
base_orig=base; base=base2
bw=np.clip((yy-186)/6,0,1); body=base.copy(); body[...,3]=(al*bw).astype(np.uint8); save(body,'rig/idle_body.png')
head=base.copy(); headA=al*wh
hp=head.copy(); hp[...,3]=(headA*(1-np.maximum(earL,earR))).astype(np.uint8); save(hp,'rig/idle_head.png')
for n,e in (('L',earL),('R',earR)):
    p=head.copy(); p[...,3]=(headA*e).astype(np.uint8); save(p,f'rig/idle_ear{n}.png')
meta['idle'].update({'neck':[128,208],'earL':[62,122],'earR':[156,102],'shoulderL':[82,222],'shoulderR':[184,222]})
# ---------- HOLD rig
a=L('hold'); a[128:216,222:,3]=0; es=[(ell_mask(a.shape[:2],*e),(e[0],e[1]),(e[0]-e[2],e[1]-e[3],e[0]+e[2],e[1]+e[3])) for e in EY['hold']]
# remove leftover checker at the bottom edge
rgb=a[...,:3].astype(int); chroma=rgb.max(-1)-rgb.min(-1); bad=np.zeros(a.shape[:2],bool); bad[272:,140:200]=True
a[...,3]=np.where(bad&(chroma<40)&(rgb.mean(-1)>150),0,a[...,3])
base,m_eyes=split_eyes(a,es,'hold'); save(base,'rig/hold_base.png'); meta['hold']={'eyes':m_eyes}
# ---------- closed book cut from the celebrate pose of the storyboard
sc=np.array(Image.open('/tmp/story_cut.png')); box=(1290,835,1535,955)
sub=sc[box[1]:box[3],box[0]:box[2]].copy(); r,g,b=[sub[...,i].astype(int) for i in range(3)]
blue=((b>r+28)&(sub[...,3]>100)).astype(np.uint8)
blue=cv2.morphologyEx(blue,cv2.MORPH_CLOSE,cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(15,15)))
n,lab,st,_=cv2.connectedComponentsWithStats(blue); i=1+int(np.argmax(st[1:,4])); m=(lab==i).astype(np.uint8)
inv=1-m; k,l2=cv2.connectedComponents(inv,connectivity=4); bord=set(np.unique(np.r_[l2[0],l2[-1],l2[:,0],l2[:,-1]])); m=(~np.isin(l2,list(bord))).astype(np.uint8)
m=cv2.dilate(m,np.ones((3,3),np.uint8)); out=sub.copy(); out[...,3]=np.where(m==1,sub[...,3],0)
ys,xs=np.where(out[...,3]>40); out=out[ys.min():ys.max()+1,xs.min():xs.max()+1]
im=Image.fromarray(out); im=im.resize((int(im.width*0.7),int(im.height*0.7)),Image.LANCZOS); im.save('rig/book_closed.png',optimize=True)
meta['book']={'size':list(im.size)}; print('book',im.size)
json.dump(meta,open('rig/meta.json','w'),indent=1)
# preview
def comp(paths,bgc=(90,90,110)):
    ims=[Image.open(p).convert('RGBA') for p in paths]; W=sum(i.width for i in ims)+10*len(ims); Hh=max(i.height for i in ims)
    bg=Image.new('RGBA',(W,Hh),bgc+(255,)); x=0
    for i in ims: bg.alpha_composite(i,(x,0)); x+=i.width+10
    return bg
comp(['rig/idle_body.png','rig/idle_head.png','rig/idle_earL.png','rig/idle_eyeL.png','rig/hold_base.png','rig/book_closed.png']).convert('RGB').save('/tmp/rig_parts.png')
