import React, { useEffect, useRef, useState } from 'react';

/**
 * Hamzo Loop Video Loader
 * Displays the mascot typing animation in a continuous loop during actual loading time only.
 * Dismisses immediately when isLoading becomes false without any artificial delays.
 */
export default function VideoLoader({ isLoading, fadeDurationMs = 260 }) {
  const [mounted, setMounted] = useState(Boolean(isLoading));
  const [visible, setVisible] = useState(Boolean(isLoading));
  const videoRef = useRef(null);

  useEffect(() => {
    const video = videoRef.current;
    if (video) video.muted = true;

    if (isLoading) {
      setMounted(true);
      requestAnimationFrame(() => setVisible(true));
      video?.play().catch(() => {});
    } else {
      // Dismiss immediately according to actual loader time (no waiting for video loop)
      setVisible(false);
      const timer = window.setTimeout(() => {
        setMounted(false);
        video?.pause();
      }, fadeDurationMs);
      return () => window.clearTimeout(timer);
    }
  }, [isLoading, fadeDurationMs]);

  useEffect(() => {
    if (mounted && visible) {
      document.documentElement.style.overflow = 'hidden';
      document.body.style.overflow = 'hidden';
    } else {
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
    }
    return () => {
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
    };
  }, [mounted, visible]);

  if (!mounted && !isLoading) {
    return null;
  }

  return (
    <div
      aria-hidden={!visible}
      aria-label="Loading"
      role="status"
      className={`video-loader ${visible ? 'show' : 'hide'}`}
      style={{
        transitionDuration: `${fadeDurationMs}ms`,
        visibility: mounted ? 'visible' : 'hidden',
      }}
    >
      <video
        ref={videoRef}
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        disablePictureInPicture
        controlsList="nodownload nofullscreen noremoteplayback"
      >
        <source src="/hamzo-loader.mp4" type="video/mp4" />
        <source src="/hamster-loader.mp4" type="video/mp4" />
      </video>
    </div>
  );
}
