// React wrapper. Pass your EXISTING RAG call as `onAsk(question, { onStage })`; nothing in it is modified.
// onStage('retrieving' | 'generating') is optional; the animation still works without it.
import { useEffect, useRef } from 'react';
import { HamsterRAGAssistant as Engine } from './HamsterRAGAssistant.js';
export default function HamsterRAGAssistant({ assets, onAsk, title }) {
  const ask = useRef(onAsk); ask.current = onAsk;
  useEffect(() => { const h = new Engine({ assets, title, onAsk: (q, x) => ask.current(q, x) }); h.mount(); return () => h.destroy(); }, [assets, title]);
  return null;
}
