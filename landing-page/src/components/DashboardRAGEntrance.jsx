import { useCallback, useEffect, useState } from 'react';
import { profileStore } from '../lib/api';
import HamsterRunner from './HamsterRunner';
import HamsterRAGAssistantPanel from './HamsterRAGAssistantPanel';

// Mirrors Sidebar.jsx / TopNav.jsx completion weighting exactly.
function isProfileComplete() {
  try {
    const saved = profileStore.get();
    if (!saved) return false;
    let score = 0;
    if (saved.fullName?.trim()) score += 15;
    if (saved.email?.trim()) score += 15;
    if (saved.phone?.trim()) score += 10;
    if (saved.location?.trim()) score += 10;
    if (saved.resume?.dataUrl || saved.resume?.fileName) score += 20;
    if (saved.skills && saved.skills.length > 0) score += 10;
    if (saved.education && saved.education.length > 0) score += 10;
    if ((saved.experience && saved.experience.length > 0)
      || (saved.projects && saved.projects.length > 0)
      || saved.links?.github || saved.links?.linkedin) score += 10;
    return score >= 100;
  } catch {
    return false;
  }
}

/**
 * No mascot while the profile is incomplete. Once it reaches 100%, the hamster
 * walks in slowly from the sidebar edge to the bottom-right, then cross-fades
 * into the seated RAG assistant at the same spot. Replays on each fresh load.
 */
export default function DashboardRAGEntrance({ walkIn = true }) {
  const [complete, setComplete] = useState(isProfileComplete);
  // checking | hidden | walking | handoff | ready
  // Without the walk-in (any dashboard page except Home) the seated assistant
  // is shown at once; the profile gate stays the same.
  const [phase, setPhase] = useState(() => {
    if (walkIn) return 'checking';
    return isProfileComplete() ? 'ready' : 'hidden';
  });

  useEffect(() => {
    const check = () => setComplete(isProfileComplete());
    check();
    window.addEventListener('profile_updated', check);
    window.addEventListener('storage', check);
    return () => {
      window.removeEventListener('profile_updated', check);
      window.removeEventListener('storage', check);
    };
  }, []);

  useEffect(() => {
    if (phase === 'checking') setPhase(complete ? 'walking' : 'hidden');
    else if (phase === 'hidden' && complete) setPhase(walkIn ? 'walking' : 'ready');
  }, [complete, phase, walkIn]);

  const onArrive = useCallback(() => setPhase('handoff'), []);

  useEffect(() => {
    if (phase !== 'handoff') return undefined;
    const timer = setTimeout(() => setPhase('ready'), 780);
    return () => clearTimeout(timer);
  }, [phase]);

  if (phase === 'hidden' || phase === 'checking') return null;
  if (phase === 'walking') return <HamsterRunner onArrive={onArrive} />;
  if (phase === 'handoff') {
    return (
      <>
        <HamsterRunner fading />
        <HamsterRAGAssistantPanel entering />
      </>
    );
  }
  return <HamsterRAGAssistantPanel />;
}
