// Hue-shift the green bowler into another colour family while preserving its
// shading/lightness, so TGN (green) and Burger (tan) share the SAME hat shape
// (one HAT_SCALE fits both). Operates in HSL; remaps hue+sat, keeps lightness.
// Usage: node recolor-cap.js <in.png> <out.png> <targetHueDeg> <satMul>
const fs = require('fs');
const { PNG } = require('C:/Users/bigji/Documents/MfT-Launch/node_modules/pngjs');
const inP=process.argv[2], outP=process.argv[3];
const TH=parseFloat(process.argv[4]); const SMUL=parseFloat(process.argv[5]||'1.0');
const p=PNG.sync.read(fs.readFileSync(inP)); const W=p.width,H=p.height,d=p.data;
function rgb2hsl(r,g,b){r/=255;g/=255;b/=255;const mx=Math.max(r,g,b),mn=Math.min(r,g,b);let h=0,s=0,l=(mx+mn)/2;const c=mx-mn;if(c){s=l>0.5?c/(2-mx-mn):c/(mx+mn);if(mx===r)h=((g-b)/c+6)%6;else if(mx===g)h=(b-r)/c+2;else h=(r-g)/c+4;h*=60;}return[h,s,l];}
function hsl2rgb(h,s,l){h/=360;function f(t){if(t<0)t+=1;if(t>1)t-=1;if(t<1/6)return p2+(q2-p2)*6*t;if(t<1/2)return q2;if(t<2/3)return p2+(q2-p2)*(2/3-t)*6;return p2;}let q2=l<0.5?l*(1+s):l+s-l*s;let p2=2*l-q2;return[Math.round(f(h+1/3)*255),Math.round(f(h)*255),Math.round(f(h-1/3)*255)];}
for (let i=0;i<d.length;i+=4){ if(d[i+3]<8)continue;
  const [h,s,l]=rgb2hsl(d[i],d[i+1],d[i+2]);
  // only remap green-family pixels (leave the dark outline + any neutral pixels)
  if (s < 0.06) continue;                 // near-grey outline/AA: keep
  const ns=Math.min(1, s*SMUL);
  const [r,g,b]=hsl2rgb(TH, ns, l);
  d[i]=r; d[i+1]=g; d[i+2]=b;
}
fs.writeFileSync(outP, PNG.sync.write(p));
console.error(`  recolor ${outP}: hue->${TH} satx${SMUL}`);
