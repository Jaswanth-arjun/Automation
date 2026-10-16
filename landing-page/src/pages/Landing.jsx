import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCircle2,
  ChevronDown,
  Briefcase,
  Mail,
  FileText,
  LayoutDashboard,
  Search,
  Send,
  Sparkles,
  Menu,
  X,
  Zap,
  Users,
  Bell,
  Globe,
  Star,
  AtSign,
  Puzzle,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import VideoLoader from '../components/VideoLoader';
import PawLogo from '../components/PawLogo';
import './Landing.css';

/* ================= helpers ================= */

function useCountUp(target, active, duration = 1400) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    const start = performance.now();
    const tick = (now) => {
      const p = Math.min(1, (now - start) / duration);
      setValue(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, target, duration]);
  return value;
}

function useReveal() {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting) { setVisible(true); io.disconnect(); } },
      { threshold: 0.15 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return [ref, visible];
}

/* ================= PARTICLE CANVAS ================= */

function ParticleHero() {
  const canvasRef = useRef(null);
  const mouseRef = useRef({ x: -999, y: -999 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let raf;
    let particles = [];
    const PARTICLE_COUNT = 120;
    const CONNECT_DIST = 140;
    const MOUSE_RADIUS = 180;

    function resize() {
      const rect = canvas.parentElement.getBoundingClientRect();
      canvas.width = rect.width * window.devicePixelRatio;
      canvas.height = rect.height * window.devicePixelRatio;
      canvas.style.width = rect.width + 'px';
      canvas.style.height = rect.height + 'px';
      ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
    }

    function initParticles() {
      const rect = canvas.parentElement.getBoundingClientRect();
      particles = [];
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        particles.push({
          x: Math.random() * rect.width,
          y: Math.random() * rect.height,
          vx: (Math.random() - 0.5) * 0.5,
          vy: (Math.random() - 0.5) * 0.5,
          r: Math.random() * 2 + 1,
          opacity: Math.random() * 0.5 + 0.2,
        });
      }
    }

    function draw() {
      const rect = canvas.parentElement.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      ctx.clearRect(0, 0, w, h);
      const mx = mouseRef.current.x;
      const my = mouseRef.current.y;

      // Update + draw particles
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0) p.x = w;
        if (p.x > w) p.x = 0;
        if (p.y < 0) p.y = h;
        if (p.y > h) p.y = 0;

        // Mouse repulsion
        const dx = p.x - mx;
        const dy = p.y - my;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < MOUSE_RADIUS && dist > 0) {
          const force = (MOUSE_RADIUS - dist) / MOUSE_RADIUS * 0.02;
          p.vx += (dx / dist) * force;
          p.vy += (dy / dist) * force;
        }

        // Dampen velocity
        p.vx *= 0.99;
        p.vy *= 0.99;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(51, 92, 255, ${p.opacity})`;
        ctx.fill();
      }

      // Draw connections
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < CONNECT_DIST) {
            const alpha = (1 - dist / CONNECT_DIST) * 0.15;
            ctx.beginPath();
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.strokeStyle = `rgba(51, 92, 255, ${alpha})`;
            ctx.lineWidth = 0.8;
            ctx.stroke();
          }
        }
      }

      // Draw mouse glow
      if (mx > 0 && my > 0) {
        const gradient = ctx.createRadialGradient(mx, my, 0, mx, my, MOUSE_RADIUS);
        gradient.addColorStop(0, 'rgba(51, 92, 255, 0.08)');
        gradient.addColorStop(1, 'rgba(51, 92, 255, 0)');
        ctx.beginPath();
        ctx.arc(mx, my, MOUSE_RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = gradient;
        ctx.fill();
      }

      raf = requestAnimationFrame(draw);
    }

    const onMouseMove = (e) => {
      const rect = canvas.parentElement.getBoundingClientRect();
      mouseRef.current.x = e.clientX - rect.left;
      mouseRef.current.y = e.clientY - rect.top;
    };

    const onMouseLeave = () => {
      mouseRef.current.x = -999;
      mouseRef.current.y = -999;
    };

    resize();
    initParticles();
    draw();

    window.addEventListener('resize', () => { resize(); initParticles(); });
    canvas.parentElement.addEventListener('mousemove', onMouseMove);
    canvas.parentElement.addEventListener('mouseleave', onMouseLeave);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      canvas.parentElement?.removeEventListener('mousemove', onMouseMove);
      canvas.parentElement?.removeEventListener('mouseleave', onMouseLeave);
    };
  }, []);

  return (
    <div className="hmz-particles">
      <canvas ref={canvasRef} />
    </div>
  );
}

/* ================= GOLDEN SUNLIGHT + INTERACTIVE SHIMMER ================= */

const SUN_MOTES = [
  { left: '8%', size: 5, delay: '0s', dur: '9s' },
  { left: '16%', size: 3, delay: '2.2s', dur: '11s' },
  { left: '27%', size: 6, delay: '5s', dur: '10s' },
  { left: '38%', size: 4, delay: '1.1s', dur: '12s' },
  { left: '52%', size: 5, delay: '3.4s', dur: '9.5s' },
  { left: '63%', size: 3, delay: '6.1s', dur: '11s' },
  { left: '74%', size: 6, delay: '0.7s', dur: '10s' },
  { left: '85%', size: 4, delay: '4.2s', dur: '12s' },
  { left: '93%', size: 5, delay: '2.8s', dur: '9s' },
  { left: '45%', size: 3, delay: '7s', dur: '13s' },
];

const SPARKLE_POSITIONS = [
  { left: '12%', top: '18%', size: 18, delay: '0s' },
  { left: '25%', top: '8%', size: 14, delay: '1.4s' },
  { left: '42%', top: '22%', size: 20, delay: '2.8s' },
  { left: '58%', top: '12%', size: 16, delay: '0.6s' },
  { left: '72%', top: '20%', size: 22, delay: '3.5s' },
  { left: '88%', top: '15%', size: 15, delay: '1.9s' },
  { left: '35%', top: '5%', size: 12, delay: '4.2s' },
  { left: '65%', top: '28%', size: 17, delay: '2.1s' },
];

/* Canvas-based interactive shimmer starfield */
function ShimmerCanvas({ mouseX, mouseY }) {
  const canvasRef = useRef(null);
  const starsRef = useRef([]);
  const mouseRef = useRef({ x: 0.5, y: 0.5 });

  useEffect(() => {
    mouseRef.current = { x: (mouseX + 1) / 2, y: (mouseY + 1) / 2 };
  }, [mouseX, mouseY]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let raf;
    const STAR_COUNT = 80;

    function resize() {
      const rect = canvas.parentElement.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio, 2);
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      canvas.style.width = rect.width + 'px';
      canvas.style.height = rect.height + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function initStars() {
      const rect = canvas.parentElement.getBoundingClientRect();
      starsRef.current = [];
      for (let i = 0; i < STAR_COUNT; i++) {
        starsRef.current.push({
          x: Math.random() * rect.width,
          y: Math.random() * rect.height * 0.7,
          baseR: Math.random() * 1.8 + 0.5,
          phase: Math.random() * Math.PI * 2,
          speed: Math.random() * 0.008 + 0.003,
          drift: (Math.random() - 0.5) * 0.15,
          color: Math.random() > 0.6 ? 'gold' : 'white',
        });
      }
    }

    let t = 0;
    function draw() {
      const rect = canvas.parentElement.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;
      ctx.clearRect(0, 0, w, h);

      const mx = mouseRef.current.x * w;
      const my = mouseRef.current.y * h;

      // Mouse spotlight glow
      if (mx > 0 && my > 0) {
        const spotGrad = ctx.createRadialGradient(mx, my, 0, mx, my, 280);
        spotGrad.addColorStop(0, 'rgba(255, 197, 49, 0.08)');
        spotGrad.addColorStop(0.4, 'rgba(255, 170, 40, 0.04)');
        spotGrad.addColorStop(1, 'rgba(255, 197, 49, 0)');
        ctx.beginPath();
        ctx.arc(mx, my, 280, 0, Math.PI * 2);
        ctx.fillStyle = spotGrad;
        ctx.fill();
      }

      t += 1;
      for (const s of starsRef.current) {
        s.x += s.drift;
        if (s.x < -10) s.x = w + 10;
        if (s.x > w + 10) s.x = -10;

        const pulse = Math.sin(t * s.speed + s.phase);
        const r = s.baseR * (0.6 + pulse * 0.4);

        // Brighten near cursor
        const dx = s.x - mx;
        const dy = s.y - my;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const proximity = Math.max(0, 1 - dist / 300);
        const alpha = 0.25 + pulse * 0.25 + proximity * 0.5;

        if (s.color === 'gold') {
          ctx.shadowColor = 'rgba(255, 197, 49, 0.6)';
          ctx.shadowBlur = 6 + proximity * 10;
          ctx.fillStyle = `rgba(255, 210, 80, ${alpha})`;
        } else {
          ctx.shadowColor = 'rgba(255, 255, 255, 0.4)';
          ctx.shadowBlur = 4 + proximity * 8;
          ctx.fillStyle = `rgba(255, 255, 255, ${alpha * 0.7})`;
        }

        ctx.beginPath();
        ctx.arc(s.x, s.y, r + proximity * 2, 0, Math.PI * 2);
        ctx.fill();

        // Cross sparkle for bright stars near cursor
        if (proximity > 0.3 && s.baseR > 1) {
          ctx.strokeStyle = ctx.fillStyle;
          ctx.lineWidth = 0.5;
          const len = r * 3 * proximity;
          ctx.beginPath();
          ctx.moveTo(s.x - len, s.y); ctx.lineTo(s.x + len, s.y);
          ctx.moveTo(s.x, s.y - len); ctx.lineTo(s.x, s.y + len);
          ctx.stroke();
        }
      }
      ctx.shadowBlur = 0;

      raf = requestAnimationFrame(draw);
    }

    resize();
    initStars();
    draw();

    const onResize = () => { resize(); initStars(); };
    window.addEventListener('resize', onResize);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', onResize); };
  }, []);

  return <canvas ref={canvasRef} className="hmz-shimmer-canvas" />;
}

function SunLight({ px = 0, py = 0 }) {
  return (
    <div
      className="hmz-sun"
      aria-hidden="true"
      style={{ transform: `translate(${px * 14}px, ${py * 10}px)` }}
    >
      {/* Intense Top Amber-Golden Sunburst Core */}
      <div className="hmz-sun-glow-core" />

      {/* Soft rotating conic rays */}
      <div className="hmz-sun-rays" />

      {/* Primary Solar Ring Dome SVG */}
      <svg className="hmz-sun-halo-svg" viewBox="0 0 1400 540" preserveAspectRatio="none">
        <defs>
          <linearGradient id="goldHaloGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#FFA000" stopOpacity="0" />
            <stop offset="12%" stopColor="#FFC531" stopOpacity="0.85" />
            <stop offset="50%" stopColor="#FFF2A3" stopOpacity="1" />
            <stop offset="88%" stopColor="#FFC531" stopOpacity="0.85" />
            <stop offset="100%" stopColor="#FFA000" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="goldInnerGlow" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#FFC01D" stopOpacity="0.7" />
            <stop offset="60%" stopColor="#FF9800" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
          </linearGradient>
          <filter id="haloGlowFilter" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="4" result="blur1" />
            <feGaussianBlur stdDeviation="14" result="blur2" />
            <feGaussianBlur stdDeviation="30" result="blur3" />
            <feMerge>
              <feMergeNode in="blur3" />
              <feMergeNode in="blur2" />
              <feMergeNode in="blur1" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Rich Inner Dome Ambient Fill — Reaches deeper down */}
        <path d="M -100,-60 Q 700,500 1500,-60 Z" fill="url(#goldInnerGlow)" />

        {/* Main Thick Golden Glowing Arch Ring — Lower curve */}
        <path
          d="M -60,0 Q 700,435 1460,0"
          fill="none"
          stroke="url(#goldHaloGrad)"
          strokeWidth="5.5"
          filter="url(#haloGlowFilter)"
        />
        <path
          d="M -60,0 Q 700,435 1460,0"
          fill="none"
          stroke="#FFFFFF"
          strokeWidth="1.5"
          opacity="0.9"
        />
      </svg>

      {/* Bright lens flare sparkles resting along the arc */}
      {SPARKLE_POSITIONS.map((sp, i) => (
        <svg key={i} className="hmz-lens-sparkle" style={{ left: sp.left, top: sp.top, width: sp.size, height: sp.size, animationDelay: sp.delay }} viewBox="0 0 20 20">
          <line x1="10" y1="0" x2="10" y2="20" stroke="rgba(255,255,255,0.95)" strokeWidth="1.5" />
          <line x1="0" y1="10" x2="20" y2="10" stroke="rgba(255,255,255,0.95)" strokeWidth="1.5" />
          <line x1="3" y1="3" x2="17" y2="17" stroke="rgba(255,220,120,0.7)" strokeWidth="1" />
          <line x1="17" y1="3" x2="3" y2="17" stroke="rgba(255,220,120,0.7)" strokeWidth="1" />
        </svg>
      ))}

      {/* Floating golden motes */}
      {SUN_MOTES.map((m, i) => (
        <span
          key={i}
          className="hmz-mote"
          style={{ left: m.left, width: m.size, height: m.size, animationDelay: m.delay, animationDuration: m.dur }}
        />
      ))}
    </div>
  );
}

/* ================= MAGNETIC BUTTON ================= */

function MagneticWrap({ children, strength = 0.3 }) {
  const ref = useRef(null);
  const onMove = (e) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = (e.clientX - cx) * strength;
    const dy = (e.clientY - cy) * strength;
    el.style.transform = `translate(${dx}px, ${dy}px)`;
  };
  const onLeave = () => {
    if (ref.current) ref.current.style.transform = '';
  };
  return (
    <span className="hmz-magnetic" ref={ref} onMouseMove={onMove} onMouseLeave={onLeave}>
      {children}
    </span>
  );
}

/* ================= 3D TILT CARD ================= */

function TiltCard({ children, className = '', maxTilt = 6 }) {
  const ref = useRef(null);
  const onMove = (e) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    const rotateX = (0.5 - y) * maxTilt;
    const rotateY = (x - 0.5) * maxTilt;
    el.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale3d(1.02,1.02,1.02)`;
  };
  const onLeave = () => {
    if (ref.current) ref.current.style.transform = '';
  };
  return (
    <div ref={ref} className={className} onMouseMove={onMove} onMouseLeave={onLeave}>
      {children}
    </div>
  );
}

/* ================= SCROLL STAGGER HOOK ================= */

function useStagger() {
  const ref = useRef(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting) { setInView(true); io.disconnect(); } },
      { threshold: 0.1 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return [ref, inView];
}

/* ================= WAVE DIVIDER ================= */

function WaveDivider({ color = '#0f1222', flip = false }) {
  return (
    <svg className={`hmz-wave ${flip ? 'flip' : ''}`} viewBox="0 0 1920 128" preserveAspectRatio="none" style={{ display: 'block', width: '100%', height: '80px' }}>
      <path fill={color} d="M0,64 C320,20 640,100 960,50 C1280,0 1600,80 1920,40 L1920,128 L0,128 Z" />
    </svg>
  );
}

/* ================= CURSOR-FOLLOWING STEP CARD ================= */

function StepCard({ children, className, onClick }) {
  const ref = useRef(null);
  const onMove = (e) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    el.style.setProperty('--mx', `${e.clientX - rect.left}px`);
    el.style.setProperty('--my', `${e.clientY - rect.top}px`);
  };
  return (
    <button ref={ref} className={className} onClick={onClick} onMouseMove={onMove}>
      {children}
    </button>
  );
}

/* ================= data ================= */

const PILLARS = [
  {
    icon: <Search size={22} />, tint: 'blue', name: 'Job Matches',
    title: 'Matched jobs, not endless scrolling',
    desc: 'Paste any job link or browse the board. Every role gets a skill-match score so you chase the right ones.',
    points: ['Match % on every role', 'Any public job link works', 'Save + filter + track'],
    route: '/dashboard/jobs', cta: 'Browse jobs',
  },
  {
    icon: <Puzzle size={22} />, tint: 'green', name: 'Copilot Extension',
    title: 'One-click apply, anywhere',
    desc: 'Hamzo Apply fills application forms on Greenhouse, Lever, Ashby, Workday, mynexthire and more — then asks before submitting.',
    points: ['Auto-fill + resume attach', 'Unknown fields? It asks you', 'Answers remembered (vault)'],
    route: '/dashboard/resume', cta: 'Get the extension',
  },
  {
    icon: <FileText size={22} />, tint: 'purple', name: 'AI Resume Builder',
    title: 'A tailored resume per job',
    desc: 'Paste a job link, get a one-page tailored resume in 3 polished formats with keyword-gap analysis.',
    points: ['3 one-page PDF formats', 'Keyword match breakdown', 'Master resume untouched'],
    route: '/dashboard/resume', cta: 'Tailor resume',
  },
  {
    icon: <LayoutDashboard size={22} />, tint: 'orange', name: 'Job Tracker',
    title: 'Every application, one timeline',
    desc: 'Resumes sent, outreach mails, LinkedIn invites, follow-ups — full history per opportunity, auto-synced.',
    points: ['Applied → interview stages', 'LinkedIn sync every 15 min', 'Follow-up reminders'],
    route: '/dashboard/applications', cta: 'Track applications',
  },
];

const STEPS = [
  { n: '01', title: 'Run the agent on any job', desc: 'One click on any job listing — LinkedIn, job boards, Greenhouse, company career pages. The agent activates right there.', tag: 'One Click' },
  { n: '02', title: 'It finds the right people', desc: 'Role-based LinkedIn campaigns plus Gmail outreach to recruiters and hiring managers — with personal, first-name notes.', tag: 'Auto Referrals' },
  { n: '03', title: 'You get replies, not ghosting', desc: 'Follow-ups run on autopilot, replies are tracked, and your resume lands in front of humans — past the ATS queue.', tag: 'More Interviews' },
];

const INTEGRATIONS = ['LinkedIn', 'Gmail', 'Greenhouse', 'Lever', 'Ashby', 'Workday', 'mynexthire', 'Naukri', 'Indeed', 'Any career page'];

const REVIEWS = [
  { name: 'Priya Sharma', initials: 'PS', tint: '#335CFF', role: 'Product Manager', text: 'Outreach, resume versions and follow-ups finally live in one place. I stopped losing recruiter replies in Gmail.' },
  { name: 'Amir Khan', initials: 'AK', tint: '#16a34a', role: 'Backend Engineer', text: 'The LinkedIn campaign runner saved me hours. Set roles, set limits, and every invite is tracked.' },
  { name: 'Sarah Jenkins', initials: 'SJ', tint: '#9333ea', role: 'UX Designer', text: 'Resume tailor from a job link is scary good. Three clean one-page formats, keywords included.' },
  { name: 'Daniel Kim', initials: 'DK', tint: '#ea580c', role: 'Marketing Lead', text: 'Mail summaries plus follow-up writer doubled my referral reply rate. No more blank-page anxiety.' },
  { name: 'Alex Rivera', initials: 'AR', tint: '#0891b2', role: 'Engineering Lead', text: 'Vault plus extension fills those endless Workday forms. My applications actually get finished now.' },
  { name: 'Sneha Reddy', initials: 'SR', tint: '#db2777', role: 'Data Analyst', text: 'Match scores told me exactly which jobs to chase. Three interviews in two weeks.' },
  { name: 'Rahul Verma', initials: 'RV', tint: '#65a30d', role: 'Frontend Developer', text: 'The extension clicked Apply and filled everything itself. I just reviewed and hit submit.' },
  { name: 'Kavya Nair', initials: 'KN', tint: '#7c3aed', role: 'QA Engineer', text: 'Tracker plus 15-minute LinkedIn sync means I always know where every application stands.' },
];

const FAQS = [
  ['What does HAMZO actually do?', 'It is your AI referral agent, not a job board: LinkedIn connection campaigns, Gmail referral outreach and follow-ups, resume tailoring from any job link, and application tracking. You approve what goes out — nothing sends silently.'],
  ['How do I connect LinkedIn and Gmail?', 'Dashboard → LinkedIn → Connect (login popup or li_at cookie). Mail page → connect with Google OAuth or an App Password. Disconnect anytime — your control.'],
  ['How does the Chrome extension work?', 'Load it unpacked via chrome://extensions. On any application page it fills the form, attaches your tailored resume, asks you about unknown fields (and remembers answers in the vault), and confirms before submitting.'],
  ['Will my master resume be overwritten?', 'No. Your master resume stays intact. HAMZO generates job-specific one-page versions so you always know which PDF went where.'],
  ['Is it free?', 'Yes — start free, no credit card. Connect your accounts, tailor resumes, run outreach and track everything from one workspace.'],
];

/* ================= live demo player ================= */

const DEMO_STEPS = [
  { id: 'link', label: 'Drop a job link', caption: 'Paste any job link — HAMZO reads the role, company and requirements in seconds.' },
  { id: 'match', label: 'Match + tailor', caption: 'Skill-match score plus a one-page tailored resume in 3 formats.' },
  { id: 'outreach', label: 'Outreach autopilot', caption: 'Personal referral mails and LinkedIn invites go out — follow-ups scheduled.' },
  { id: 'track', label: 'Track to interview', caption: 'Every reply lands on one timeline until Interview is scheduled.' },
];

function Typewriter({ text, speed = 24 }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    setN(0);
    if (!text) return undefined;
    const id = window.setInterval(() => {
      setN((v) => {
        if (v >= text.length) { window.clearInterval(id); return v; }
        return v + 1;
      });
    }, speed);
    return () => window.clearInterval(id);
  }, [text, speed]);
  return <span className="hmz-type">{text.slice(0, n)}<span className="hmz-caret" /></span>;
}

function DemoStage({ step }) {
  if (step === 0) {
    return (
      <div className="hmz-dscene">
        <div className="hmz-dlink"><Globe size={15} /><Typewriter text="angelone.mynexthire.com/…/Agentic-AI-Intern" /></div>
        <div className="hmz-danalyze"><Sparkles size={15} /> Analyzing job…</div>
        <div className="hmz-dchips">
          {['Agentic AI Intern', 'Angel One', 'Bengaluru', 'Fresher'].map((t, i) => (
            <span key={t} className="hmz-dpop" style={{ animationDelay: `${0.9 + i * 0.35}s` }}>{t}</span>
          ))}
        </div>
      </div>
    );
  }
  if (step === 1) {
    return (
      <div className="hmz-dscene">
        <div className="hmz-dmatch">
          <svg viewBox="0 0 44 44" className="hmz-ddonut">
            <circle cx="22" cy="22" r="19" fill="none" stroke="#e6e9f4" strokeWidth="5" />
            <circle cx="22" cy="22" r="19" fill="none" stroke="#335CFF" strokeWidth="5" strokeLinecap="round" strokeDasharray="0,100" pathLength="100" className="hmz-donutanim" transform="rotate(-90 22 22)" />
            <text x="22" y="26" textAnchor="middle" className="hmz-donuttxt">98%</text>
          </svg>
          <div><b>Profile match</b><small>12 keywords matched</small></div>
        </div>
        <div className="hmz-dchips">
          {['Python', 'LLM APIs', 'FastAPI', 'SQL', '+8'].map((t, i) => (
            <span key={t} className="hmz-dpop" style={{ animationDelay: `${0.5 + i * 0.25}s` }}>{t}</span>
          ))}
        </div>
        <div className="hmz-dresume"><FileText size={16} /><div><b>Arjun_AngelOne.pdf</b><span>Tailored · 1 page</span></div><Check size={15} /></div>
      </div>
    );
  }
  if (step === 2) {
    return (
      <div className="hmz-dscene">
        <div className="hmz-dmail"><Send size={14} /><div><b>Referral request sent</b><span>hiring@angelone · resume attached</span></div><Check size={15} /></div>
        <div className="hmz-dinvites">
          {['Recruiter', 'Talent Acquisition', 'Hiring Manager'].map((t, i) => (
            <div key={t} className="hmz-dinvite" style={{ animationDelay: `${0.6 + i * 0.5}s` }}>
              <span className="hmz-dava">{t[0]}</span><span>{t}</span><b>Sent ✓</b>
            </div>
          ))}
        </div>
        <div className="hmz-dfollow"><Bell size={14} /> Follow-up scheduled in 4 days</div>
      </div>
    );
  }
  return (
    <div className="hmz-dscene">
      <div className="hmz-dtimeline">
        {[['Resume tailored', 1], ['Outreach sent', 1], ['Reply received', 1], ['Interview', 0]].map(([label, done], i) => (
          <div key={label} className="hmz-dtrow" style={{ animationDelay: `${0.3 + i * 0.45}s` }}>
            {done ? <Check size={14} /> : <span className="hmz-ring" />}
            <span>{label}</span>
            {!done && <small className="next">next Tue</small>}
          </div>
        ))}
      </div>
      <div className="hmz-dtoast"><CheckCircle2 size={15} /> Recruiter replied: "Let's schedule a call"</div>
    </div>
  );
}

function DemoPlayer() {
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [inView, setInView] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const io = new IntersectionObserver((e) => setInView(e[0].isIntersecting), { threshold: 0.25 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!playing || !inView) return undefined;
    const id = window.setTimeout(() => setStep((s) => (s + 1) % DEMO_STEPS.length), 4400);
    return () => window.clearTimeout(id);
  }, [playing, inView, step]);

  return (
    <div className="hmz-demo" id="demo" ref={wrapRef}>
      <div className="hmz-head center show">
        <span className="hmz-kicker">LIVE DEMO</span>
        <h2>Watch HAMZO <em>work.</em></h2>
        <p>A real run, compressed into 18 seconds — from job link to interview.</p>
      </div>
      <TiltCard className="hmz-browser" maxTilt={2}>
        <div className="hmz-bbar">
          <span className="hmz-bdots"><i /><i /><i /></span>
          <span className="hmz-burl"><Globe size={12} /> hamzo.app/dashboard</span>
          <span className="hmz-blive"><span className="hmz-pulse" />live demo</span>
        </div>
        <div className="hmz-dtabs">
          {DEMO_STEPS.map((s, i) => (
            <button key={s.id} onClick={() => { setStep(i); setPlaying(true); }} className={`hmz-dtab ${i === step ? 'on' : ''}`}>
              <span className="hmz-dtabn">{i + 1}</span>{s.label}
            </button>
          ))}
        </div>
        <div className="hmz-dstage" key={step}><DemoStage step={step} /></div>
        <div className="hmz-dprog">{DEMO_STEPS.map((s, i) => (
          <span key={s.id} className={i === step ? 'on' : i < step ? 'done' : ''}>
            {i === step && playing && inView && <i key={step} className="hmz-dfill" />}
          </span>
        ))}</div>
        <div className="hmz-dfoot">
          <span className="hmz-dcaption">{DEMO_STEPS[step].caption}</span>
          <span className="hmz-dctrl">
            <button aria-label={playing ? 'Pause' : 'Play'} onClick={() => setPlaying((p) => !p)}>{playing ? '❚❚' : '▶'}</button>
            <button aria-label="Replay" onClick={() => { setStep(0); setPlaying(true); }}>↻</button>
          </span>
        </div>
      </TiltCard>
    </div>
  );
}

/* ================= HAMZO - HOW IT WORKS INTERACTIVE CARD ================= */

function HowItWorksCard() {
  const [activeStep, setActiveStep] = useState(0);
  const [paused, setPaused] = useState(false);
  const [atsScore, setAtsScore] = useState(54);

  const DUR = 5000;

  useEffect(() => {
    if (paused) return;
    const timer = setInterval(() => {
      setActiveStep((prev) => (prev + 1) % 4);
    }, DUR);
    return () => clearInterval(timer);
  }, [paused, activeStep]);

  useEffect(() => {
    if (activeStep !== 2) {
      setAtsScore(54);
      return;
    }
    let startTime = null;
    let animId;
    const duration = 1400;

    const animateScore = (timestamp) => {
      if (!startTime) startTime = timestamp;
      const progress = Math.min((timestamp - startTime) / duration, 1);
      const easeProgress = 1 - Math.pow(1 - progress, 3);
      setAtsScore(Math.round(54 + 41 * easeProgress));
      if (progress < 1) {
        animId = requestAnimationFrame(animateScore);
      }
    };
    animId = requestAnimationFrame(animateScore);
    return () => cancelAnimationFrame(animId);
  }, [activeStep]);

  const STEPS_DATA = [
    {
      num: 1,
      h: "Paste a job link.",
      p: "Drop in any posting. HAMZO reads the company, role and the skills the employer is asking for.",
      panel: (
        <div className="hmz-hw-panel">
          <div className="hmz-hw-ph">New job</div>
          <div className="hmz-hw-in">
            <div><span className="hmz-hw-ty">careers.google.com/jobs/swe-42</span></div>
            <span className="hmz-hw-go">Analyze</span>
          </div>
          <div className="hmz-hw-chips">
            <span className="hmz-hw-chip" style={{ animationDelay: '0.2s' }}>Google</span>
            <span className="hmz-hw-chip" style={{ animationDelay: '0.4s' }}>Software Engineer</span>
            <span className="hmz-hw-chip" style={{ animationDelay: '0.6s' }}>Hyderabad</span>
            <span className="hmz-hw-chip k" style={{ animationDelay: '0.8s' }}>React</span>
            <span className="hmz-hw-chip k" style={{ animationDelay: '1.0s' }}>Node.js</span>
            <span className="hmz-hw-chip k" style={{ animationDelay: '1.2s' }}>System design</span>
            <span className="hmz-hw-chip k" style={{ animationDelay: '1.4s' }}>REST APIs</span>
          </div>
        </div>
      )
    },
    {
      num: 2,
      h: "Connect Gmail and LinkedIn.",
      p: "Link them once, add the Chrome extension, and every message HAMZO sends later goes out as you.",
      panel: (
        <div className="hmz-hw-panel">
          <div className="hmz-hw-ph">Channels</div>
          <div className="hmz-hw-row" style={{ animationDelay: '0.2s' }}>
            <span className="hmz-hw-ico">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>
            </span>
            <span className="hmz-hw-rt"><b>Gmail</b><small>you@gmail.com</small></span>
            <span className="hmz-hw-btn"><span className="b">Connected</span></span>
          </div>
          <div className="hmz-hw-row" style={{ animationDelay: '0.6s' }}>
            <span className="hmz-hw-ico">in</span>
            <span className="hmz-hw-rt"><b>LinkedIn</b><small>linkedin.com/in/you</small></span>
            <span className="hmz-hw-btn"><span className="b">Connected</span></span>
          </div>
          <div className="hmz-hw-row" style={{ animationDelay: '1.0s' }}>
            <span className="hmz-hw-ico">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M10 4a2 2 0 1 1 4 0v2h4v4h-2a2 2 0 1 0 0 4h2v4H4v-4h2a2 2 0 1 0 0-4H4V6h6z"/></svg>
            </span>
            <span className="hmz-hw-rt"><b>HAMZO for Chrome</b><small>Fill forms on any job posting</small></span>
            <span className="hmz-hw-btn"><span className="b">Added</span></span>
          </div>
          <div className="hmz-hw-toast">Outreach goes out from your own inbox and your own profile.</div>
        </div>
      )
    },
    {
      num: 3,
      h: "Get a resume that fits the job.",
      p: "Gemini AI rewrites your bullets around the job's keywords and exports an ATS-ready PDF.",
      panel: (() => {
        const C = 2 * Math.PI * 38;
        const dashOffset = C * (1 - atsScore / 100);
        return (
          <div className="hmz-hw-panel">
            <div className="hmz-hw-score">
              <div className="hmz-hw-ring">
                <svg viewBox="0 0 84 84" width="84" height="84">
                  <circle cx="42" cy="42" r="38" fill="none" stroke="#e9e1cf" strokeWidth="7" />
                  <circle cx="42" cy="42" r="38" fill="none" stroke="#f0a81c" strokeWidth="7" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={dashOffset} />
                </svg>
                <b>{atsScore}</b>
              </div>
              <div className="hmz-hw-rt">
                <b>ATS match score</b>
                <small>Before 54 · after tailoring {atsScore}</small>
              </div>
            </div>
            <div className="hmz-hw-bl o">Helped with backend tasks</div>
            <div className="hmz-hw-bl n">Designed Node.js REST APIs serving 40k daily requests</div>
            <div className="hmz-hw-bl o">Fixed bugs in the app</div>
            <div className="hmz-hw-bl n">Resolved 60+ production bugs, lifting test coverage to 85%</div>
          </div>
        );
      })()
    },
    {
      num: 4,
      h: "Apply and reach out.",
      p: "HAMZO fills the form, attaches your PDF, then messages recruiters and hiring managers for a referral.",
      panel: (
        <div className="hmz-hw-panel">
          <div className="hmz-hw-ph">Google · Software Engineer</div>
          {[
            ["Application form filled", 0.3],
            ["Tailored resume attached", 0.9],
            ["3 recruiters found", 1.5],
            ["Referral messages sent", 2.1]
          ].map(([label, delay], idx) => (
            <div key={idx} className="hmz-hw-ck">
              <span className="hmz-hw-tick" style={{ animationDelay: `${delay + 0.4}s` }}>✓</span>
              <div style={{ flex: 1 }}>
                <div style={{ font: "700 14px 'Bricolage Grotesque', sans-serif" }}>{label}</div>
                <div className="hmz-hw-pb">
                  <i style={{ animationDelay: `${delay}s` }} />
                </div>
              </div>
            </div>
          ))}
        </div>
      )
    }
  ];

  const current = STEPS_DATA[activeStep];

  return (
    <div
      className="hmz-hw-card"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className="hmz-hw-arc" />
      <div className="hmz-hw-left">
        <span className="hmz-hw-badge">
          <b>{current.num}</b>STEP {current.num}
        </span>
        <h2>{current.h}</h2>
        <p>{current.p}</p>
        <div className="hmz-hw-dots">
          {STEPS_DATA.map((_, idx) => (
            <button
              key={idx}
              aria-label={`Step ${idx + 1}`}
              className={idx < activeStep ? 'done' : idx === activeStep ? 'active' : ''}
              onClick={() => setActiveStep(idx)}
            >
              {idx === activeStep && (
                <i style={{ animationDuration: `${DUR}ms`, animationPlayState: paused ? 'paused' : 'running' }} />
              )}
            </button>
          ))}
        </div>
      </div>
      <div className="hmz-hw-right" key={activeStep}>
        {current.panel}
      </div>
    </div>
  );
}

/* ================= sections ================= */

function TopBar({ onGetStarted, authed }) {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 16);
    fn();
    window.addEventListener('scroll', fn, { passive: true });
    return () => window.removeEventListener('scroll', fn);
  }, []);

  return (
    /* Floating Capsule Pill Navbar Container */
    <div className={`hmz-topwrap ${scrolled ? 'is-scrolled' : ''}`}>
        <div className="hmz-top">
          <a className="hmz-brand" href="#top"><PawLogo size={28} /><span>HAMZO</span></a>
          <div className="hmz-links">
            <a href="#product">Product</a>
            <a href="#demo">Demo</a>
            <a href="#extension">Extension</a>
            <a href="#workflow">How it works</a>
            <a href="#reviews">Reviews</a>
            <a href="#faq">FAQ</a>
          </div>
          <div className="hmz-topright">
            <MagneticWrap>
              <button className="hmz-cta-purple" onClick={onGetStarted}>
                 Dashboard <ArrowRight size={14} />
              </button>
            </MagneticWrap>
            <button className="hmz-menubtn" aria-label="Menu" onClick={() => setOpen((v) => !v)}>{open ? <X size={18} /> : <Menu size={18} />}</button>
          </div>
        </div>
        {open && (
          <div className="hmz-mobile">
            <a href="#product" onClick={() => setOpen(false)}>Product</a>
            <a href="#demo" onClick={() => setOpen(false)}>Demo</a>
            <a href="#extension" onClick={() => setOpen(false)}>Extension</a>
            <a href="#workflow" onClick={() => setOpen(false)}>How it works</a>
            <a href="#reviews" onClick={() => setOpen(false)}>Reviews</a>
            <a href="#faq" onClick={() => setOpen(false)}>FAQ</a>
             <button className="hmz-cta full" onClick={() => { setOpen(false); onGetStarted(); }}>Dashboard <ArrowRight size={15} /></button>
          </div>
        )}
      </div>
  );
}

function EmailOtpModal({ isOpen, onClose, onSuccess }) {
  const { requestOtp, verifyOtp } = useAuth();
  const [step, setStep] = useState('email');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [devOtp, setDevOtp] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) {
      setStep('email'); setEmail(''); setOtp(''); setDevOtp(''); setError(''); setBusy(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const sendCode = async (event) => {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      const result = await requestOtp(email);
      setDevOtp(result.devOtp || '');
      setStep('otp');
    } catch (err) {
      setError(err.message);
    } finally { setBusy(false); }
  };

  const signIn = async (event) => {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      await verifyOtp(email, otp);
      onSuccess();
    } catch (err) {
      setError(err.message);
    } finally { setBusy(false); }
  };

  return (
    <div className="hmz-auth-overlay" role="dialog" aria-modal="true" aria-labelledby="hmz-auth-title" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="hmz-auth-modal">
        <button className="hmz-auth-close" aria-label="Close sign in" onClick={onClose}><X size={18} /></button>
        <div className="hmz-auth-icon"><Mail size={21} /></div>
        <span className="hmz-kicker">WELCOME TO HAMZO</span>
        <h2 id="hmz-auth-title">{step === 'email' ? 'Get your first referral.' : 'Check your inbox.'}</h2>
        <p>{step === 'email' ? 'Enter your email and we’ll send a secure one-time code.' : <>We sent a 6-digit code to <b>{email}</b>.</>}</p>

        {error && <div className="hmz-auth-error" role="alert">{error}</div>}
        {step === 'email' ? (
          <form onSubmit={sendCode}>
            <label htmlFor="hmz-email">Email address</label>
            <input id="hmz-email" type="email" autoComplete="email" placeholder="you@example.com" value={email} onChange={(event) => setEmail(event.target.value)} required autoFocus />
            <button className="hmz-auth-submit" disabled={busy}>{busy ? 'Sending code…' : 'Get OTP'} <ArrowRight size={16} /></button>
          </form>
        ) : (
          <form onSubmit={signIn}>
            <label htmlFor="hmz-otp">One-time password</label>
            <input id="hmz-otp" className="hmz-otp-input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="000000" value={otp} onChange={(event) => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))} required autoFocus />
            {devOtp && <div className="hmz-dev-otp">Local dev code: <b>{devOtp}</b></div>}
            <button className="hmz-auth-submit" disabled={busy || otp.length !== 6}>{busy ? 'Signing in…' : 'Sign in'} <ArrowRight size={16} /></button>
            <button type="button" className="hmz-auth-back" onClick={() => { setStep('email'); setError(''); setDevOtp(''); }}>Use a different email</button>
          </form>
        )}
        <small className="hmz-auth-note">No password needed · Your code expires in 10 minutes</small>
      </div>
    </div>
  );
}

function Hero({ onGetStarted, onOpen }) {
  const [statsRef, statsVisible] = useStagger();
  const cRoles = useCountUp(5, statsVisible, 900);
  const cInvites = useCountUp(10, statsVisible, 900);
  const cSync = useCountUp(15, statsVisible, 1100);
  const cFormats = useCountUp(3, statsVisible, 900);

  // Parallax for floating badges
  const heroRef = useRef(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const onMouse = useCallback((e) => {
    if (!heroRef.current) return;
    const rect = heroRef.current.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    setOffset({ x: (mx - cx) / cx, y: (my - cy) / cy });
  }, []);

  // Living agent-activity loop
  const CYCLE = [
    { icon: <Search size={14} />, t: 'Reading Agentic AI Intern posting…' },
    { icon: <Sparkles size={14} />, t: '98% match · resume tailored' },
    { icon: <Send size={14} />, t: '3 referrals sent with notes' },
    { icon: <Bell size={14} />, t: 'Follow-up scheduled · autopilot on' },
  ];
  const [cyc, setCyc] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setCyc((c) => (c + 1) % CYCLE.length), 2600);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="hmz-hero" id="top" ref={heroRef} onMouseMove={onMouse}>
      <SunLight px={offset.x} py={offset.y} />
      <ShimmerCanvas mouseX={offset.x} mouseY={offset.y} />
      <div className="hmz-heroinner">
        <div className="hmz-chips">
          <span className="hmz-chip black"><Sparkles size={13} /> AI referral agent</span>
          <span className="hmz-chip ghost">Not a job board</span>
          <span className="hmz-chip ghost">60-second setup</span>
        </div>
        <h1>Get referrals,<br />not <span className="hmz-accent-blue">ghosting.</span></h1>
        <p className="hmz-sub">HAMZO is your AI referral agent — it finds the right people inside target companies and gets your resume in front of them, so real recruiters reply. Your entire job search in one place.</p>
        <div className="hmz-actions">
          <MagneticWrap strength={0.4}>
            <button className="hmz-cta big" onClick={onGetStarted}>Get my first referral <ArrowUpRight size={16} /></button>
          </MagneticWrap>
          <a className="hmz-textlink" href="#workflow">See how it works <ArrowRight size={15} /></a>
        </div>
        <div className="hmz-proof">
          <div className="hmz-avatars">{['PS', 'AK', 'SJ', 'DK', '+'].map((t, i) => <span key={i} className={`hmz-av a${i}`}>{t}</span>)}</div>
          <span>Free to start · No credit card · Chrome extension included</span>
        </div>

        <HowItWorksCard />

        <div className={`hmz-stats ${statsVisible ? 'in-view' : ''}`} ref={statsRef}>
          {[
            [`${cRoles}`, 'Role filters per campaign'],
            [`${cInvites}`, 'Invites per role filter'],
            [`${cSync} min`, 'LinkedIn auto-sync'],
            [`${cFormats}`, 'Resume PDF formats'],
          ].map(([v, l]) => (
            <div key={l} className="hmz-stat"><b>{v}</b><span>{l}</span></div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* Company logo marquee (Nyeras-style trust band) */
const PLACED_AT = [
  ['Microsoft', 'microsoft.png'],
  ['Google', 'google.png'],
  ['Amazon', 'amazon.png'],
  ['Salesforce', 'salesforce.png'],
  ['Adobe', 'adobe.png'],
  ['Deloitte', 'deloitte.png'],
  ['Accenture', 'accenture.png'],
  ['Infosys', 'infosys.png'],
  ['TCS', 'tcs.jpg'],
  ['Wipro', 'wipro.png'],
  ['PayPal', 'paypal.png'],
  ['Cognizant', 'cognizant.jpg'],
];

function CompanyMark({ logo }) {
  return (
    <span className="hmz-companymark" aria-hidden="true">
      <img src={`/company-logos/${logo}`} alt="" loading="lazy" />
    </span>
  );
}

function LogoMarquee() {
  const [ref, visible] = useReveal();
  return (
    <section className={`hmz-logostrip ${visible ? 'in-view' : ''}`} ref={ref} aria-label="Companies our members get referrals into">
      <p className="hmz-logostrip-head">Our members get referrals inside teams at</p>
      <div className="hmz-logomq">
        <div className="hmz-logomq-track">
          {[...PLACED_AT, ...PLACED_AT].map(([name, logo], i) => (
            <span className="hmz-logocell" key={i} title={name}>
              <CompanyMark logo={logo} />
              <b className="hmz-logotxt">{name}</b>
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

function Integrations() {
  return (
    <>
      <WaveDivider color="#f7f9ff" />
      <div className="hmz-strip">
        <p><b>We are not a job board — we plug into all of them.</b> Works wherever you already apply. Same one-click flow.</p>
        <div className="hmz-logos"><div>{[...INTEGRATIONS, ...INTEGRATIONS].map((t, i) => <span key={i}>{t}</span>)}</div></div>
      </div>
      <WaveDivider color="#f7f9ff" flip />
    </>
  );
}

/* Scroll-driven resume optimizer */
const SR_STEPS = [
  { n: '01', title: 'Tell HAMZO who you are', desc: 'Profile, skills, resume and target roles — one 60-second setup.' },
  { n: '02', title: 'Match + tailor per job', desc: 'Each posting gets a match score and a one-page tailored resume.' },
  { n: '03', title: 'Outreach on autopilot', desc: 'Referrals, invites and follow-ups run while you track everything.' },
];
function ScrollResume({ onOpen }) {
  const secRef = useRef(null);
  const [prog, setProg] = useState(0);
  useEffect(() => {
    const onScroll = () => {
      const el = secRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const total = Math.max(1, r.height - window.innerHeight);
      const p = Math.min(1, Math.max(0, -r.top / total));
      setProg((prev) => (Math.abs(prev - p) > 0.002 ? p : prev));
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => { window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll); };
  }, []);
  const step = prog < 0.34 ? 0 : prog < 0.67 ? 1 : 2;
  const hl = (i) => prog > 0.12 + i * 0.1;
  return (
    <div className="hmz-sr" id="resume" ref={secRef}>
      <div className="hmz-sr-sticky">
        <div className="hmz-sr-copy">
          <span className="hmz-kicker">RESUME OPTIMIZER</span>
          <h2>Optimizing your resume<br />as you <em>scroll.</em></h2>
          <div className="hmz-sr-steps">
            {SR_STEPS.map((s, i) => (
              <div key={s.n} className={`hmz-sr-step ${i === step ? 'on' : ''}`}>
                <span>{s.n}</span>
                <div><b>{s.title}</b><p>{s.desc}</p></div>
              </div>
            ))}
          </div>
          <MagneticWrap>
            <button className="hmz-cta" onClick={() => onOpen('/dashboard/resume')}>Tailor my resume <ArrowRight size={15} /></button>
          </MagneticWrap>
        </div>
        <div className="hmz-sr-visual">
          <span className="hmz-sr-blob" style={{ transform: `translateX(${prog * 90 - 45}px)` }} />
          <TiltCard className="hmz-sr-card" maxTilt={4} style={{ transform: `translateY(${(1 - prog) * 36}px) rotate(${(1 - prog) * 1.5}deg)` }}>
            <div className="hmz-sr-job"><span className="hmz-cmark sm">A</span><div><small>Angel One · 2 mins ago</small><b>Agentic AI Intern</b></div><span className="hmz-match sm">98%</span></div>
            <div className="hmz-sr-doc">
              <b className="hmz-sr-name">Arjun Kumar</b>
              <small className="hmz-sr-contact">Bengaluru · arjun@mail.com · github.com/arjun</small>
              <p className="hmz-sr-sec">SUMMARY</p>
              <p className="hmz-sr-text">
                Product-focused engineer building <span className={hl(0) ? 'hl on' : 'hl'}>AI-powered</span> apps with <span className={hl(1) ? 'hl on' : 'hl'}>LLM integrations</span> and <span className={hl(4) ? 'hl on' : 'hl'}>production-ready</span> APIs. Strong in <span className={hl(2) ? 'hl on' : 'hl'}>Python</span>, <span className={hl(3) ? 'hl on' : 'hl'}>FastAPI</span> and <span className={hl(5) ? 'hl on' : 'hl'}>SQL</span> with measurable product impact.
              </p>
              <p className="hmz-sr-sec">CORE SKILLS</p>
              <p className="hmz-sr-text small">
                Languages: <span className={hl(2) ? 'hl on' : 'hl'}>Python</span>, JavaScript, <span className={hl(5) ? 'hl on' : 'hl'}>SQL</span> ·
                Backend: <span className={hl(3) ? 'hl on' : 'hl'}>FastAPI</span>, <span className={hl(4) ? 'hl on' : 'hl'}>REST APIs</span> ·
                AI: <span className={hl(1) ? 'hl on' : 'hl'}>LLM integrations</span>, agents
              </p>
              <div className="hmz-sr-bar"><i style={{ width: `${Math.round(prog * 100)}%` }} /><b>{Math.round(72 + prog * 26)}% ATS</b></div>
            </div>
          </TiltCard>
        </div>
      </div>
    </div>
  );
}

function Pillars({ onOpen }) {
  const [ref, visible] = useReveal();
  const [gridRef, gridVisible] = useStagger();
  return (
    <div className="hmz-section" id="product" ref={ref}>
      <div className={`hmz-head ${visible ? 'show' : ''}`}>
        <span className="hmz-kicker">THE PLATFORM</span>
        <h2>Your entire job search<br />in <em>one place.</em></h2>
        <p>Job matches, copilot extension, resume builder and tracker — one workspace, free to start.</p>
      </div>
      <div className={`hmz-grid ${gridVisible ? 'in-view' : ''}`} ref={gridRef}>
        {PILLARS.map((f) => (
          <TiltCard key={f.name} className={`hmz-card tint-${f.tint}`} maxTilt={4}>
            <div className="hmz-cardicon">{f.icon}</div>
            <small className="hmz-pillarname">{f.name}</small>
            <h3>{f.title}</h3>
            <p>{f.desc}</p>
            <ul>{f.points.map((p) => <li key={p}><Check size={13} />{p}</li>)}</ul>
            <button className="hmz-cardbtn" onClick={() => onOpen(f.route)}>{f.cta} <ArrowRight size={14} /></button>
          </TiltCard>
        ))}
      </div>
    </div>
  );
}

function ExtensionSpot({ onOpen }) {
  const [ref, visible] = useReveal();
  return (
    <div className="hmz-ext" id="extension" ref={ref}>
      <div className={`hmz-extinner ${visible ? 'show' : ''}`}>
        <div>
          <span className="hmz-kicker">COPILOT EXTENSION</span>
          <h2>Meet your AI copilot for the job search.</h2>
          <p>Hamzo Apply autofills applications, attaches your tailored resume, asks about unknown fields — and remembers the answers in your vault for next time.</p>
          <ul className="hmz-checks">
            <li><CheckCircle2 size={16} /> Description page? It clicks Apply itself and continues</li>
            <li><CheckCircle2 size={16} /> Login walls, CAPTCHAs? It pauses and tells you exactly what to do</li>
            <li><CheckCircle2 size={16} /> Confirms with you before anything is submitted</li>
          </ul>
          <div className="hmz-actions">
            <MagneticWrap>
              <button className="hmz-cta big" onClick={() => onOpen('/dashboard/resume')}><Globe size={16} /> Get the extension — it's free</button>
            </MagneticWrap>
          </div>
          <small className="hmz-note">Load unpacked via chrome://extensions · 60-second setup</small>
        </div>
        <TiltCard className="hmz-extmock" maxTilt={5}>
          <div className="hmz-mockbar"><span /><span /><span /></div>
          <div className="hmz-mockrow"><FileText size={16} /><div><b>Arjun_AngelOne.pdf</b><span>Tailored · 98% match</span></div><Check size={15} /></div>
          <div className="hmz-mockrow"><AtSign size={15} /><div><b>Project link filled</b><span>From your vault — no asking twice</span></div><Check size={15} /></div>
          <div className="hmz-mockrow"><Send size={14} /><div><b>Ready to submit</b><span>Waiting for your confirmation</span></div></div>
          <div className="hmz-mockbtns"><span className="yes">✓ Submit</span><span>👁 Review</span></div>
        </TiltCard>
      </div>
    </div>
  );
}

function Compare() {
  const [ref, visible] = useReveal();
  const [cmpRef, cmpVisible] = useStagger();
  return (
    <div className="hmz-section" ref={ref}>
      <div className={`hmz-head center ${visible ? 'show' : ''}`}>
        <span className="hmz-kicker">WHY IT WORKS</span>
        <h2>Manual grind vs <em>HAMZO agent.</em></h2>
      </div>
      <div className={`hmz-compare ${cmpVisible ? 'in-view' : ''}`} ref={cmpRef}>
        <div className="hmz-cmp pain">
          <h3>Manual job hunt</h3>
          <ul>
            <li>Hours searching, tailoring, tracking in spreadsheets</li>
            <li>ATS bot rejects your resume before a human reads it</li>
            <li>1–2 hrs to find the right referral contacts per company</li>
            <li>Follow-ups forgotten once you get busy</li>
          </ul>
        </div>
        <div className="hmz-cmp gain">
          <h3>With HAMZO agent</h3>
          <ol>
            <li><b>Send and track referrals</b> effortlessly in one place</li>
            <li><b>Skip the ATS queue</b> — reach hiring managers directly</li>
            <li><b>Under 60 seconds per job</b> after a one-time setup</li>
            <li><b>Automated follow-ups</b> until they answer</li>
          </ol>
        </div>
      </div>
    </div>
  );
}

function Setup({ onOpen }) {
  const [gridRef, gridVisible] = useStagger();
  return (
    <div className="hmz-setup">
      <div className="hmz-head center show">
        <span className="hmz-kicker">SETUP</span>
        <h2>Configure in less than <em>60 seconds.</em></h2>
      </div>
      <div className={`hmz-setupgrid ${gridVisible ? 'in-view' : ''}`} ref={gridRef}>
        <TiltCard className="hmz-setupcard" maxTilt={3}>
          <div className="hmz-cardicon"><Mail size={20} /></div>
          <h3>Gmail — any Gmail works</h3>
          <p>Send referral resumes directly to recruiters' official inboxes.</p>
          <ul>
            <li><Check size={13} /> OAuth or App Password</li>
            <li><Check size={13} /> Disconnect anytime — your control</li>
          </ul>
          <button className="hmz-cardbtn" onClick={() => onOpen('/dashboard/mail')}>Enable email outreach <ArrowRight size={14} /></button>
        </TiltCard>
        <TiltCard className="hmz-setupcard" maxTilt={3}>
          <div className="hmz-cardicon"><Briefcase size={20} /></div>
          <h3>LinkedIn — no Premium needed</h3>
          <p>Auto-send connection requests with personal notes to target companies.</p>
          <ul>
            <li><Check size={13} /> Login popup or li_at cookie</li>
            <li><Check size={13} /> Gmail alone works — LinkedIn doubles replies</li>
          </ul>
          <button className="hmz-cardbtn" onClick={() => onOpen('/dashboard/linkedin')}>Connect LinkedIn <ArrowRight size={14} /></button>
        </TiltCard>
      </div>
    </div>
  );
}

function Workflow() {
  const [step, setStep] = useState(0);
  const [paused, setPaused] = useState(false);
  const [ref, visible] = useReveal();
  useEffect(() => {
    if (paused) return;
    const id = window.setInterval(() => setStep((s) => (s + 1) % STEPS.length), 3400);
    return () => window.clearInterval(id);
  }, [paused]);
  return (
    <div className="hmz-work" id="workflow" ref={ref} onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      <div className={`hmz-head center light ${visible ? 'show' : ''}`}>
        <span className="hmz-kicker light">HOW IT WORKS</span>
        <h2>One click. Automated referrals. <em>More interviews.</em></h2>
      </div>
      <div className="hmz-steps">
        {STEPS.map((s, i) => (
          <StepCard key={s.n} onClick={() => setStep(i)} className={`hmz-step ${i === step ? 'on' : ''}`}>
            <span className="hmz-stepn">{s.n}</span>
            <span className="hmz-steptag">{s.tag}</span>
            <b>{s.title}</b>
            <p>{s.desc}</p>
          </StepCard>
        ))}
      </div>
    </div>
  );
}

function RevCard({ r }) {
  return (
    <article className="hmz-mq-card">
      <div className="hmz-mq-stars">
        {[0, 1, 2, 3, 4].map((i) => <Star key={i} size={13} fill="#FFC531" color="#FFC531" />)}
      </div>
      <p>"{r.text}"</p>
      <div className="hmz-revtop"><span className="hmz-ravatar" style={{ background: r.tint }}>{r.initials}</span><div><b>{r.name}</b><small>{r.role}</small></div></div>
    </article>
  );
}

function Reviews() {
  const rowA = [...REVIEWS.slice(0, 4), ...REVIEWS.slice(0, 4)];
  const rowB = [...REVIEWS.slice(4), ...REVIEWS.slice(4)];
  const [ref, visible] = useReveal();
  return (
    <div className="hmz-mq" id="reviews" ref={ref}>
      <div className={`hmz-head center light ${visible ? 'show' : ''}`}>
        <span className="hmz-kicker light">WALL OF LOVE</span>
        <h2>Loved by people doing<br /><em>serious</em> job search.</h2>
        <p className="hmz-mq-sub">Real workflows, real replies, real interviews.</p>
      </div>
      <div className="hmz-mq-rows">
        <div className="hmz-mq-row"><div className="hmz-mq-track">{rowA.map((r, i) => <RevCard key={`${r.name}-${i}`} r={r} />)}</div></div>
        <div className="hmz-mq-row rev"><div className="hmz-mq-track">{rowB.map((r, i) => <RevCard key={`${r.name}-${i}`} r={r} />)}</div></div>
      </div>
    </div>
  );
}

function FreeBand({ onGetStarted }) {
  return (
    <div className="hmz-free">
      <div className="hmz-freeinner">
        <span className="hmz-kicker">PRICING</span>
        <h2>Start free. <em>Pay nothing to start.</em></h2>
        <div className="hmz-freeticks">
          {['Unlimited job links + match scores', 'AI resume tailor (3 formats)', 'Gmail + LinkedIn outreach', 'Application tracker + vault', 'No credit card · Disconnect anytime'].map((t) => (
            <span key={t}><Check size={14} />{t}</span>
          ))}
        </div>
        <MagneticWrap strength={0.4}>
          <button className="hmz-cta big yellow" onClick={onGetStarted}>Get my first referral <ArrowUpRight size={16} /></button>
        </MagneticWrap>
      </div>
    </div>
  );
}

function Faq() {
  const [open, setOpen] = useState(0);
  return (
    <div className="hmz-faq" id="faq">
      <div><span className="hmz-kicker">FAQ</span><h2>Questions before<br />you <em>start?</em></h2></div>
      <div className="hmz-acc">
        {FAQS.map(([q, a], i) => (
          <article key={q} className={open === i ? 'open' : ''}>
            <button onClick={() => setOpen(open === i ? -1 : i)}>{q}<ChevronDown size={17} /></button>
            <p>{a}</p>
          </article>
        ))}
      </div>
    </div>
  );
}

function FinalCta({ onGetStarted }) {
  return (
    <div className="hmz-final" id="cta">
      <div className="hmz-finalinner">
        <span className="hmz-kicker light">GET STARTED</span>
        <h2>Stop getting ghosted.<br />Get your first <em>referral today.</em></h2>
        <p>An agent that gets your resume in front of humans — and follows up until they answer.</p>
        <MagneticWrap strength={0.4}>
          <button className="hmz-cta big yellow" onClick={onGetStarted}>Get started — it's free <ArrowUpRight size={16} /></button>
        </MagneticWrap>
      </div>
    </div>
  );
}

function Footer() {
  return (
    <footer className="hmz-nyeras-footer">
      <div className="hmz-footer-wrap">

        {/* Card 1: Site Map, Address & Navigation Columns */}
        <div className="hmz-fcard main-card">
          {/* Col 1: Title */}
          <div className="hmz-fcol-title">
            <span className="hmz-ftitle-lbl">SITE MAP</span>
            <h2 className="hmz-fhead">Find all our<br />links here</h2>
          </div>

          {/* Col 2: Address */}
          <div className="hmz-fcol-address">
            <span className="hmz-fsub-lbl">MEET FOR A COFFEE HERE</span>
            <p className="hmz-faddress">
              HAMZO AI Technologies<br />
              HSR Layout, 27th Main Rd, Sector 1,<br />
              Bengaluru, Karnataka 560102
            </p>
          </div>

          {/* Col 3: Legal */}
          <div className="hmz-fcol">
            <span className="hmz-fcol-hdr">LEGAL</span>
            <a href="#privacy">Privacy Policy</a>
            <a href="#terms">Terms and Conditions</a>
            <a href="#cancellation">Cancellation & Refund Policy</a>
          </div>

          {/* Col 4: Explore */}
          <div className="hmz-fcol">
            <span className="hmz-fcol-hdr">EXPLORE</span>
            <a href="#about">About</a>
            <a href="#contact">Contact Us</a>
          </div>

          {/* Col 5: Programs */}
          <div className="hmz-fcol">
            <span className="hmz-fcol-hdr">PROGRAMS</span>
            <a href="#product">All Programs</a>
            <a href="#pricing">Pricing Plans</a>
          </div>

          {/* Col 6: Company */}
          <div className="hmz-fcol">
            <span className="hmz-fcol-hdr">COMPANY</span>
            <a href="#about">About Us</a>
            <a href="#blog">Blog & Resources</a>
          </div>
        </div>

        {/* Card 2: Social Media Bar */}
        <div className="hmz-fcard social-card">
          <div className="hmz-fsocial-left">
            <span className="hmz-find-lbl">Find us on <span className="hmz-heart">♡</span></span>
            <h3 className="hmz-social-title">social media</h3>
          </div>

          <div className="hmz-fsocial-pills">
            <a href="https://linkedin.com" target="_blank" rel="noreferrer" className="hmz-spill">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14m-.5 15.5v-5.3a3.26 3.26 0 0 0-3.26-3.26c-.85 0-1.84.52-2.28 1.3v-1.11h-2.79v8.37h2.79v-4.93c0-.77.62-1.4 1.39-1.4a1.4 1.4 0 0 1 1.4 1.4v4.93h2.75M6.46 10.9v8.37H9.25V10.9H6.46M7.86 6.72a1.49 1.49 0 1 0 0 2.98 1.49 1.49 0 0 0 0-2.98z"/></svg> LinkedIn
            </a>
            <a href="mailto:support@hamzo.ai" className="hmz-spill">
              <Mail size={15} /> Mail
            </a>
            <a href="https://twitter.com" target="_blank" rel="noreferrer" className="hmz-spill">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg> X
            </a>
            <a href="https://instagram.com" target="_blank" rel="noreferrer" className="hmz-spill">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg> Instagram
            </a>
            <a href="https://facebook.com" target="_blank" rel="noreferrer" className="hmz-spill">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg> Facebook
            </a>
          </div>
        </div>

        {/* Card 3: Copyright & Policy Links Bar */}
        <div className="hmz-fcard bottom-card">
          <div className="hmz-copy-text">
            © HAMZO 2024 - 2026
          </div>
          <div className="hmz-bottom-links">
            <a href="#user-agreement">User Agreement</a>
            <a href="#terms">Terms and Condition</a>
            <a href="#privacy">Privacy policy</a>
          </div>
        </div>

        {/* Card 4: Massive Watermark Brand Typography at bottom */}
        <div className="hmz-footer-watermark" aria-hidden="true">
          HAMZO
        </div>

      </div>
    </footer>
  );
}

export default function Landing() {
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const [showAuthModal, setShowAuthModal] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => setLoading(false), 900);
    return () => window.clearTimeout(t);
  }, []);

  const go = useCallback((route) => {
    if (route && isAuthenticated) navigate(route);
    else if (isAuthenticated) navigate('/dashboard');
    else setShowAuthModal(true);
  }, [navigate, isAuthenticated]);

  return (
    <div className="hmz-page">
      <div className="hmz-ambient" aria-hidden="true"><i className="b1" /><i className="b2" /><i className="b3" /><i className="b4" /></div>
      <VideoLoader isLoading={loading} maxWaitMs={2200} fadeDurationMs={350} />
      <TopBar onGetStarted={() => go()} authed={isAuthenticated} />
      <EmailOtpModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} onSuccess={() => { setShowAuthModal(false); navigate('/dashboard'); }} />
      <main>
        <Hero onGetStarted={() => go()} onOpen={(r) => go(isAuthenticated ? r : undefined)} />
        <LogoMarquee />
        <Integrations />
        <ScrollResume onOpen={(r) => go(isAuthenticated ? r : undefined)} />
        <Pillars onOpen={(r) => go(isAuthenticated ? r : undefined)} />
        <ExtensionSpot onOpen={(r) => go(isAuthenticated ? r : undefined)} />
        <Compare />
        <Setup onOpen={(r) => go(isAuthenticated ? r : undefined)} />
        <WaveDivider color="#0B1533" />
        <Workflow />
        <Reviews />
        <FreeBand onGetStarted={() => go()} />
        <Faq />
        <FinalCta onGetStarted={() => go()} />
        <Footer />
      </main>
    </div>
  );
}
