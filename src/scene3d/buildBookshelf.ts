import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import osbImage from '../assets/room/bookshelf-osb.jpg'
import trimImage from '../assets/room/bookshelf-trim.jpg'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { buildWoodCase } from './buildWoodCase'
import { middleShelfIds, cookbookShelfIds, bottomShelfIds, printRows, shelfEditions, makeShelfPrint, tapeNames } from './shelfPrint'

interface Resources {
  tex<T extends THREE.Texture>(texture: T): T
  geo<T extends THREE.BufferGeometry>(g: T): T
  mat<T extends THREE.Material>(m: T): T
}

export function buildBookshelf(t: Resources, loadTexture: (url: string) => THREE.Texture) {
  const group = new THREE.Group()
  group.name = 'handbuilt-osb-bookcase'
  const batches = new Map<THREE.Material, THREE.BufferGeometry[]>()
  const material = (color: number, map?: THREE.Texture) =>
    t.mat(new THREE.MeshStandardMaterial({ color, map: map ?? null, roughness: .82 }))
  const wood = (url: string) => {
    const map = loadTexture(url)
    map.wrapS = map.wrapT = THREE.RepeatWrapping
    return material(0xffffff, map)
  }
  const chipboard = wood(osbImage)
  const hardwood = wood(trimImage)
  const paper = material(0xe5dac4)
  const dark = material(0x282321)
  const printing = material(0xffffff, t.tex(makeShelfPrint()))
  const foil = t.mat(new THREE.MeshStandardMaterial({ map: printing.map, roughness: .34, metalness: .52 }))
  const cloth = t.mat(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .86 }))
  chipboard.bumpMap = chipboard.map
  chipboard.bumpScale = .026
  hardwood.bumpMap = hardwood.map
  hardwood.bumpScale = .009

  function add(geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) {
    geo.translate(x,y,z)
    if (!batches.has(mat)) batches.set(mat, [])
    if (geo.index) {
      const flat = geo.toNonIndexed()
      geo.dispose()
      geo = flat
    }
    batches.get(mat)!.push(geo)
  }
  // Board UVs are in centimetres. Strands retain their scale on narrow edges
  // and the grain follows the length of each individual hardwood rail.
  function board(x: number, y: number, z: number, w: number, h: number, d: number, mat: THREE.Material) {
    const geo = mat === hardwood
      ? new RoundedBoxGeometry(w,h,d,2,.065)
      : new THREE.BoxGeometry(w,h,d)
    if (mat === chipboard || mat === hardwood) {
      const {position, normal, uv} = geo.attributes
      for (let i=0; i<position.count; i++) {
        const px=position.getX(i), py=position.getY(i), pz=position.getZ(i)
        const side=Math.abs(normal.getX(i))>.5, top=Math.abs(normal.getY(i))>.5
        let u=side ? pz : px, v=top ? pz : py
        if (mat === hardwood && w>h && !side) [u,v]=[v,u]
        uv.setXY(i,u/(mat === hardwood ? 4 : 26)+x*.13, v/(mat === hardwood ? 62 : 45)+y*.09)
      }
    }
    add(geo,mat,x,y,z)
  }
  function coloredBoard(x:number,y:number,z:number,w:number,h:number,d:number,color:string) {
    const geo = new RoundedBoxGeometry(w,h,d,2,.045)
    const rgb = new THREE.Color(color)
    const colors = new Float32Array(geo.attributes.position.count*3)
    for (let i=0;i<colors.length;i+=3) rgb.toArray(colors,i)
    geo.setAttribute('color', new THREE.BufferAttribute(colors,3))
    add(geo,cloth,x,y,z)
  }

  // Print directly onto the rounded binding. End faces sample the blank margin.
  function binding(x:number,y:number,z:number,w:number,h:number,d:number,id:number,horizontal=false) {
    const geo = new RoundedBoxGeometry(w,h,d,3,Math.min(.24,d*.45,w*.22))
    const {position,uv} = geo.attributes
    for(let i=0;i<uv.count;i++) {
      const u=position.getX(i)/w+.5, v=position.getY(i)/h+.5
      const along=horizontal ? u : 1-v
      const across=horizontal ? v : u
      uv.setXY(i, (id%2+.012+along*.976)/2, 1-(Math.floor(id/2)+.025+(1-across)*.95)/printRows)
    }
    add(geo,shelfEditions[id]?.title === 'GOLD & SILVER' ? foil : printing,x,y,z)
  }

  const width=53, depth=27, thick=1.8, top=143
  for(const side of [-1,1]) {
    const x=side*(width-thick)/2
    board(x,(top+2)/2,0,thick,top-2,depth,chipboard)
    board(x,(top+2)/2,14.15,thick,top-2,1.3,hardwood)
    for(const z of [-9,9]) board(x*.92,1,z,2.5,2,3,dark)
  }
  const levels=[3,34,58,71,105,top]
  for(const y of levels) {
    board(0,y-thick/2,0,width-2*thick,thick,depth,chipboard)
    board(0,y-thick/2,14.15,width-2*thick,thick,1.3,hardwood)
  }
  board(0,(top+3)/2,-13.8,width-2*thick,top-3,.6,material(0xa0815e))

  // Dimensions are in cm, with independent page blocks, cover boards and bindings.
  function books(y:number, ids:number[], available:number, maxHeight:number) {
    const nominal=ids.reduce((n,id)=>n+shelfEditions[id].width,0)
    let edge=-width/2+thick+.36
    for (const [i,id] of ids.entries()) {
      const edition=shelfEditions[id]
      const w=(available-.085*ids.length)*edition.width/nominal
      const h=maxHeight*edition.height
      const d=h*(.62+(id%4)*.023)
      const front=12.8-Math.sin(i*4.1)*.46
      const x=edge+w/2, cy=y+h/2
      const cover=w<1.65 ? .055 : .105
      const spineDepth=.52
      for (const sign of [-1,1]) {
        coloredBoard(x+sign*(w-cover)/2,cy,front-(d+spineDepth)/2,cover,h,d-spineDepth,edition.color)
      }
      board(x,cy,front-(d+spineDepth)/2,w-2*cover-.025,h-.22,d-spineDepth-.24,paper)
      binding(x,cy,front-spineDepth/2,w,h,spineDepth,id)
      edge+=w+.085
    }
  }
  books(105,[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14],47.8,32)
  books(71,middleShelfIds,48.5,32)
  books(34,cookbookShelfIds,10.2,21)
  books(3,bottomShelfIds,48.5,28.4)

  const casePiece=(w:number,h:number,d:number,x:number,y:number,z:number,mat:THREE.Material,r:number) =>
    add(new RoundedBoxGeometry(w,h,d,3,r),mat,x,y,z)

  // Four columns of cassette cases in a separate tabletop rack.
  const rackX=2, columns=4, rows=8, bay=10.75, step=1.78
  const rackW=columns*bay+1.5
  const rackH=rows*step+1.5
  board(rackX,top+.375,-3,rackW,.75,8,hardwood)
  board(rackX,top+rackH-.375,-3,rackW,.75,8,hardwood)
  for(let col=0;col<=columns;col++) {
    const x=rackX+(col-columns/2)*bay
    board(x,top+rackH/2,-3,.7,rackH-1.5,8,hardwood)
  }
  for(let col=0;col<columns;col++) for(let row=0;row<rows;row++) {
    const x=rackX+(col+.5-columns/2)*bay, y=top+.75+(row+.5)*step
    const z=-2.6+Math.sin(col*3+row)*.13
    casePiece(9.98,1.73,6.9,x,y,z,dark,.11)
    binding(x,y,z+3.46,9.56,1.28,.09,shelfEditions.length+(col*7+row)%tapeNames.length,true)
  }

  for (const [mat, pieces] of batches) {
    const mesh=new THREE.Mesh(t.geo(mergeGeometries(pieces)),mat)
    mesh.castShadow=mesh.receiveShadow=true
    group.add(mesh)
    pieces.forEach(piece=>piece.dispose())
  }
  // The wooden case on the middle shelf has its own materials and hardware.
  const woodCase = buildWoodCase(t)
  woodCase.position.set(2, 58, 1)
  group.add(woodCase)
  return group
}
