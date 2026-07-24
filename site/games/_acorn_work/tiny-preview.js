const fs=require("fs"); const {PNG}=require("C:/Users/bigji/Documents/MfT-Launch/node_modules/pngjs");
const inP=process.argv[2],outP=process.argv[3],TH=parseInt(process.argv[4]||"48",10),ZOOM=parseInt(process.argv[5]||"5",10),BG=parseInt(process.argv[6]||"205",10);
const src=PNG.sync.read(fs.readFileSync(inP));const SW=src.width,SH=src.height;
const tw=Math.round(SW*TH/SH);
// downscale nearest (like the game)
const small=new PNG({width:tw,height:TH});
for(let y=0;y<TH;y++)for(let x=0;x<tw;x++){const sx=Math.min(SW-1,Math.floor(x*SW/tw)),sy=Math.min(SH-1,Math.floor(y*SH/TH));const si=(sy*SW+sx)<<2,di=(y*tw+x)<<2;small.data[di]=src.data[si];small.data[di+1]=src.data[si+1];small.data[di+2]=src.data[si+2];small.data[di+3]=src.data[si+3];}
// upscale nearest by ZOOM, composite over BG
const W=tw*ZOOM,H=TH*ZOOM;const o=new PNG({width:W,height:H});
for(let y=0;y<H;y++)for(let x=0;x<W;x++){const sx=Math.floor(x/ZOOM),sy=Math.floor(y/ZOOM);const si=(sy*tw+sx)<<2;const a=small.data[si+3]/255;const di=(y*W+x)<<2;o.data[di]=Math.round(small.data[si]*a+BG*(1-a));o.data[di+1]=Math.round(small.data[si+1]*a+BG*(1-a));o.data[di+2]=Math.round(small.data[si+2]*a+BG*(1-a));o.data[di+3]=255;}
fs.writeFileSync(outP,PNG.sync.write(o));console.error("tiny-preview",outP,tw+"x"+TH,"@"+ZOOM+"x");
