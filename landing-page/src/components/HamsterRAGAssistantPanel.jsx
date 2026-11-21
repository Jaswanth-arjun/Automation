import { useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch, applicationStore } from '../lib/api';
import { HamsterRAGAssistant as Engine } from './HamsterRAGAssistant';

// Art lives in /public/rag-hamster so Vite serves it unchanged (including the
// layered rig and the two reaction poses used by the demo).
const BASE = import.meta.env.BASE_URL || '/';
const rig = (name) => `${BASE}rag-hamster/rig/${name}`;
const pose = (name) => `${BASE}rag-hamster/poses/${name}`;

const ASSETS = {
  idle_body: rig('idle_body.png'),
  idle_head: rig('idle_head.png'),
  idle_earL: rig('idle_earL.png'),
  idle_earR: rig('idle_earR.png'),
  idle_eyeL: rig('idle_eyeL.png'),
  idle_eyeR: rig('idle_eyeR.png'),
  idle_armL: rig('idle_armL.png'),
  idle_armR: rig('idle_armR.png'),
  hold_base: rig('hold_base.png'),
  hold_eyeL: rig('hold_eyeL.png'),
  hold_eyeR: rig('hold_eyeR.png'),
  book_closed: rig('book_closed.png'),
  happy: pose('happy.png'),
  confused: pose('confused.png'),
};

function AssistantHost({ onAsk, onAction, title, entering }) {
  const askRef = useRef(onAsk);
  askRef.current = onAsk;
  const actionRef = useRef(onAction);
  actionRef.current = onAction;

  useEffect(() => {
    const assistant = new Engine({
      assets: ASSETS,
      title,
      entering,
      onAsk: (question, ctx) => askRef.current(question, ctx),
      onAction: (action) => actionRef.current?.(action),
    });
    assistant.mount();
    return () => assistant.destroy();
  }, [title, entering]);

  return null;
}

/**
 * The hamster RAG assistant used on every signed-in dashboard route.
 * The rig/animation is the demo engine unchanged; only the host callback is
 * wired to the real, verified RAG endpoint.
 */
export default function HamsterRAGAssistantPanel({ entering = false }) {
  const navigate = useNavigate();
  const history = useRef([]);

  const onAsk = useCallback(async (question, { onStage }) => {
    const startedAt = Date.now();
    onStage?.('retrieving');
    // The backend often answers instantly, but the hamster must visibly pick up
    // the book, flip pages and "read" before the answer lands. Hold the answer
    // for a minimum window so the searching animation is never skipped.
    const MIN_SEARCH_MS = 1900;
    const genTimer = setTimeout(() => onStage?.('generating'), 850);
    try {
      const data = await apiFetch('', '/api/rag/chat', {
        method: 'POST',
        body: JSON.stringify({
          message: question,
          history: history.current.slice(-6),
          clientState: { applications: applicationStore.getAll() },
        }),
      });
      const remaining = MIN_SEARCH_MS - (Date.now() - startedAt);
      if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
      history.current.push(
        { role: 'user', content: question },
        { role: 'assistant', content: String(data?.reply || '') },
      );
      if (history.current.length > 12) history.current = history.current.slice(-12);
      const plain = String(data?.reply || '')
        .replace(/^#{1,6}\s*/gm, '')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
      return {
        text: plain || 'I could not find anything for that question.',
        actions: Array.isArray(data?.actions) ? data.actions : [],
      };
    } finally {
      clearTimeout(genTimer);
    }
  }, []);

  const onAction = useCallback((action) => {
    if (!action) return;
    if (action.type === 'route' && action.path) {
      navigate(action.path);
      return;
    }
    if (action.type === 'download') {
      const url = action.url || (action.filename
        ? `/api/resumes/download/${encodeURIComponent(action.filename)}`
        : '');
      if (!url) return;
      const link = document.createElement('a');
      link.href = url;
      if (action.filename) link.download = action.filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
    }
  }, [navigate]);

  return <AssistantHost entering={entering} onAsk={onAsk} onAction={onAction} title="Hamzooh Copilot" />;
}
