import * as THREE from 'three'

type Edition = { title:string, author:string, color:string, ink:string, width:number, height:number }
const e=(title:string,author:string,color:string,ink:string,width:number,height:number):Edition =>
  ({title,author,color,ink,width,height})

// Recognizable volumes follow the reference. Unreadable volumes have plain bindings.
const upperEditions = [
  e('Beastie Boys Book','','#e8e3d5','#262524',4.4,.98),
  e('DILLA TIME','DAN CHARNAS','#e1d8be','#354d64',3.1,.94),
  e('JODOROWSKY','','#a84c3d','#f5d78d',2.7,.94),
  e('THE SIMPSONS','JOHN ORTVED','#f1c654','#32291e',2.1,.95),
  e('The Storyteller','Dave Grohl','#d9d5c8','#292c29',2.8,.96),
  e('D U C K S','KATE BEATON','#313944','#e1b67c',4.3,1),
  e('J & K','','#bb6c75','#fae6b7',2.8,.99),
  e('','','#deb650','#332f27',1.2,.97), e('','','#e9dfb9','#38332e',1.3,.96),
  e('MY BEGGING CHARTS','KEILER ROBERTS','#39445e','#e1dacc',2.1,.93),
  e('SHARING A HOUSE','NEVER-ENDING MAN','#393733','#e2d7c1',2.2,.94),
  e('Talk to My Back','Yamada Murasaki','#74819c','#282839',3.2,.94),
  e('H Y P E R I O N','DAN SIMMONS','#be814e','#28201a',4.2,.92),
  e('MASTERS OF DOOM','DAVID KUSHNER','#464a3e','#f1c75e',3.2,.94),
  e('Pilgrim at Tinker Creek','Annie Dillard','#302f2b','#e7dfc9',2.6,.92),
]

const middleEditions = [
  e('SYSTEM DESIGN INTERVIEW','Alex Xu','#30324b','#efe8d9',2.5,.81),
  e('C PROGRAMMING','K. N. KING · A Modern Approach','#e8dec9','#262624',3.8,.84),
  ...['Up & Going','Scope & Closures','this & Object Prototypes','Types & Grammar','Async & Performance','ES6 & Beyond'].map(
    (title,i)=>e('YOU DON’T KNOW JAVASCRIPT',title,'#efc44c','#252421',[1.1,.95,1.1,1.15,1.65,1.6][i],.81)),
  e('DATA STRUCTURES in C','Adam Drozdek','#485366','#ead4a1',3.3,.86),
  e('Make: Electronics','Charles Platt','#eee9dc','#1679a2',2.55,.91),
  e('PASTEL','PALETTE Nº 5','#a29782','#f4ebdb',2.9,.91),
  e('GOLD & SILVER','Nº 3 · METALLIC GRAPHICS','#c3a14d','#6b5025',2.9,.91),
  e('NEON','Nº 4 · FLUORESCENT GRAPHICS','#d74470','#f9d2de',3.3,.92),
  e('MULTICOLOUR','PALETTE Nº 2','#e8dfcd','#884d48',3.05,.92),
  e('GREEN FIRST!','Gingko Press','#c7bdb4','#f8f1e4',3.1,.85),
  e('THE COMPLETE JAPANESE JOINERY','Hartley & Marks','#272524','#f2ecde',3.95,.88),
  ...['Issue 7, 2020','Issue 5, 2018','Issue 8, 2020','Issue 10, 2022'].map(
    issue=>e('Record Culture Magazine',issue,'#eee9de','#272523',1.52,.85)),
  e('CORY ARCANGEL','','#355375','#eee5d3',1.55,.88),
  e('SHUNA’S JOURNEY','MIYAZAKI','#ead7aa','#a74832',2.6,.85),
  e('Measure and Construction of the Japanese House','Engel','#ece4d2','#312d27',2.55,.99),
  e('COMPUTER GRAPHICS','DOVER','#292827','#ddccb1',1.4,1),
  e('CRAWL SPACE','JESSE JACOBS','#323539','#f0b654',1.95,.89),
  e('','','#e0a04b','#3b3030',.65,.77),
  e('The Wind-Up Bird Chronicle','HARUKI MURAKAMI','#dcad7d','#332a23',3.95,.88),
]
const cookbookShelf = [
  e('','','#29363b','#ddd8c4',2,.87),e('','','#d1cabb','#333333',1.2,.94),
  e('','','#975a5a','#333333',1.3,.97),e('JULIA CHILD','','#c9bc99','#70463b',3,1),
]

const cambridge = (title:string,width:number) => e(title,'Nietzsche','#174c4b','#e7debf',width,.86)
const bottomEditions = [
  e('FORWARD THE FOUNDATION','ISAAC ASIMOV','#e2d5b7','#392c35',3.2,.89),
  e('YOGA','','#506994','#e6deca',2.1,.86),
  e('On the Nature of Things','Lucretius','#35594b','#e5dcc3',1.5,.84),
  e('Aristotle’s Metaphysics','Joe Sachs','#c4bec6','#994750',2.9,.98),
  e('Aristotle’s Physics','Sachs','#933443','#f3e7cd',2.3,.85),
  e('Aristotle','Wheelwright','#ddcfb6','#352c23',2.6,.74),
  e('','','#af997d','#332d25',1.2,.74),
  e('On Certainty','Wittgenstein','#debf8f','#312b24',.94,.74),
  e('The Visible and the Invisible','Merleau-Ponty','#dddbcb','#446b84',2.2,.86),
  cambridge('Thus Spoke Zarathustra',2.35),
  cambridge('The Gay Science',2.45),
  cambridge('Untimely Meditations',2.65),
  e('Twilight of the Idols / The Antichrist','Nietzsche','#272825','#e1d3ac',1.55,.73),
  e('The Antichrist','Friedrich Nietzsche','#867d68','#f5e8ce',1.05,.73),
  e('Beyond Good and Evil','Nietzsche','#282825','#d8cbb6',2.15,.73),
  e('BEYOND GOOD AND EVIL','Friedrich Nietzsche','#443a2e','#c6a470',1.75,.67),
  e('Why I Am So Wise','Friedrich Nietzsche','#b67e62','#372d29',1,.68),
  e('The Fundamental Wisdom of the Middle Way','Garfield','#262533','#e3daca',2.35,.78),
  e('BRIAN ENO   VISUAL MUSIC','SCOATES','#426379','#ebe4d1',4.5,.74),
  e('A Place in Space','Gary Snyder','#3f4c49','#e5dcc5',2.7,.82),
  e('The Problems of Philosophy','Russell','#ad8c80','#77362e',1.4,.85),
  e('Philosophy Before Socrates','McKirahan','#d2c6ad','#463e35',3.25,.93),
  e('PHAEDO','PLATO','#cd813b','#40291d',1.25,.88),
  e('SYMPOSIUM','PLATO','#b1a6a4','#453e48',2.5,.94),
  e('Great Dialogues','','#333849','#ecdfb5',3.5,.73),
  e('3D SWEETIES','JULIAN GLANDER','#ce8585','#2d2b3b',3.6,.88),
  e('SEVEN ARROWS','HYEMEYOHSTS STORM','#e4d7bb','#352e2a',5.15,1),
]
export const shelfEditions = [...upperEditions,...middleEditions,...cookbookShelf,...bottomEditions]
const idsFor = (row:Edition[]) => row.map(book=>shelfEditions.indexOf(book))
export const middleShelfIds = idsFor(middleEditions)
export const cookbookShelfIds = idsFor(cookbookShelf)
export const bottomShelfIds = idsFor(bottomEditions)
export const tapeNames=['THE B-52’S','MONSTER SQUAD','SIDE A','VOL. 02','HALLOWEEN','TWIN PEAKS','LIVE','MIX 90','B · SIDE','STEREO','GARTH BROOKS','PHIL COLLINS']

export const printRows = Math.ceil((shelfEditions.length + tapeNames.length)/2)

export function makeShelfPrint() {
  const w=768,h=80
  const canvas=document.createElement('canvas')
  canvas.width=2*w
  canvas.height=printRows*h
  const ctx=canvas.getContext('2d')!
  const tapes=tapeNames.map((title,i)=>e(title,'', ['#d7ccad','#35332d','#985246','#c1a276'][i%4],i%4===1?'#e5ce96':'#2f2924',1,1))
  for (const [i,book] of [...shelfEditions,...tapes].entries()) {
    ctx.save()
    ctx.translate(i%2*w,Math.floor(i/2)*h)
    ctx.fillStyle=book.color
    ctx.fillRect(0,0,w,h)
    ctx.fillStyle=book.ink
    const cassette=i>=shelfEditions.length
    if (book.title === 'YOU DON’T KNOW JAVASCRIPT') {
      ctx.fillStyle='#ece8de'
      ctx.fillRect(0,0,174,h)
      ctx.fillStyle='#252421'
      ctx.fillRect(174,0,273,h)
      ctx.textBaseline='middle'
      ctx.font='bold 22px Arial'
      ctx.fillText('KYLE SIMPSON',20,40,144)
      ctx.fillStyle='#f4d461'
      ctx.fillText(book.title,184,40,252)
      ctx.fillStyle='#282720'
      ctx.font='bold 28px Arial'
      ctx.fillText(book.author,461,40,282)
      ctx.restore()
      continue
    }
    const bold=i===0||i===5||i===13||book.title==='THE COMPLETE JAPANESE JOINERY'
    ctx.textBaseline='middle'
    ctx.font=bold ? 'bold 56px Arial' : i%3===0 ? 'italic 44px Georgia' : i%3===1 ? '43px Georgia' : 'bold 39px Arial'
    if (book.color === '#174c4b') ctx.font='italic 43px Georgia'
    ctx.fillText(book.title,30,41,book.author ? 456 : w-80)
    if (book.author) {
      ctx.font='bold 21px Arial'
      ctx.textAlign='right'
      ctx.fillText(book.author,w-30,42,218)
    }
    if (cassette) {
      ctx.fillRect(17,12,9,57)
      ctx.font='17px monospace'
      ctx.textAlign='right'
      ctx.fillText('STEREO   •   1⅞ IPS',w-22,43,190)
    } else if (i%4===2 || (!book.title && i%2===0)) {
      ctx.fillRect(w-24,9,2,62)
      ctx.fillRect(w-30,9,1,62)
    }
    ctx.restore()
  }
  const texture=new THREE.CanvasTexture(canvas)
  texture.colorSpace=THREE.SRGBColorSpace
  texture.anisotropy=4
  return texture
}
