import { getSliceGeometry, type Volume, type VolumePlane } from './volume.ts'
/** Detect constant source rows, not black pixels produced by a display window. */
export function sourceEdgeCoverage(volume: Volume, plane: VolumePlane, index: number) {
  const g = getSliceGeometry(volume, plane)
  const at = (col: number, row: number) => {
    const p = [0,0,0]
    p[g.axis]=index; p[g.columnAxis]=g.flipColumn ? g.width-1-col : col; p[g.rowAxis]=g.flipRow ? g.height-1-row : row
    return volume.data[p[0]+volume.dimensions[0]*(p[1]+volume.dimensions[1]*p[2])]
  }
  const edge = (bottom: boolean) => {
    const value=at(0,bottom?g.height-1:0)
    let rows=0
    for(let n=0;n<g.height;n++) {
      const row=bottom?g.height-1-n:n
      let uniform=true
      for(let col=0;col<g.width;col++) if(at(col,row)!==value){uniform=false;break}
      if(!uniform)break
      rows++
    }
    return {rows,value}
  }
  const top=edge(false),bottom=edge(true)
  const chosen=bottom.rows>=top.rows?{...bottom,edge:'lower'}:{...top,edge:'upper'}
  return chosen.rows/g.height>=.25?{...chosen,totalRows:g.height}:null
}
