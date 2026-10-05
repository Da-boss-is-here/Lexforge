/* Regenerates assets/demo.gif and assets/demo.mp4 from the real app, using the "Try with sample
   words" flow and deterministic input (Math.random is pinned while question cards are built).
   Not part of the app or the test suite: needs Playwright and ffmpeg, neither of which the repo
   depends on.
     npm i --no-save playwright && npx playwright install chromium   # run outside the repo, or delete node_modules after
     node scripts/capture-demo.js
   CAPTIONS=0 omits the caption bar. Synthetic data only; nothing leaves the machine. */
const {chromium}=require('playwright'); const fs=require('fs'); const os=require('os'); const path=require('path'); const {execFileSync}=require('child_process');
const ROOT=path.join(__dirname,'..'); const FRAMES=fs.mkdtempSync(path.join(os.tmpdir(),'lexforge-demo-'));
const URL='file://'+path.join(ROOT,'index.html');
const CAPTIONS = process.env.CAPTIONS!=='0';
const W=780,H=760;
(async()=>{
  const b=await chromium.launch(); const ctx=await b.newContext({viewport:{width:W,height:H},deviceScaleFactor:1,reducedMotion:'reduce'}); const p=await ctx.newPage();
  await p.addInitScript(()=>{ const o=Math.random; Math.random=()=> (window.__rv!=null?window.__rv:o()); });
  await p.goto(URL);
  await p.addStyleTag({content:`#toastRoot{display:none!important} *{caret-color:transparent}
    #cap{position:fixed;top:0;left:0;right:0;height:56px;z-index:99999;background:#1D1D1F;color:#fff;display:flex;align-items:center;gap:12px;padding:0 24px;font:600 20px -apple-system,BlinkMacSystemFont,"SF Pro Text",system-ui,sans-serif}
    #cap b{background:#fff;color:#1D1D1F;border-radius:999px;padding:2px 11px;font-size:16px}
    body{padding-top:${CAPTIONS?56:0}px} .topbar{top:${CAPTIONS?56:0}px!important}
    .ring{outline:4px solid #FF9F0A!important;outline-offset:3px;border-radius:12px}`});
  const frames=[]; let n=0;
  const cap=async(num,text)=>{ if(!CAPTIONS) return; await p.evaluate(([num,text])=>{let c=document.getElementById('cap');if(!c){c=document.createElement('div');c.id='cap';document.body.appendChild(c)}c.innerHTML=(num?'<b>'+num+'</b>':'')+'<span>'+text+'</span>'},[num,text]); };
  const shot=async(dur,scroll)=>{ await p.waitForTimeout(250); if(scroll) await p.evaluate(s=>{ if(s==='top') window.scrollTo(0,0); else if(s==='end') window.scrollTo(0,document.body.scrollHeight); else window.scrollTo(0,s);},scroll); await p.waitForTimeout(100);
    const f=path.join(FRAMES,String(++n).padStart(3,'0')+'.png'); await p.screenshot({path:f}); frames.push({f,dur}); };
  const ring=async s=>{ await p.locator(s).first().evaluate(e=>e.classList.add('ring')); };
  const unring=async()=>{ await p.evaluate(()=>document.querySelectorAll('.ring').forEach(e=>e.classList.remove('ring'))); };
  const type=async(sel,text,steps)=>{ for(let i=0;i<steps.length;i++){ await p.fill(sel,text.slice(0,Math.round(text.length*steps[i].pct))); await shot(steps[i].dur,'top'); } };

  await p.evaluate(()=>{window.__rv=0.05});
  await p.click('#trySampleBtn'); await p.waitForSelector('.mcq-options button');
  const right='.mcq-options button:has-text("to make something harmful")';
  // 1 recognition
  await cap('1','Recognition: pick the meaning'); await ring(right); await shot(1.3,'top');
  await unring(); await p.click(right);
  await cap('✅','Recognized. This is the easy part.'); await ring('#easyBtn'); await shot(1.0,'end');
  await unring(); await p.evaluate(()=>{window.__rv=0.05}); await p.click('#easyBtn');
  // 2 now use it
  await cap('2','Now use it: write a sentence with the word');
  await shot(.9,'top');
  const wrong='Vaccination campaigns mitigate against the impact of outbreaks.';
  await type('#answerInput',wrong,[{pct:.35,dur:.35},{pct:.7,dur:.35},{pct:1,dur:.6}]);
  await p.click('#submitBtn');
  // self-check
  await cap('','Self-check against the word’s notes. No AI grading.'); await ring('#selfNoBtn'); await shot(1.7,'end');
  await unring(); await p.click('#selfNoBtn');
  await p.click('.error-cats button[data-c="Collocation"]');
  await cap('3','Diagnose it: Collocation (“mitigate against”)'); await ring('#continueBtn'); await shot(1.7,'end');
  await unring(); await p.evaluate(()=>{window.__rv=0.19}); await p.click('#continueBtn');
  // 4 retry
  await cap('4','Try again with the fix');
  await p.waitForSelector('#answerInput');
  const right2='Vaccination campaigns mitigate the impact of outbreaks.';
  await type('#answerInput',right2,[{pct:.5,dur:.4},{pct:1,dur:.6}]);
  await p.click('#submitBtn'); await cap('','Compare, then judge your own sentence'); await ring('#selfYesBtn'); await shot(1.1,'end');
  await unring(); await p.click('#selfYesBtn');
  await cap('✅','Corrected sentence accepted'); await shot(1.1,'end');
  await p.click('#easyBtn'); await p.waitForSelector('#doneBtn'); await p.click('#doneBtn');
  await p.waitForSelector('text=Skill Dimension Coverage');
  await cap('📈','Progress is tracked per skill. Recognition alone never counts as mastery.');
  const y=await p.evaluate(()=>{const h=[...document.querySelectorAll('h2')].find(e=>e.textContent.includes('Skill Dimension'));return Math.max(0,h.getBoundingClientRect().top+window.scrollY-200)});
  await shot(2.3,y);
  // The final frame's duration is shortened and the file repeated: ffmpeg's concat demuxer drops the last entry's duration otherwise.
  const last=frames[frames.length-1];
  const list=frames.map((f,i)=>`file '${f.f}'\nduration ${i===frames.length-1?1.2:f.dur}`).join('\n')+`\nfile '${last.f}'\n`;
  fs.writeFileSync(path.join(FRAMES,'list.txt'),list);
  const ff=(args)=>execFileSync('ffmpeg',['-loglevel','error','-y','-f','concat','-safe','0','-i',path.join(FRAMES,'list.txt'),...args],{stdio:'inherit'});
  fs.mkdirSync(path.join(ROOT,'assets'),{recursive:true});
  ff(['-vf','fps=10,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle','-loop','0',path.join(ROOT,'assets/demo.gif')]);
  ff(['-r','30','-c:v','libx264','-crf','20','-pix_fmt','yuv420p','-movflags','+faststart',path.join(ROOT,'assets/demo.mp4')]);
  fs.rmSync(FRAMES,{recursive:true,force:true});
  console.log('frames',n);
  await b.close();
})();
