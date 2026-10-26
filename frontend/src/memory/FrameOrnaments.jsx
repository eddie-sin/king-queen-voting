export function FrameOrnaments() {
  return <svg className="mp-frame-garland" viewBox="0 0 400 64" fill="none" aria-hidden="true" focusable="false">
    <path d="M8 12Q200 65 392 12" stroke="#d5ac65" strokeWidth="1.4"/>
    <path d="m82 29 5 23 17-17" fill="#c77962" stroke="#edc77d" strokeWidth=".7"/>
    <path d="m189 39 11 22 11-22" fill="#edc77d"/>
    <path d="m296 35 17 17 5-23" fill="#73a6a0" stroke="#edc77d" strokeWidth=".7"/>
    {[{ x: 29, y: 18 }, { x: 137, y: 35 }, { x: 263, y: 35 }, { x: 371, y: 18 }].map(({ x, y }, index) => <g className="mp-frame-light" style={{ '--light-delay': `${index * .35}s` }} key={x}><path d={`M${x} ${y - 3}v8`} stroke="#edc77d"/><ellipse cx={x} cy={y + 9} rx="5" ry="7" fill="#ffe3a2"/><path d={`M${x - 3} ${y + 7}h6m-6 4h6`} stroke="#c39753" strokeWidth=".6"/></g>)}
  </svg>;
}
