'use strict';
const assert=require('node:assert/strict');
const path=require('node:path');

module.exports=async function dashboardThemes({pageFor,open,check,output,report}){
 for(const width of [1440,390])for(const variant of ['empty','full'])for(const theme of ['light','dark'])await check(`dashboard ${variant} ${theme} contrast at ${width}`,async()=>{
  const {context,page}=await pageFor(variant,width);
  try{
   await open(page,'dashboard');
   await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;},theme);
   await page.evaluate(async()=>{await document.fonts.ready;});
   const data=await page.locator('[data-company-dashboard]').evaluate(root=>{
    const rgba=value=>{const channels=value.match(/[\d.]+/g)?.map(Number)||[0,0,0,0];return [...channels.slice(0,3),channels[3]??1];};
    const over=(front,back)=>{const alpha=front[3]+back[3]*(1-front[3]);return alpha?[...front.slice(0,3).map((c,i)=>(c*front[3]+back[i]*back[3]*(1-front[3]))/alpha),alpha]:[0,0,0,0];};
    const background=node=>{let color=[0,0,0,0];for(let current=node;current&&color[3]<.999;current=current.parentElement)color=over(color,rgba(getComputedStyle(current).backgroundColor));return over(color,[255,255,255,1]).slice(0,3);};
    const luminance=channels=>channels.map(c=>{c/=255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;}).reduce((sum,c,i)=>sum+c*[.2126,.7152,.0722][i],0);
    const ratio=(a,b)=>(Math.max(luminance(a),luminance(b))+.05)/(Math.min(luminance(a),luminance(b))+.05);
    const text=[...root.querySelectorAll('*')].filter(node=>[...node.childNodes].some(child=>child.nodeType===Node.TEXT_NODE&&child.textContent.trim())).filter(node=>{const box=node.getBoundingClientRect();return box.width>0&&box.height>0&&getComputedStyle(node).visibility!=='hidden';}).map(node=>{const style=getComputedStyle(node);return {text:node.textContent.trim().slice(0,100),color:style.color,background:background(node),contrast:ratio(rgba(style.color).slice(0,3),background(node))};});
    return {text,cards:[...root.querySelectorAll('.company-dashboard__card')].map(card=>getComputedStyle(card).backgroundColor),overflow:document.documentElement.scrollWidth>innerWidth+2};
   });
   assert.equal(data.overflow,false,'Dashboard fits the viewport');
   assert(data.cards.length>=5,'Summary and data cards are present');
   assert(data.cards.every(color=>color===(theme==='dark'?'rgb(21, 40, 63)':'rgb(255, 255, 255)')),'Every card follows the selected theme');
   assert(data.text.length>10,'Contrast checks cover real dashboard content');
   const unreadable=data.text.filter(item=>item.contrast<4.5);
   assert.deepEqual(unreadable,[],'Every dashboard text label retains at least4.5:1 contrast');
   (report.dashboardThemes||=[]).push({width,variant,theme,minimumContrast:Math.min(...data.text.map(item=>item.contrast)),texts:data.text.length});
   const screenshot=path.join(output,`dashboard-${variant}-${theme}-${width}.png`);await page.screenshot({path:screenshot,fullPage:true});report.screenshots.push(screenshot);
  }finally{await context.close();}
 });
};
