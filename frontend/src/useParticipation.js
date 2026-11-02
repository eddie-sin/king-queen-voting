import {useEffect,useState} from 'react';
import {readStoredSession} from './authSession.js';
export const participationMessage='Participation access is not enabled for your account. Please contact the festival organisers.';
export function useParticipation(api){
 const [allowed,setAllowed]=useState(true);
 useEffect(()=>{let live=true,sequence=0;const refresh=async()=>{const n=++sequence;const owner=readStoredSession()?.token;if(!owner){if(live)setAllowed(true);return;}try{const data=await api.session();if(live&&n===sequence&&readStoredSession()?.token===owner)setAllowed(data.user?.participationAllowed!==false);}catch{/* Existing session handling remains responsible for auth failures. */}};refresh();const timer=setInterval(refresh,30000);window.addEventListener('focus',refresh);window.addEventListener('festival-session-change',refresh);return()=>{live=false;clearInterval(timer);window.removeEventListener('focus',refresh);window.removeEventListener('festival-session-change',refresh);};},[api]);
 return allowed;
}
