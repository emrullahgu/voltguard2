const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

function core(file,marker,name){const text=fs.readFileSync(path.join(__dirname,'..','src','tools',file),'utf8');const re=new RegExp('<script data-vg-core="'+marker+'">([\\s\\S]*?)<\\/script>');const m=text.match(re);assert.ok(m);const context=vm.createContext({});vm.runInContext(m[1],context);return context[name];}
const P=core('Fazor_Simetrik_Bilesenler.html','phase','VGPhaseCore');
const D=core('DC_Guc_Akisi.html','dc','VGDCCore');
const near=(a,b,tolerance=1e-10)=>assert.ok(Math.abs(a-b)<=tolerance,`${a} != ${b}`);
const znear=(a,b,tolerance=1e-10)=>{near(a.re,b.re,tolerance);near(a.im,b.im,tolerance);};
const model=()=>D.parse('B1;0\nB2;-50\nB3;-50','B1;B2;0,1;100\nB2;B3;0,1;100\nB1;B3;0,2;100','100','B1');

test('ElectricPy primary source example: 167 V balanced positive sequence',()=>{
  // conversions.py abc_to_seq example at 7321174eaf32323a41e631f2896148bf8b76609c.
  const abc=[P.polar(167,0),P.polar(167,-120),P.polar(167,-240)];
  const sequence=P.abcToSeq(abc);znear(sequence[0],{re:0,im:0});znear(sequence[1],{re:167,im:0});znear(sequence[2],{re:0,im:0});
  const rebuilt=P.seqToAbc(sequence);abc.forEach((z,i)=>znear(rebuilt[i],z));
});

test('Sequence transform matches independently evaluated ElectricPy NumPy reference',()=>{
  // Actual ElectricPy functions extracted and run against constants.Aabc; see research fixture.
  const result=P.analyze('abc',[P.polar(230,0),P.polar(215,-116),P.polar(240,123)]);
  const expected=[{re:1.6789450122472687,im:2.6800721175269615},{re:228.0491197156533,im:9.186090451097758},{re:0.2719352720994195,im:-11.866162568624738}];
  result.sequence.forEach((z,i)=>znear(z,expected[i],1e-9));assert.ok(result.error<1e-10);
});

test('Pure zero and negative sequence preserve ordering and round trip',()=>{
  const zero=P.analyze('012',[P.polar(7,30),P.polar(0,0),P.polar(0,0)]);
  zero.phases.forEach(z=>znear(z,P.polar(7,30)));assert.equal(zero.negativeRatio,null);
  const negative=P.analyze('012',[P.polar(0,0),P.polar(0,0),P.polar(50,0)]);
  znear(negative.phases[0],P.polar(50,0));znear(negative.phases[1],P.polar(50,120));znear(negative.phases[2],P.polar(50,-120));
});

test('Transform round trip covers arbitrary complex inputs, no phase order drift',()=>{
  for(let i=1;i<=120;i++){const abc=[{re:Math.sin(i)*300,im:Math.cos(i*7)*400},{re:i-60,im:Math.sin(i*3)*100},{re:-i*.75,im:i*2}];const rebuilt=P.seqToAbc(P.abcToSeq(abc));abc.forEach((z,j)=>znear(rebuilt[j],z,1e-9));}
});

test('Phasor input validation accepts Turkish decimals, rejects invalid and overflow',()=>{
  near(P.numeric('230,5'),230.5);near(P.numeric(' -1.2e2 '),-120);znear(P.polar(3,720),{re:3,im:0});
  for(const v of ['', 'abc', 'NaN', 'Infinity', '1,2,3', '1 000', '1e999'])assert.throws(()=>P.numeric(v));
  assert.throws(()=>P.polar(-1,0));assert.throws(()=>P.polar(1,Infinity));assert.throws(()=>P.abcToSeq([{re:1,im:0}]));assert.throws(()=>P.analyze('unknown',[{re:1,im:0},{re:1,im:0},{re:1,im:0}]));
  assert.throws(()=>P.seqToAbc([{re:1e308,im:0},{re:1e308,im:0},{re:1e308,im:0}]));
});

test('Three-bus DC flow matches independent NumPy solution of PyPSA linear equations',()=>{
  // B=[[15,-10,-5],[-10,20,-10],[-5,-10,15]], Sbase=100 MVA.
  // Reduced matrix [[20,-10],[-10,15]] theta=[-.5,-.5].
  const r=D.solve(model());near(r.slackP,100);near(r.buses[0].theta,0);near(r.buses[1].theta,-.0625);near(r.buses[2].theta,-.075);
  [62.5,12.5,37.5].forEach((mw,i)=>near(r.lines[i].mw,mw));assert.ok(r.maxResidual<1e-12);
  near(r.buses.reduce((sum,b)=>sum+b.p,0),0);near(r.lines[0].mw-r.lines[1].mw,50);near(r.lines[1].mw+r.lines[2].mw,50);
});

test('Reversing a branch changes its flow sign while preserving bus angles',()=>{
  const m=model(),r=D.solve(m);m.lines[0]={...m.lines[0],from:'B2',to:'B1'};const reversed=D.solve(m);
  near(reversed.lines[0].mw,-r.lines[0].mw);r.buses.forEach((b,i)=>near(reversed.buses[i].theta,b.theta));
});

test('Parallel lines and arbitrary non-first slack are solved with KCL',()=>{
  const r=D.solve(D.parse('A;-80\nB;999','A;B;0,1;60\nA;B;0,1;','100','B'));
  near(r.slackP,80);near(r.buses[1].theta,0);near(r.buses[0].theta,-.04);near(r.lines[0].mw,-40);near(r.lines[1].mw,-40);near(r.lines[0].loading,100*40/60);assert.equal(r.lines[1].loading,null);
});

test('Injection sign supports power export and flags entered branch overload',()=>{
  const r=D.solve(D.parse('S;0\nPV;150','S;PV;0,1;100','100','S'));
  near(r.slackP,-150);near(r.lines[0].mw,-150);near(r.lines[0].loading,150);near(r.buses[1].theta,.15);
});

test('DC parser accepts blank lines/comments and rejects ambiguous columns',()=>{
  const r=D.solve(D.parse('# Bara girdileri\nA;0\n\nB;-12,5','A;B;0,2;','50','A'));near(r.slackP,12.5);near(r.buses[1].theta,-.05);
  assert.throws(()=>D.parse('A;0\nB;-1,2;5','A;B;0,2;','100','A'));
  assert.throws(()=>D.parse('A;0\nB;-10','A,B,0.1,100','100','A'));
  assert.throws(()=>D.parse('A;0\nB;NaN','A;B;0,2;','100','A'));
});

test('DC solve rejects duplicate, unknown, self-loop, zero reactance and disconnected buses',()=>{
  const bad=[];let m=model();m.buses[2].id='B2';bad.push(m);m=model();m.lines[0].to='X';bad.push(m);m=model();m.lines[0].to=m.lines[0].from;bad.push(m);m=model();m.lines[0].x=0;bad.push(m);m=model();m.lines[0].limit=-1;bad.push(m);m=model();m.base=0;bad.push(m);m=model();m.slack='X';bad.push(m);m=model();m.lines=m.lines.slice(0,1);bad.push(m);m=model();m.buses[1].p=Infinity;bad.push(m);m=model();m.lines[0].x=Number.MIN_VALUE;bad.push(m);
  bad.forEach(m=>assert.throws(()=>D.solve(m)));
});

test('Poorly conditioned grid is rejected instead of producing plausible bogus numbers',()=>{
  const m=D.parse('A;0\nB;-1\nC;-1','A;B;1e-15;100\nB;C;1e15;100','100','A');assert.throws(()=>D.solve(m),/koşullu|tekil/);
});

test('Reports expose static result containers and invalid-input guard',()=>{
  for(const file of ['Fazor_Simetrik_Bilesenler.html','DC_Guc_Akisi.html']){const s=fs.readFileSync(path.join(__dirname,'..','src','tools',file),'utf8');assert.match(s,/id="printReport"/);assert.match(s,/dataset\.vgInvalid='true'/);assert.match(s,/VoltGuardExportAdapter=\{getState:/);assert.match(s,/setState:state=>/);assert.match(s,/flush:recalc,buildReport:recalc/);assert.match(s,/@media print/);}
  assert.match(fs.readFileSync(path.join(__dirname,'..','src','vendor','power-electricpy-LICENSE.txt'),'utf8'),/Copyright \(c\) 2019 Joe Stanley/);
  assert.match(fs.readFileSync(path.join(__dirname,'..','src','vendor','power-pypsa-LICENSE.txt'),'utf8'),/MIT License/);
});

test('Versioned phasor state preserves exact decimal strings and rejects malformed projects',()=>{
  const state={version:1,fields:{phaseMode:'abc',phaseUnit:'V',mag0:'230,5000',angle0:'0',mag1:'215,125',angle1:'-116',mag2:'240',angle2:'123'}};
  const fields=P.validateState(state);assert.equal(fields.mag0,'230,5000');assert.equal(fields.mag1,'215,125');
  for(const change of [s=>s.version=2,s=>s.fields.mag0=230,s=>delete s.fields.angle2,s=>s.fields.extra='x',s=>s.fields.mag0='-1',s=>s.fields.phaseMode='invalid',s=>s.fields.phaseUnit='kV',s=>s.fields.angle1='NaN']){const bad=JSON.parse(JSON.stringify(state));change(bad);assert.throws(()=>P.validateState(bad));}
  assert.throws(()=>P.validateState(null));assert.throws(()=>P.validateState({version:1,fields:[]}));
});

test('Versioned DC state preserves textarea content and validates complete prospective grid',()=>{
  const state={version:1,fields:{dcBase:'100,000',dcSlack:'B1',dcBuses:'# yükler\nB1;0\nB2;-50,125\nB3;-50',dcLines:'B1;B2;0,1000;100\nB2;B3;0,1;100\nB1;B3;0,2;'}};
  const fields=D.validateState(state);assert.equal(fields.dcBase,'100,000');assert.equal(fields.dcLines,state.fields.dcLines);assert.equal(fields.dcBuses,state.fields.dcBuses);
  for(const change of [s=>s.version=0,s=>s.fields.dcBase=100,s=>delete s.fields.dcLines,s=>s.fields.extra='x',s=>s.fields.dcBase='0',s=>s.fields.dcSlack='unknown',s=>s.fields.dcLines='B1;B2;0,1;100',s=>s.fields.dcLines='B1;B2;0;100\nB2;B3;0,1;100']){const bad=JSON.parse(JSON.stringify(state));change(bad);assert.throws(()=>D.validateState(bad));}
  assert.throws(()=>D.validateState({version:1,fields:null}));
});
