import { useId } from 'react';

function Lantern({ index }) {
  const glow = useId();
  return <svg className={`mp-festive-lantern mp-festive-lantern-${index}`} viewBox="0 0 60 100" focusable="false">
    <defs><linearGradient id={glow}><stop stopColor="#edc77d" stopOpacity=".18"/><stop offset=".5" stopColor="#fff1d4" stopOpacity=".65"/><stop offset="1" stopColor="#edc77d" stopOpacity=".2"/></linearGradient></defs>
    <path d="M30 2v12m-9 0h18" stroke="#edc77d" strokeWidth="1"/>
    <path d="M15 17Q30 11 45 17L49 57Q30 68 11 57Z" fill={`url(#${glow})`} stroke="#edc77d" strokeWidth="1.1"/>
    <path d="M22 16Q15 39 20 61m10-47v49m8-47q7 23 2 45M13 31q17 6 34 0M12 46q18 7 36 0" stroke="#edc77d" strokeOpacity=".5" strokeWidth=".7"/>
    <path d="m18 65 12 5 12-5M30 71v21m-6-23v16m12-16v16" stroke="#edc77d" strokeWidth="1"/>
    <path className="mp-lantern-ember" d="M30 56c-8-6-2-10 0-15 2 5 8 9 0 15Z" fill="#fff1d4"/>
  </svg>;
}

function OilLamp({ index }) {
  return <svg className={`mp-festive-lamp mp-festive-lamp-${index}`} viewBox="0 0 76 76" focusable="false">
    <ellipse cx="38" cy="46" rx="30" ry="5" fill="#edc77d" opacity=".13"/>
    <path d="M8 46Q38 78 68 46Q38 55 8 46Z" fill="#edc77d" fillOpacity=".16" stroke="#edc77d" strokeWidth="1.2"/>
    <path d="M16 52q22 15 44 0M26 65h24M38 47v-7" stroke="#edc77d" strokeWidth="1"/>
    <g className="mp-oil-flame"><path d="M38 43C18 34 40 22 37 8c11 10 20 27 1 35Z" fill="#edc77d" fillOpacity=".7"/><path d="M38 42c-8-7 2-13 2-20 7 10 7 16-2 20Z" fill="#fff1d4"/></g>
  </svg>;
}

export function FestivalMotion() {
  return <div className="mp-festival-motion" aria-hidden="true">
    {[1, 2, 3, 4].map(index => <Lantern key={index} index={index}/>)}
    {[1, 2].map(index => <OilLamp key={index} index={index}/>)}
  </div>;
}
