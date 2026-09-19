import * as T from './vendor/three.module.js';
const unitBox=new T.BoxGeometry(1,1,1),unitCylinder=new T.CylinderGeometry(1,1,1,24),unitSphere=new T.SphereGeometry(1,16,10),unitCone=new T.ConeGeometry(1,1,16);
const palette={slab:0xc3cbd0,wall:0xcbd7df,steel:0x40576a,roof:0x64889f,machine:0x16899c,light:0xa7bdc7,orange:0xe0923e,dark:0x354652,water:0x438d9b,green:0x477259,road:0x69777e,white:0xe5e9e8};
const materials=new Map();
function material(color,metal=.05){const key=color+':'+metal;if(!materials.has(key))materials.set(key,new T.MeshStandardMaterial({color,roughness:metal>.3?.38:.78,metalness:metal}));return materials.get(key);}
function shapeMesh(g,geo,x,y,z,sx,sy,sz,col,metal=0){const m=new T.Mesh(geo,material(col,metal));m.position.set(x,y,z);m.scale.set(sx,sy,sz);m.castShadow=true;m.receiveShadow=true;g.add(m);return m;}
function box(g,x,y,z,w,d,h,c=palette.light){return shapeMesh(g,unitBox,x,y,z,w,d,h,c);}
function cyl(g,x,y,z,r,h,c=palette.light,axis='z'){const m=shapeMesh(g,unitCylinder,x,y,z,r,h,r,c,.25);if(axis==='z')m.rotation.x=Math.PI/2;else if(axis==='x')m.rotation.z=Math.PI/2;return m;}
function sphere(g,x,y,z,rx,ry,rz,c){return shapeMesh(g,unitSphere,x,y,z,rx,ry,rz,c,.15);}
function rod(g,a,b,r,c=palette.steel){const start=new T.Vector3(...a),end=new T.Vector3(...b),v=end.clone().sub(start);const m=shapeMesh(g,unitCylinder,...start.add(end).multiplyScalar(.5).toArray(),r,v.length(),r,c,.25);m.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),v.normalize());return m;}
function polygon(g,coords,z,height,col){const shape=new T.Shape(coords.map(p=>new T.Vector2(...p)));const geo=new T.ExtrudeGeometry(shape,{depth:height,bevelEnabled:false});return shapeMesh(g,geo,0,0,z,1,1,1,col);}
function labelSafe(item){return {itemId:item.id,name:item.name,estimatedHeight:true,source:item.footprintSource};}
export function buildSite(data){
 const root=new T.Group();root.name='Factory layout — conceptual reconstruction';root.userData={units:'metres',cadOrigin:data.origin,assumptions:data.assumptions};
 const categories={};for(const name of ['site','buildings','machines','utilities','storage','landscape']){categories[name]=new T.Group();categories[name].name=name;root.add(categories[name]);}
 const byId=new Map(),roofParts=[],upperParts=[];const [ox,oy]=data.origin;
 function worldBox(g,x,y,z,w,d,h,c){return box(g,x-ox,y-oy,z,w,d,h,c);}
 function worldPoly(coords,z,h,c){return polygon(categories.site,coords.map(p=>[p[0]-ox,p[1]-oy]),z,h,c);}
 worldPoly([[631,53],[838,53],[838,258],[739,258],[739,329],[632,329]],-.7,.65,0xa5b3b5);
 worldPoly([[656,90],[676,70],[826,70],[826,256],[656,256]],-.04,.08,0xc2cbcc);
 worldPoly([[690,282],[728,282],[728,315],[690,315]],-.04,.08,0xc2cbcc);
 function road(points,width=9){const g=categories.site;for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy),m=worldBox(g,(a[0]+b[0])/2,(a[1]+b[1])/2,.045,len,width,.07,palette.road);m.rotation.z=Math.atan2(dy,dx);cyl(g,b[0]-ox,b[1]-oy,.045,width/2,.07,palette.road);for(let j=3;j<len;j+=9){const x=a[0]+dx*j/len,y=a[1]+dy*j/len;const dash=worldBox(g,x,y,.09,3,.13,.02,0xd5dcda);dash.rotation.z=Math.atan2(dy,dx);}}}
 road([[639,321],[639,70],[642,62],[648,58],[833,58]],10);
 road([[683,247],[814,247],[822,240],[824,229],[824,200],[819,192],[816,187],[820,181],[824,174],[824,77]],9);
 road([[683,246],[683,115],[692,113],[821,113]],8.5);
 road([[684,144],[815,144],[824,139]],6);
 road([[684,157],[698,157]],4);
 road([[684,247],[684,275],[691,282],[726,282]],8);
 road([[728,283],[728,317],[705,317]],7);
 road([[814,112],[818,105],[818,72]],6);
 road([[746,80],[744,84],[744,97],[748,101],[809,101],[814,97],[814,84],[810,80],[746,80]],4);
 for(const [x,y,w,d]of [[668,251,22,8],[727,251,88,8],[811,222,25,40],[703,221,26,8],[706,77,58,9],[667,97,17,19],[790,123,20,7]])worldBox(categories.landscape,x,y,.1,w,d,.18,0x789d7d);
 const boundary=[[656,90],[676,70],[826,70],[826,256],[656,256],[656,90]];
 for(let i=1;i<boundary.length;i++){const a=boundary[i-1],b=boundary[i],len=Math.hypot(b[0]-a[0],b[1]-a[1]);for(let j=0;j<len;j+=5){const x=a[0]+(b[0]-a[0])*j/len,y=a[1]+(b[1]-a[1])*j/len;worldBox(categories.site,x,y,1.1,.12,.12,2.2,0x637f88);}for(const z of [.3,1.1,2])rod(categories.site,[a[0]-ox,a[1]-oy,z],[b[0]-ox,b[1]-oy,z],.035,0x6b848d);}
 function tree(x,y){const g=categories.landscape;worldBox(g,x,y,1,.28,.28,2,0x6e6554);sphere(g,x-ox,y-oy,3,1.4,1.4,2,0x447357);sphere(g,x-ox+.5,y-oy,4,1,1,1.3,0x5b8b65);}
 for(let y=83;y<241;y+=12)tree(659,y);for(let x=685;x<746;x+=10)tree(x,74);for(let x=666;x<803;x+=16)tree(x,251);
 // Parking layout follows the two rows shown along the south edge.
 for(let i=0;i<19;i++){const x=751+i*3;worldBox(categories.site,x,90,.13,.1,10,.04,palette.white);if(i%3!==0){worldBox(categories.site,x+1.2,88,0.8,1.8,4,1.3,[0xb8c8d0,0x658394,0x4b606d][i%3]);worldBox(categories.site,x+1.2,88,1.52,1.5,2,.25,0x274254);}}
 function roof(g,w,d,h){const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute([-w/2,-d/2,h,0,-d/2,h+1.3,w/2,-d/2,h,-w/2,d/2,h,0,d/2,h+1.3,w/2,d/2,h],3));geo.setIndex([0,1,4,0,4,3,1,2,5,1,5,4]);geo.computeVertexNormals();const mat=material(palette.roof);mat.side=T.DoubleSide;const m=new T.Mesh(geo,mat);m.castShadow=true;g.add(m);roofParts.push(m);for(let y=-d/2;y<=d/2;y+=2.5){const a=rod(g,[-w/2,y,h],[0,y,h+1.3],.045,0xadc0c9),b=rod(g,[0,y,h+1.3],[w/2,y,h],.045,0xadc0c9);roofParts.push(a,b);}}
 function tank(g,w,d,h,mixer=false){const r=Math.min(w,d)*.4;box(g,0,0,.14,w,d,.28,palette.slab);for(const x of [-r*.65,r*.65])for(const y of [-r*.65,r*.65])box(g,x,y,h*.15,.16,.16,h*.3,palette.steel);cyl(g,0,0,h*.53,r,h*.64,0xb2c4cb);sphere(g,0,0,h*.85,r,r,h*.12,0xc3cfd3);cyl(g,0,0,h*.96,r*.17,h*.09,palette.machine);rod(g,[r,0,h*.55],[r*1.24,0,h*.55],.09,palette.machine);rod(g,[r*1.24,0,h*.55],[r*1.24,0,.4],.08,palette.machine);if(mixer){box(g,0,0,h*.97,r*.65,r*.5,h*.12,palette.orange);box(g,-r*.85,0,h*.27,.2,r*1.8,.15,palette.steel);}}
 function skid(g,w,d,h){box(g,0,0,.18,w,d,.35,palette.steel);for(let i=0;i<3;i++){const x=(i-1)*w*.28;box(g,x,0,h*.45,w*.22,d*.7,h*.7,palette.machine);box(g,x,-d*.355,h*.57,w*.13,.025,h*.17,palette.dark);box(g,x,0,h*.84,w*.17,d*.6,.1,0xa9c3cd);}rod(g,[-w*.45,d*.3,h*.8],[w*.45,d*.3,h*.8],.1,palette.orange);}
 function rack(g,w,d,h){for(const x of [-w/2,w/2])for(let y=-d/2;y<=d/2+.1;y+=d/3)box(g,x,y,h/2,.12,.12,h,palette.steel);for(let z=.6;z<h;z+=1.5){box(g,0,0,z,w+.12,d,.16,palette.orange);for(let y=-d/2+1;y<d/2;y+=2.6)box(g,0,y,z+.55,w*.82,2,.9,0xa5aeaa);}}
 for(const item of data.items){const g=new T.Group();g.name=item.name;g.userData=labelSafe(item);g.position.set(item.x-ox,item.y-oy,item.z||0);g.rotation.z=(item.rotation||0)*Math.PI/180;categories[item.category]?.add(g);byId.set(item.id,g);if(item.upperFloor)upperParts.push(g);const {w,d,h}=item;
 switch(item.kind){
 case 'building':{
  box(g,0,0,.06,w,d,.18,0xd9dedc);for(const x of [-w/2,w/2]){box(g,x,0,.55,.18,d,1.1,palette.wall);if(!item.shelter)roofParts.push(box(g,x,0,h/2,.16,d,h,palette.wall));for(let y=-d/2;y<=d/2+.1;y+=d/Math.ceil(d/7))box(g,x,y,h/2,.3,.3,h,palette.steel);}for(const y of [-d/2,d/2]){box(g,0,y,.55,w,.18,1.1,palette.wall);if(!item.shelter)roofParts.push(box(g,0,y,h/2,w,.16,h,palette.wall));for(let x=-w/2;x<=w/2+.1;x+=w/Math.ceil(w/8))box(g,x,y,h/2,.3,.3,h,palette.steel);rod(g,[-w/2,y,h],[w/2,y,h],.09,palette.steel);}roof(g,w+.7,d+.7,h);for(const level of item.floors||[]){const slab=box(g,0,0,level-.15,w,d,.25,0xb5c6cd);upperParts.push(slab);for(const y of [-d/2,d/2]){upperParts.push(rod(g,[-w/2,y,level+1.1],[w/2,y,level+1.1],.04,palette.orange));}}break;}
 case 'tank':tank(g,w,d,h);break;
 case 'mixer':tank(g,w,d,h,true);break;
 case 'skid':skid(g,w,d,h);break;
 case 'rack':rack(g,w,d,h);break;
 case 'pallets':for(let x=-w/2+.6;x<w/2;x+=1.5)for(let y=-d/2+.6;y<d/2;y+=1.5){box(g,x,y,.12,1.25,1.25,.22,0x8c8c78);box(g,x,y,h/2+.2,1.15,1.15,h,0xb4c6bd);}break;
 case 'panel':box(g,0,0,h/2,w,d,h,0xaebdc6);for(let x=-w/2+.3;x<w/2;x+=.7){box(g,x,-d/2-.015,h*.65,.3,.025,.3,0x244b5d);box(g,x,-d/2-.03,h*.45,.06,.04,.06,palette.orange);}break;
 case 'dryer':case 'kiln':case 'oven':{
  box(g,0,0,.25,w,d,.5,palette.steel);box(g,0,0,h*.5,w*.94,d*.85,h*.68,item.kind==='kiln'?0xb1bfca:palette.machine);box(g,0,0,h*.87,w*.98,d*.92,.15,palette.light);for(let x=-w/2+1;x<w/2;x+=2.5){box(g,x,-d*.43,h*.5,.06,.04,h*.5,palette.steel);box(g,x,d*.43,h*.5,.06,.04,h*.5,palette.steel);}box(g,-w/2,0,h*.42,.45,d*.65,h*.4,palette.orange);box(g,w/2,0,h*.42,.45,d*.65,h*.4,palette.orange);for(let x=-w*.25;x<=w*.3;x+=w*.5)cyl(g,x,0,h*.97,.3,h*.25,palette.steel);break;}
 case 'chiller':box(g,0,0,h*.45,w,d,h*.8,palette.machine);for(let x=-w*.3;x<=w*.31;x+=w*.3){cyl(g,x,0,h*.88,Math.min(d*.35,w*.12),.16,palette.dark);for(let a=0;a<4;a++){const f=box(g,x,0,h*.98,Math.min(d*.58,w*.2),.14,.06,palette.light);f.rotation.z=a*Math.PI/4;}}for(let y=-d*.45;y<=d*.45;y+=.5)box(g,0,y,h*.3,w+.1,.04,.07,palette.light);break;
 case 'scrubber':cyl(g,0,0,h*.45,Math.min(w,d)*.34,h*.85,palette.machine);sphere(g,0,0,h*.88,w*.34,d*.34,h*.08,palette.light);cyl(g,0,0,h*.97,w*.12,h*.12,palette.steel);rod(g,[w*.36,0,h*.7],[w*.6,0,h*.7],w*.1,palette.orange);rod(g,[w*.6,0,h*.7],[w*.6,0,.3],w*.1,palette.orange);break;
 case 'horizontalTank':box(g,0,0,.2,w,d,.4,palette.steel);cyl(g,0,0,h*.54,d*.35,w*.85,palette.light,'x');for(const x of [-w*.43,w*.43])sphere(g,x,0,h*.54,d*.2,d*.35,d*.35,palette.light);for(const x of [-w*.3,w*.3])box(g,x,0,h*.2,.35,d*.65,h*.4,palette.steel);break;
 case 'basin':box(g,0,0,.1,w,d,.2,palette.slab);for(const x of [-w/2,w/2])box(g,x,0,h*.35,.35,d,h*.7,palette.slab);for(const y of [-d/2,d/2])box(g,0,y,h*.35,w,.35,h*.7,palette.slab);box(g,0,0,.45,w-.5,d-.5,.08,palette.water);break;
 case 'packing':skid(g,w*.7,d*.7,h);box(g,0,-d*.4,.8,w,d*.2,.2,palette.orange);break;
 case 'robot':box(g,0,0,.2,w,d,.4,palette.steel);cyl(g,0,0,.5,.5,1,palette.dark);rod(g,[0,0,.8],[.7,0,h*.7],.22,palette.orange);rod(g,[.7,0,h*.7],[w*.3,0,h*.65],.18,palette.orange);sphere(g,.7,0,h*.7,.27,.27,.27,palette.dark);box(g,w*.3,0,h*.58,.6,.6,.25,palette.dark);break;
 case 'canopy':for(let x=-w/2;x<=w/2;x+=w/Math.ceil(w/7))for(const y of [-d/2+.2,d/2-.2])box(g,x,y,h/2,.18,.18,h,palette.steel);roof(g,w,d,h);break;
 }
 }
 // Elevated service bridge at the west-to-process corridor shown in CAD.
 for(const z of [4.5,4.8,5.1])rod(categories.utilities,[678-ox,153-oy,z],[706-ox,153-oy,z],.11,z===4.8?palette.orange:palette.light);
 for(const x of [679,687,696,704]){worldBox(categories.utilities,x,153,2.3,.22,.22,4.6,palette.steel);}
 root.updateMatrixWorld(true);
 return {root,categories,byId,roofParts,upperParts};
}
