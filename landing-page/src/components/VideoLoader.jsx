import React, { useEffect, useRef, useState } from 'react';

/**
 * Hamzo Native DOM Mascot Loader
 * Fully merges the mascot into the DOM without rectangular video borders.
 * Displays a premium loader with ambient aura and brand progress track
 * strictly for the actual loading time only.
 */
export default function VideoLoader({ isLoading, fadeDurationMs = 260, text = 'Loading workspace' }) {
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
      <div className="loader-core">
        {/* Soft ambient brand aura */}
        <div className="loader-ambient-glow" aria-hidden="true" />

        {/* Mascot frame with radial feather mask */}
        <div className="loader-mascot-frame">
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

        {/* Micro Loader UI: Progress shimmer track and status */}
        <div className="loader-indicator">
          <div className="loader-track">
            <div className="loader-shimmer-bar" />
          </div>
          <div className="loader-caption">
            <span>{text}</span>
            <span className="loader-dots" />
          </div>
        </div>
      </div>
    </div>
  );
}
