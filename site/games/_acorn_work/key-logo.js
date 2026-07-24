// Isolate a logo from its background.
//   mode=dark   -> KEEP dark pixels (TGN black silhouette on yellow-green gradient)
//   mode=alpha  -> KEEP pixels already opaque & not near-white (burger on white/transparent)
// Then despeckle to the largest blob, trim to bbox.
// Usage: node key-logo.js <in.png> <out.png> <dark|alpha>
const fs = require('fs');
const { PNG } = require('C:/Users/bigji/Documents/MfT-Launch/node_modules/pngjs');
const inP = process.argv[2], outP = process.argv[3], mode = process.argv[4] || 'dark';
const png = PNG.sync.read(fs.readFileSync(inP));
const W = png.width, H = png.height, d = png.data;

function keep(i) {
  const r = d[i], g = d[i+1], b = d[i+2], a = d[i+3];
  if (a < 24) return false;
  if (mode === 'dark') {
    // TGN silhouette: dark ink. Background is bright yellow-green (~210,225,110).
    const mx = Math.max(r, g, b);
    return mx < 110;                 // keep only genuinely dark pixels
  } else {
    // burger: drop near-white / very light bg, keep colored burger
    const mn = Math.min(r, g, b);
    if (r > 232 && g > 232 && b > 232) return false; // white
    return true;
  }
}

const fg = new Uint8Array(W*H);
for (let p = 0; p < W*H; p++) if (keep(p<<2)) fg[p] = 1;

// despeckle: keep largest fg blob (+ blobs >= 8% of it, for multi-part logos like TGN's hair tufts)
const comp = new Int32Array(W*H).fill(-1); const q = new Int32Array(W*H);
const sizeOf=[]; let best=-1,bestSize=0,label=0;
for (let p0=0;p0<W*H;p0++){ if(!fg[p0]||comp[p0]!==-1)continue;
  let head=0,tail=0,size=0;q[tail++]=p0;comp[p0]=label;
  while(head<tail){const p=q[head++];size++;const x=p%W,y=(p-x)/W;
    const nb=[[x-1,y],[x+1,y],[x,y-1],[x,y+1],[x-1,y-1],[x+1,y-1],[x-1,y+1],[x+1,y+1]];
    for(const[nx,ny]of nb){if(nx<0||ny<0||nx>=W||ny>=H)continue;const np=ny*W+nx;if(!fg[np]||comp[np]!==-1)continue;comp[np]=label;q[tail++]=np;}}
  sizeOf[label]=size;if(size>bestSize){bestSize=size;best=label;}label++;
}
const MINKEEP = Math.max(40, bestSize*0.06);
let kept=0;
for (let p=0;p<W*H;p++){ if(!fg[p])continue; if(comp[p]===best||sizeOf[comp[p]]>=MINKEEP){kept++;}else fg[p]=0; }
console.error(`  logo[${mode}]: ${label} blobs, largest ${bestSize}px, kept ${kept}px (>=${MINKEEP|0})`);

// apply alpha
const out0 = new PNG({width:W,height:H});
for (let p=0;p<W*H;p++){const i=p<<2;out0.data[i]=d[i];out0.data[i+1]=d[i+1];out0.data[i+2]=d[i+2];out0.data[i+3]=fg[p]?d[i+3]:0;}

// trim
let minX=W,minY=H,maxX=-1,maxY=-1;
for (let y=0;y<H;y++)for(let x=0;x<W;x++)if(out0.data[((y*W+x)<<2)+3]>16){if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y;}
if (maxX<0){console.error('  !! nothing left'); process.exit(2);}
const cw=maxX-minX+1, ch=maxY-minY+1;
const out=new PNG({width:cw,height:ch});
for (let y=0;y<ch;y++)for(let x=0;x<cw;x++){const si=((minY+y)*W+(minX+x))<<2;const di=(y*cw+x)<<2;out.data[di]=out0.data[si];out.data[di+1]=out0.data[si+1];out.data[di+2]=out0.data[si+2];out.data[di+3]=out0.data[si+3];}
fs.writeFileSync(outP, PNG.sync.write(out));
console.error(`  wrote ${outP} ${cw}x${ch}`);
