// Runs inside the installed Chromium. Canvas text bounds come from changed pixels.
const check = (ok, message) => { if (!ok) throw Error(message); };
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const proto = CanvasRenderingContext2D.prototype;
const nativeText = proto.fillText;
const fontProperty = Object.getOwnPropertyDescriptor(proto, 'font');
Object.defineProperty(proto, 'font', {
  ...fontProperty,
  set(value) {
    const family = value.includes('monospace') ? '"DejaVu Sans Mono"' : '"Noto Sans CJK SC"';
    fontProperty.set.call(this, value.replace(/(px\s+).+$/, `$1${family}`));
  }
});
let tracing = false, events = [];
proto.fillText = function(text,x,y) {
  if (!tracing) return nativeText.call(this,text,x,y);
  text = String(text);
  const m = this.measureText(text);
  const x0 = Math.floor(x-m.actualBoundingBoxLeft)-2, y0 = Math.floor(y-m.actualBoundingBoxAscent)-2;
  const w = Math.ceil(x+m.actualBoundingBoxRight)+2-x0, h = Math.ceil(y+m.actualBoundingBoxDescent)+2-y0;
  check(x0 >= 0 && y0 >= 0 && x0+w <= this.canvas.width && y0+h <= this.canvas.height, `Clipped text: ${text}`);
  const before = this.getImageData(x0,y0,w,h).data;
  nativeText.call(this,text,x,y);
  const after = this.getImageData(x0,y0,w,h).data;
  let left=w,top=h,right=-1,bottom=-1;
  const changed=new Uint8Array(w*h);
  for(let p=0;p<w*h;p++) {
    const i=p*4;
    if(before[i]!==after[i] || before[i+1]!==after[i+1] || before[i+2]!==after[i+2] || before[i+3]!==after[i+3]) {
      const px=p%w,py=Math.floor(p/w);
      left=Math.min(left,px);top=Math.min(top,py);right=Math.max(right,px);bottom=Math.max(bottom,py);
      changed[p]=1;
    }
  }
  check(right>=left, `Text drew no pixels: ${text}`);
  events.push({text,anchor:[x,y],box:[x0+left,y0+top,right-left+1,bottom-top+1],font:this.font,
    raster:{x0,y0,w,h,changed,after}});
};
function canvas(w,h) { const c=document.createElement('canvas');c.width=w;c.height=h;return c; }
const png=c=>c.toDataURL('image/png').split(',')[1];
const inside=(a,b)=>a[0]>=b[0] && a[1]>=b[1] && a[0]+a[2]<=b[0]+b[2] && a[1]+a[3]<=b[1]+b[3];
function union(boxes) {
  const x=Math.min(...boxes.map(b=>b[0])),y=Math.min(...boxes.map(b=>b[1]));
  return [x,y,Math.max(...boxes.map(b=>b[0]+b[2]))-x,Math.max(...boxes.map(b=>b[1]+b[3]))-y];
}
function runSample(sample) {
  const p=sample.pattern,{cols,rows}=p.grid;
  state={cols,rows,grid:p.grid.cells.map(code=>code===null?-1:PALETTE.findIndex(c=>c.code===code)),
    sizeMode:'pattern',majorGridStep:5,boardProfile:'mini52'};
  els={projectTitle:{textContent:'自制小样'}};
  mode=sample.mode==='no-legend'?'native':sample.mode;
  tracing=false;
  DEVICE_LIMITS.exportPixels=12000000;
  let control=null,upstreamRenderError=null;
  try { control=buildExportCanvas(); } catch(error) {
    check(error.message==='export-memory','Unexpected upstream rendering failure');
    upstreamRenderError=error.message;
  }
  // The 138x239 page including its 64-color legend exceeds the upstream 12 MP cap.
  // This desktop-only prototype uses 14 MP for that case; no App limits are changed.
  if(upstreamRenderError) DEVICE_LIMITS.exportPixels=14000000;
  events=[];swatches=[];tracing=true;
  const full=renderObserved();tracing=false;
  const ctx=full.getContext('2d'),fullPixels=ctx.getImageData(0,0,full.width,full.height).data;
  let nativePixelsEqual=null;
  const fontFitAdaptation=Math.max(7,Math.floor(full.layout.cell*.32))!==Math.max(9,Math.floor(full.layout.cell*.32));
  if(mode==='native'&&control) {
    const expected=control.getContext('2d').getImageData(0,0,control.width,control.height).data;
    nativePixelsEqual=fullPixels.length===expected.length && fullPixels.every((v,i)=>v===expected[i]);
    check(nativePixelsEqual||fontFitAdaptation,'Instrumentation changed native render pixels');
  }
  let checkedTextPixels=0;
  for(const e of events) {
    const {x0,y0,w,changed,after}=e.raster;
    for(let p=0;p<changed.length;p++) if(changed[p]) {
      const i=((y0+Math.floor(p/w))*full.width+x0+p%w)*4,j=p*4;
      check(fullPixels[i]===after[j] && fullPixels[i+1]===after[j+1] && fullPixels[i+2]===after[j+2] && fullPixels[i+3]===after[j+3],`Overpainted text: ${e.text} at ${e.anchor}`);
      checkedTextPixels++;
    }
    delete e.raster;
  }
  const l=full.layout,gridBox=[l.ox,l.oy,cols*l.cell,rows*l.cell];
  const crop=sample.mode==='no-legend'?[l.chartX,l.oy-l.ruler,l.chartWidth,rows*l.cell+2*l.ruler]:[0,0,full.width,full.height];
  const final=canvas(crop[2],crop[3]);final.getContext('2d').drawImage(full,...crop,0,0,crop[2],crop[3]);
  const move=b=>[b[0]-crop[0],b[1]-crop[1],b[2],b[3]];
  const objects=[{id:'grid',cls:'grid_region',box:move(gridBox),parent:null,text:null}];
  const cellRecords=[],recognition=[],textProof=[],images={};
  function saveCrop(box,name) {
    check(inside(box,[0,0,final.width,final.height]),`Crop outside final image: ${name}`);
    const c=canvas(box[2],box[3]);c.getContext('2d').drawImage(final,...box,0,0,box[2],box[3]);
    const file=`crops/${name}.png`;images[file]=png(c);return file;
  }
  const gridTexts=events.filter(e=>inside(e.box,gridBox));
  const textByCell=new Map();
  for(const e of gridTexts) {
    const col=Math.floor((e.anchor[0]-l.ox)/l.cell),row=Math.floor((e.anchor[1]-l.oy)/l.cell),index=row*cols+col;
    check(!textByCell.has(index),'Two labels in one cell');textByCell.set(index,e);
  }
  const observedCounts={};
  for(let row=0;row<rows;row++) for(let col=0;col<cols;col++) {
    const index=row*cols+col,code=p.grid.cells[index];
    const originalBox=[l.ox+col*l.cell,l.oy+row*l.cell,l.cell,l.cell];
    const text=textByCell.get(index);
    check(code===null?!text:text&&text.text===code&&inside(text.box,originalBox),`Grid text mismatch ${row},${col}`);
    if(code!==null) observedCounts[code]=(observedCounts[code]||0)+1;
    const box=move(originalBox),file=saveCrop(box,`cell-${row}-${col}`);
    cellRecords.push({row,col,box,crop:file,label:code===null?'blank':'bead',code});
    if(code!==null) recognition.push({crop:file,text:code,kind:'code'});
  }
  check(same(observedCounts,sample.expected),'Rendered grid counts differ from handwritten answer');
  for(const [i,e] of events.entries()) {
    if(!inside(e.box,crop)) continue;
    textProof.push({text:e.text,box:move(e.box),font:e.font});
    if(inside(e.box,gridBox)) continue; // Grid codes are recognition targets, not code_text detection.
    const [ax,ay]=e.anchor;
    let cls='other_text',parent=null;
    if(ay===25 || ay===l.summaryY+12) cls='title_text';
    else if(ay>=l.oy-l.ruler && ay<=l.oy+rows*l.cell+l.ruler) cls='axis_label';
    else if(ay===l.summaryY+38 && ax===full.width-14) cls='watermark';
    const swatchIndex=swatches.findIndex(s=>ay>=s.box[1] && ay<s.box[1]+46 && ax>=s.box[0] && ax<s.box[0]+s.itemWidth);
    if(swatchIndex>=0) {
      const s=swatches[swatchIndex],code=PALETTE[s.index].code;
      parent=`li-${swatchIndex}`;
      if(e.text===code) cls='code_text';
      else if(/^(\d+ 颗|\(\d+\))$/.test(e.text)) {
        cls='count_text';check(e.text===(mode==='inline'?`(${sample.expected[code]})`:`${sample.expected[code]} 颗`),'Legend count mismatch');
      }
    }
    const id=`text-${i}`,box=move(e.box);
    objects.push({id,cls,box,parent,text:['code_text','count_text','title_text'].includes(cls)?e.text:null});
    if(cls==='code_text'||cls==='count_text') recognition.push({crop:saveCrop(box,id),text:e.text,kind:cls==='code_text'?'code':'count'});
  }
  if(sample.mode!=='no-legend') for(const [i,s] of swatches.entries()) {
    const id=`li-${i}`,box=move(s.box),children=objects.filter(o=>o.parent===id);
    check(children.filter(o=>o.cls==='code_text').length===1 && children.filter(o=>o.cls==='count_text').length===1,'Legend pair missing');
    objects.push({id:`swatch-${i}`,cls:'legend_swatch',box,parent:id,text:null});
    objects.push({id,cls:'legend_item',box:union([box,...children.map(o=>o.box)]),parent:null,text:null});
  }
  for(const o of objects) check(inside(o.box,[0,0,final.width,final.height]),`Box outside final image: ${o.id}`);
  if(sample.mode==='no-legend') check(!objects.some(o=>o.cls.startsWith('legend')||o.cls==='title_text'),'No-legend answer leakage');
  const overlay=canvas(final.width,final.height),oc=overlay.getContext('2d');oc.drawImage(final,0,0);
  const colors={grid_region:'#0084ff',legend_item:'#00a050',legend_swatch:'#ff9000',code_text:'#de0088',count_text:'#de0088',title_text:'#bb00dd',axis_label:'#00a5bc',other_text:'#777777',watermark:'#777777'};
  oc.lineWidth=1;
  for(const o of objects) {oc.strokeStyle=colors[o.cls];oc.strokeRect(...o.box);}
  for(const c of cellRecords) if(c.label==='blank') {oc.fillStyle='#00aaff33';oc.fillRect(c.box[0]+3,c.box[1]+3,c.box[2]-6,c.box[3]-6);}
  for(const e of gridTexts) {oc.strokeStyle='#de0088';oc.strokeRect(...move(e.box));}
  images['sheet.png']=png(final);images['overlay.png']=png(overlay);
  if(fontFitAdaptation&&control) {
    const e=gridTexts.find(e=>e.text.length===3);
    const row=Math.max(0,Math.floor((e.anchor[1]-l.oy)/l.cell)-1);
    const col=Math.max(0,Math.floor((e.anchor[0]-l.ox)/l.cell)-1);
    const region=[l.ox+col*l.cell,l.oy+row*l.cell,Math.min(10,cols-col)*l.cell,Math.min(6,rows-row)*l.cell];
    for(const [name,source] of [['font-before',control],['font-after',full]]) {
      const c=canvas(region[2],region[3]);c.getContext('2d').drawImage(source,...region,0,0,region[2],region[3]);images[name+'.png']=png(c);
    }
  }
  if(sample.id==='white-blank-native') {
    const input=canvas(cols*16,rows*16),ic=input.getContext('2d');
    p.grid.cells.forEach((code,i)=>{if(code!==null){ic.fillStyle=PALETTE.find(c=>c.code===code).hex;ic.fillRect(i%cols*16,Math.floor(i/cols)*16,16,16);}});
    images['cli-input.png']=png(input);
  }
  return {id:sample.id,images,labels:{
    pattern:p,
    detection:{image:'sheet.png',width:final.width,height:final.height,objects},
    cells:cellRecords,recognition,
    answer:{expected:sample.expected,titleTotal:sample.mode==='no-legend'?null:p.statistics.totalBeads,status:'complete',
      grid:p.grid,blankPositions:cellRecords.filter(c=>c.label==='blank').map(c=>[c.row,c.col]),
      origin:'self-authored fixture',layout:sample.mode,finalCrop:crop,paletteSource:p.palette.source},
    'text-proof':textProof
  },checks:{width:final.width,height:final.height,cols,rows,cellPixels:l.cell,
    projectJsonRoundtrip:sample.projectJsonRoundtrip,beads:p.statistics.totalBeads,blank:sample.blankCount,
    upstreamRenderError,exportPixelsLimit:DEVICE_LIMITS.exportPixels,
    colors:p.statistics.usedColors,H1:sample.expected.H1,H2:sample.expected.H2,
    detectionObjects:objects.length,recognitionCrops:recognition.length,
    fontFitAdaptation,nativePixelsEqual,checkedTextPixels,renderedGridAndLegendMatch:true}};
}
try {
  const samples=cases.map(runSample);
  // Repeat after other fixtures have run: detects stale state / crossed image-answer pairs.
  const repeated=runSample(cases[0]);
  check(repeated.images['sheet.png']===samples[0].images['sheet.png'],'Repeated run changed image');
  check(same(repeated.labels,samples[0].labels),'Repeated run changed labels');
  document.getElementById('result').textContent=JSON.stringify({samples});
} catch(error) { document.getElementById('result').textContent=JSON.stringify({error:error.stack}); }
