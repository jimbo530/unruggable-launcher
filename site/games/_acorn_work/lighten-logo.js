// Recolor a dark silhouette logo to a chosen flat colour so it reads on a
// coloured hat (the TGN black sprout disappears into green). Keeps the alpha
// shape; replaces RGB of all opaque pixels with the target, with a slight dark
// rim from existing darkness so it still has form.
// Usage: node lighten-logo.js <in.png> <out.png> <r> <g> <b>
const fs=require('fs');
const {PNG}=require('C:/Users/bigji/Documents/MfT-Launch/node_modules/pngjs');
const inP=process.argv[2],outP=process.argv[3];
const R=parseInt(process.argv[4]),G=parseInt(process.argv[5]),B=parseInt(process.argv[6]);
const p=PNG.sync.read(fs.readFileSync(inP));const d=p.data;
for(let i=0;i<d.length;i+=4){ if(d[i+3]<24)continue; d[i]=R;d[i+1]=G;d[i+2]=B; }
fs.writeFileSync(outP,PNG.sync.write(p));
console.error(`  lighten-logo ${outP}: -> rgb(${R},${G},${B})`);
