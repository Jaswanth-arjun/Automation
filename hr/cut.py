from PIL import Image
import numpy as np, cv2
im=Image.open('/mnt/user-data/uploads/1795187779413_image.png').convert('RGB'); rgb=np.array(im).astype(int)
mx=rgb.max(-1); mn=rgb.min(-1); chroma=mx-mn; bright=rgb.mean(-1)
core=((chroma>=28)|(bright<125)).astype(np.uint8)
core=cv2.morphologyEx(core,cv2.MORPH_OPEN,np.ones((2,2),np.uint8))
closed=cv2.morphologyEx(core,cv2.MORPH_CLOSE,cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(9,9)))
inv=(1-closed).astype(np.uint8)
n,lab=cv2.connectedComponents(inv,connectivity=4)
border=set(np.unique(np.r_[lab[0],lab[-1],lab[:,0],lab[:,-1]]))-{0}
mask=(~np.isin(lab,list(border))).astype(np.uint8)
# drop tiny blobs
n2,l2,st,_=cv2.connectedComponentsWithStats(mask,connectivity=8)
keep=np.zeros_like(mask)
for i in range(1,n2):
    if st[i,4]>=150: keep[l2==i]=1
mask=keep
# strip light-gray halo on the boundary band
band=mask-cv2.erode(mask,np.ones((7,7),np.uint8))
halo=(band==1)&(chroma<16)&(bright>170)
mask[halo]=0
mask=cv2.morphologyEx(mask,cv2.MORPH_OPEN,np.ones((2,2),np.uint8))
alpha=cv2.GaussianBlur(cv2.erode(mask,np.ones((2,2),np.uint8)).astype(np.float32),(0,0),0.7)
rgba=np.dstack([rgb.astype(np.uint8),(np.clip(alpha,0,1)*255).astype(np.uint8)])
Image.fromarray(rgba).save('/tmp/story_cut.png')
bgc=Image.new('RGBA',im.size,(60,60,80,255)); bgc.alpha_composite(Image.fromarray(rgba)); bgc.convert('RGB').save('/tmp/story_cut_dark.png')
