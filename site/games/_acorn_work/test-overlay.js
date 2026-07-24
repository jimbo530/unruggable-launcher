// Emulate the engine's WHOLE-CHARACTER draw + hat overlay so we can tune
// HEAD_ANCHOR.y / HAT_SCALE visually before touching the game.
// Box: body drawn at x:[-dw/2..dw/2], y:[-dh..0] (AR from the body sprite).
// Hat: width = HAT_SCALE*dw, centered at (HEAD_ANCHOR.x*dw from left, HEAD_ANCHOR.y down from top).
// Usage: node test-overlay.js <body.png> <hat.png> <out.png> <headY> <hatScale> [headX=0.5]
const fs = require('fs');
const { PNG } = require('C:/Users/bigji/Documents/MfT-Launch/node_modules/pngjs');
const bodyP=process.argv[2], hatP=process.argv[3], outP=process.argv[4];
const HEAD_Y=parseFloat(process.argv[5]), HAT_SCALE=parseFloat(process.argv[6]);
const HEAD_X=parseFloat(process.argv[7]||'0.5');

const body=PNG.sync.read(fs.readFileSync(bodyP));
const hat=PNG.sync.read(fs.readFileSync(hatP));

// canvas: render body at a fixed display height, hat overlaid. Use 2x supersample then keep.
const DH=520;                                  // display height px
const DW=Math.round(DH*body.width/body.height);
const PAD=Math.round(DW*0.6);                   // side padding for wide hats
const CW=DW+PAD*2, CH=DH+40;
const cv=new PNG({width:CW,height:CH}); // gray bg
for (let p=0;p<CW*CH;p++){const i=p<<2;cv.data[i]=128;cv.data[i+1]=128;cv.data[i+2]=128;cv.data[i+3]=255;}

function over(img, dx0, dy0, dw, dh){
  for (let y=0;y<dh;y++)for(let x=0;x<dw;x++){
    const sx=Math.min(img.width-1,Math.floor(x*img.width/dw));
    const sy=Math.min(img.height-1,Math.floor(y*img.height/dh));
    const si=(sy*img.width+sx)<<2; const a=img.data[si+3]/255; if(a<=0.01)continue;
    const DXx=dx0+x, DYy=dy0+y; if(DXx<0||DYy<0||DXx>=CW||DYy>=CH)continue;
    const di=(DYy*CW+DXx)<<2;
    cv.data[di]=Math.round(img.data[si]*a+cv.data[di]*(1-a));
    cv.data[di+1]=Math.round(img.data[si+1]*a+cv.data[di+1]*(1-a));
    cv.data[di+2]=Math.round(img.data[si+2]*a+cv.data[di+2]*(1-a));
  }
}

// body: left at PAD, top at 20
const bx0=PAD, by0=20;
over(body, bx0, by0, DW, DH);

// hat: width=HAT_SCALE*DW, centered at (HEAD_X over box, HEAD_Y down from top)
const hw=Math.round(HAT_SCALE*DW);
const hh=Math.round(hw*hat.height/hat.width);
const cx=bx0+Math.round(HEAD_X*DW);
const cy=by0+Math.round(HEAD_Y*DH);
over(hat, cx-Math.round(hw/2), cy-Math.round(hh/2), hw, hh);

fs.writeFileSync(outP, PNG.sync.write(cv));
console.error(`  ${outP}: body ${DW}x${DH}, hat ${hw}x${hh} @ center(${HEAD_X},${HEAD_Y}) scale ${HAT_SCALE}`);
