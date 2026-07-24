// Simple magenta/pink keyer for the isolated alternate caps + a dark-frame border
// strip. The Grok caps sit on a magenta field (R high, G low, B mid) but ALSO have
// a black vignette frame in the corners. We:
//   1. border-flood across BOTH magenta and near-black frame pixels -> background
//   2. despeckle (keep largest non-bg blob = the cap)
//   3. hole-fill small enclosed bg pockets (so the cap reads solid)
//   4. 1px erode to kill the magenta AA halo, feather, trim
// Usage: node key-magenta.js <in.png> <out.png>
// Env: MAG_RMIN=120 MAG_GMAX=120 MAG_DOM=30  DARK_MAX=34  ERODE=2  DEBUG=1
const fs = require('fs');
const { PNG } = require('C:/Users/bigji/Documents/MfT-Launch/node_modules/pngjs');
const inP = process.argv[2], outP = process.argv[3];
const E = (k, d) => parseFloat(process.env[k] !== undefined ? process.env[k] : d);
const MAG_RMIN = E('MAG_RMIN', 120);   // magenta: red at least this
const MAG_GMAX = E('MAG_GMAX', 125);   // magenta: green at most this
const MAG_DOM  = E('MAG_DOM', 28);     // magenta: R and B both exceed G by this
const DARK_MAX = E('DARK_MAX', 36);    // frame: all channels <= this (near black)
const ERODE    = parseInt(process.env.ERODE !== undefined ? process.env.ERODE : '2', 10);
const DEBUG    = process.env.DEBUG === '1';

const png = PNG.sync.read(fs.readFileSync(inP));
const W = png.width, H = png.height, d = png.data;

function isMagenta(i) {
  const r = d[i], g = d[i+1], b = d[i+2];
  // bright magenta: R high, G low, both R and B clearly above G
  if (r >= MAG_RMIN && g <= MAG_GMAX && (r - g) >= MAG_DOM && (b - g) >= MAG_DOM && r > b - 10) return true;
  // washed-out mauve/pink: R dominant, G the smallest channel, B above G (bluish-pink).
  // The tan nut (G>B) and green cap (G>=R) fail this, so the figure is preserved.
  if (r >= 130 && (r - g) >= 40 && b > g + 3 && b >= 95) return true;
  return false;
}
function isDarkFrame(i) {
  const r = d[i], g = d[i+1], b = d[i+2];
  return r <= DARK_MAX && g <= DARK_MAX && b <= DARK_MAX;
}
function isBg(i) { return d[i+3] < 8 || isMagenta(i) || isDarkFrame(i); }

// border flood across bg-like pixels
const bg = new Uint8Array(W * H);
const stack = new Int32Array(W * H);
let sp = 0;
function push(x, y) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const p = y * W + x; if (bg[p]) return;
  if (isBg(p << 2)) { bg[p] = 1; stack[sp++] = p; }
}
for (let x = 0; x < W; x++) { push(x, 0); push(x, H - 1); }
for (let y = 0; y < H; y++) { push(0, y); push(W - 1, y); }
while (sp > 0) { const p = stack[--sp]; const x = p % W, y = (p - x) / W; push(x-1,y); push(x+1,y); push(x,y-1); push(x,y+1); }

let bgc = 0; for (let p = 0; p < W*H; p++) if (bg[p]) bgc++;
console.error(`  magenta flood: ${bgc}px bg (${(100*bgc/(W*H)).toFixed(1)}%)`);

// despeckle: keep only the largest non-bg component (the cap)
{
  const comp = new Int32Array(W*H).fill(-1); const q = new Int32Array(W*H);
  const sizeOf = []; let best = -1, bestSize = 0, label = 0;
  for (let p0 = 0; p0 < W*H; p0++) {
    if (bg[p0] || comp[p0] !== -1) continue;
    let head=0, tail=0, size=0; q[tail++]=p0; comp[p0]=label;
    while (head < tail) { const p=q[head++]; size++; const x=p%W,y=(p-x)/W;
      const nb=[[x-1,y],[x+1,y],[x,y-1],[x,y+1],[x-1,y-1],[x+1,y-1],[x-1,y+1],[x+1,y+1]];
      for (const [nx,ny] of nb){if(nx<0||ny<0||nx>=W||ny>=H)continue;const np=ny*W+nx;if(bg[np]||comp[np]!==-1)continue;comp[np]=label;q[tail++]=np;} }
    sizeOf[label]=size; if(size>bestSize){bestSize=size;best=label;} label++;
  }
  let dropped=0;
  for (let p=0;p<W*H;p++){ if(bg[p])continue; if(comp[p]!==best){bg[p]=1;dropped++;} }
  console.error(`  despeckle: kept largest blob ${bestSize}px, dropped ${dropped}px`);
}

// hole-fill: restore enclosed (non-border-reachable) bg back into the cap
{
  const reach = new Uint8Array(W*H); const q = new Int32Array(W*H); let t=0;
  function pr(x,y){if(x<0||y<0||x>=W||y>=H)return;const p=y*W+x;if(reach[p]||!bg[p])return;reach[p]=1;q[t++]=p;}
  for (let x=0;x<W;x++){pr(x,0);pr(x,H-1);} for (let y=0;y<H;y++){pr(0,y);pr(W-1,y);}
  for (let h2=0;h2<t;h2++){const p=q[h2];const x=p%W,y=(p-x)/W;pr(x-1,y);pr(x+1,y);pr(x,y-1);pr(x,y+1);}
  let filled=0; for (let p=0;p<W*H;p++){ if(bg[p]&&!reach[p]){bg[p]=0;filled++;} }
  console.error(`  hole-fill: restored ${filled}px enclosed interior`);
}

// erode foreground along bg edge (kills magenta/AA halo)
for (let ring=0; ring<ERODE; ring++) {
  const edge=[];
  for (let p=0;p<W*H;p++){ if(bg[p])continue; const x=p%W,y=(p-x)/W;
    if((x>0&&bg[p-1])||(x<W-1&&bg[p+1])||(y>0&&bg[p-W])||(y<H-1&&bg[p+W])) edge.push(p); }
  for (const p of edge) bg[p]=1;
}

// apply alpha + 1px feather
for (let p=0;p<W*H;p++){ const i=p<<2;
  if (bg[p]) { d[i+3]=0; continue; }
  const x=p%W,y=(p-x)/W;
  const nearBg=(x>0&&bg[p-1])||(x<W-1&&bg[p+1])||(y>0&&bg[p-W])||(y<H-1&&bg[p+W]);
  if (nearBg) d[i+3]=150;
}

if (DEBUG) {
  const o=new PNG({width:W,height:H});
  for (let p=0;p<W*H;p++){const i=p<<2;const a=d[i+3]/255;o.data[i]=Math.round(d[i]*a+128*(1-a));o.data[i+1]=Math.round(d[i+1]*a+128*(1-a));o.data[i+2]=Math.round(d[i+2]*a+128*(1-a));o.data[i+3]=255;}
  fs.writeFileSync(outP+'.mask.png', PNG.sync.write(o));
}

// trim
let minX=W,minY=H,maxX=-1,maxY=-1;
for (let y=0;y<H;y++)for(let x=0;x<W;x++)if(d[((y*W+x)<<2)+3]>16){if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y;}
if (maxX<0){console.error('  !! nothing left'); process.exit(2);}
const PAD=2;
minX=Math.max(0,minX-PAD);minY=Math.max(0,minY-PAD);maxX=Math.min(W-1,maxX+PAD);maxY=Math.min(H-1,maxY+PAD);
const cw=maxX-minX+1, ch=maxY-minY+1;
const out=new PNG({width:cw,height:ch});
for (let y=0;y<ch;y++)for(let x=0;x<cw;x++){const si=((minY+y)*W+(minX+x))<<2;const di=(y*cw+x)<<2;out.data[di]=d[si];out.data[di+1]=d[si+1];out.data[di+2]=d[si+2];out.data[di+3]=d[si+3];}
fs.writeFileSync(outP, PNG.sync.write(out));
let opaque=0; for (let p=0;p<cw*ch;p++) if(out.data[(p<<2)+3]>16) opaque++;
console.error(`  wrote ${outP} ${cw}x${ch} (from ${W}x${H}); opaque=${(100*opaque/(cw*ch)).toFixed(1)}%`);
