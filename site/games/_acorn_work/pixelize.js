// Node port of baseling-sprites.js pixelize(): turn a smooth cut-out PNG into
// authentic pixel art so it stays crisp under the game's nearest-neighbour
// scaling. Steps mirror the browser pipeline:
//   1. trim to alpha bbox, scale (nearest) into a GRID x GRID cell grid
//   2. harden alpha (solid/empty), quantize to ~PALETTE colors
//   3. add a 1px dark outline around the silhouette
//   4. scale the grid back up to OUT px (nearest) so each cell is a clean block
// Usage: node pixelize.js <in.png> <out.png> [grid=64] [out=256] [palette=20]
const fs = require('fs');
const { PNG } = require('C:/Users/bigji/Documents/MfT-Launch/node_modules/pngjs');

const inP = process.argv[2], outP = process.argv[3];
const GRID = parseInt(process.argv[4] || '64', 10);   // pixel grid (taller-friendly than 48)
const OUT  = parseInt(process.argv[5] || '256', 10);
const PALETTE = parseInt(process.argv[6] || '20', 10);
const OUTLINE = [26, 26, 46];

const src = PNG.sync.read(fs.readFileSync(inP));
const SW = src.width, SH = src.height, sd = src.data;

// 1a. alpha bbox
let minX = SW, minY = SH, maxX = -1, maxY = -1;
for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) if (sd[((y*SW+x)<<2)+3] > 16) { if (x<minX)minX=x; if (x>maxX)maxX=x; if (y<minY)minY=y; if (y>maxY)maxY=y; }
const cw = maxX - minX + 1, ch = maxY - minY + 1;

// 1b. nearest-neighbour downscale the bbox into a GRID-wide/tall cell grid that
// preserves aspect (fit the longer side to GRID).
const aspect = cw / ch;
let gW, gH;
if (aspect >= 1) { gW = GRID; gH = Math.max(1, Math.round(GRID / aspect)); }
else { gH = GRID; gW = Math.max(1, Math.round(GRID * aspect)); }
const small = new PNG({ width: gW, height: gH });
for (let y = 0; y < gH; y++) for (let x = 0; x < gW; x++) {
  // area-average sample for a cleaner downscale than point-sampling
  const sx0 = minX + Math.floor(x * cw / gW), sx1 = minX + Math.floor((x+1) * cw / gW);
  const sy0 = minY + Math.floor(y * ch / gH), sy1 = minY + Math.floor((y+1) * ch / gH);
  let r=0,g=0,b=0,a=0,n=0;
  for (let yy = sy0; yy < Math.max(sy0+1, sy1); yy++) for (let xx = sx0; xx < Math.max(sx0+1, sx1); xx++) {
    const i = ((yy*SW+xx)<<2); const al = sd[i+3];
    if (al > 16) { r += sd[i]*al; g += sd[i+1]*al; b += sd[i+2]*al; a += al; }
    n++;
  }
  const di = (y*gW+x)<<2;
  if (a > 0) { small.data[di]=Math.round(r/a); small.data[di+1]=Math.round(g/a); small.data[di+2]=Math.round(b/a); small.data[di+3]=Math.round(a/n); }
  else { small.data[di+3]=0; }
}

// 2. harden alpha + quantize
const sdat = small.data;
for (let p = 0; p < sdat.length; p += 4) sdat[p+3] = sdat[p+3] >= 110 ? 255 : 0;
quantize(sdat, PALETTE);

// 3. 1px outline on a grid one cell larger each side
const og = { w: gW + 2, h: gH + 2 };
const out = new PNG({ width: og.w, height: og.h });
for (let y = 0; y < gH; y++) for (let x = 0; x < gW; x++) {
  const si = (y*gW+x)<<2, di = ((y+1)*og.w+(x+1))<<2;
  out.data[di]=sdat[si]; out.data[di+1]=sdat[si+1]; out.data[di+2]=sdat[si+2]; out.data[di+3]=sdat[si+3];
}
const solid = new Uint8Array(og.w*og.h);
for (let p = 0; p < og.w*og.h; p++) solid[p] = out.data[(p<<2)+3] > 0 ? 1 : 0;
for (let y = 0; y < og.h; y++) for (let x = 0; x < og.w; x++) {
  const idx = y*og.w+x; if (solid[idx]) continue;
  let touch = false;
  for (let dy=-1; dy<=1 && !touch; dy++) for (let dx=-1; dx<=1; dx++) { if(!dx&&!dy)continue; const nx=x+dx,ny=y+dy; if(nx<0||ny<0||nx>=og.w||ny>=og.h)continue; if(solid[ny*og.w+nx]){touch=true;break;} }
  if (touch) { const di=idx<<2; out.data[di]=OUTLINE[0]; out.data[di+1]=OUTLINE[1]; out.data[di+2]=OUTLINE[2]; out.data[di+3]=255; }
}

// 4. scale the (grid+2) up to OUT (preserve aspect), nearest-neighbour
const oAspect = og.w / og.h;
let outW, outH;
if (oAspect >= 1) { outW = OUT; outH = Math.round(OUT / oAspect); }
else { outH = OUT; outW = Math.round(OUT * oAspect); }
const big = new PNG({ width: outW, height: outH });
for (let y = 0; y < outH; y++) for (let x = 0; x < outW; x++) {
  const sx = Math.min(og.w-1, Math.floor(x * og.w / outW)), sy = Math.min(og.h-1, Math.floor(y * og.h / outH));
  const si = (sy*og.w+sx)<<2, di = (y*outW+x)<<2;
  big.data[di]=out.data[si]; big.data[di+1]=out.data[si+1]; big.data[di+2]=out.data[si+2]; big.data[di+3]=out.data[si+3];
}
fs.writeFileSync(outP, PNG.sync.write(big));
console.error(`  pixelize ${outP}: grid ${gW}x${gH} -> ${outW}x${outH}`);

function quantize(data, maxColors) {
  const bins = {};
  for (let i = 0; i < data.length; i += 4) {
    if (data[i+3] === 0) continue;
    const r=data[i]>>4, g=data[i+1]>>4, b=data[i+2]>>4; const key=(r<<8)|(g<<4)|b;
    const bn = bins[key]; if (bn) { bn.r+=data[i]; bn.g+=data[i+1]; bn.b+=data[i+2]; bn.c++; } else bins[key]={r:data[i],g:data[i+1],b:data[i+2],c:1};
  }
  let pal = Object.values(bins).map(b=>({r:b.r/b.c,g:b.g/b.c,b:b.b/b.c,c:b.c}));
  if (pal.length <= maxColors) return;
  pal.sort((a,b)=>b.c-a.c); pal = pal.slice(0, maxColors);
  for (let i = 0; i < data.length; i += 4) {
    if (data[i+3] === 0) continue;
    let best=0,bd=Infinity; for (let c=0;c<pal.length;c++){const dr=data[i]-pal[c].r,dg=data[i+1]-pal[c].g,db=data[i+2]-pal[c].b;const dd=dr*dr+dg*dg+db*db;if(dd<bd){bd=dd;best=c;}}
    data[i]=Math.round(pal[best].r); data[i+1]=Math.round(pal[best].g); data[i+2]=Math.round(pal[best].b);
  }
}
