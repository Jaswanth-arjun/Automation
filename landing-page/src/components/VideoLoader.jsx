import React, { useEffect, useRef, useState } from 'react';

export default function VideoLoader({ isLoading, fadeDurationMs = 450, maxWaitMs = 15000 }) {
  const [overlayMounted, setOverlayMounted] = useState(true);
  const [firstPassDone, setFirstPassDone] = useState(false);
  const videoRef = useRef(null);
  const firstPassRef = useRef(false);

  useEffect(() => {
    const video = videoRef.current;
    if (video) video.muted = true;

    if (isLoading) {
      setOverlayMounted(true);
      video?.play().catch(() => {});
      return;
    }

    if (!firstPassDone) return;

    const timer = window.setTimeout(() => {
      setOverlayMounted(false);
      video?.pause();
    }, fadeDurationMs);
    return () => window.clearTimeout(timer);
  }, [isLoading, fadeDurationMs, firstPassDone]);

  useEffect(() => {
    const fallback = window.setTimeout(() => {
      if (!firstPassRef.current) {
        firstPassRef.current = true;
        setFirstPassDone(true);
      }
    }, maxWaitMs);
    return () => window.clearTimeout(fallback);
  }, [maxWaitMs]);

  useEffect(() => {
    if (overlayMounted) {
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
  }, [overlayMounted]);

  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (!video || firstPassRef.current || !video.duration) return;
    if (video.currentTime >= video.duration - 0.1) {
      firstPassRef.current = true;
      setFirstPassDone(true);
    }
  };

  const show = isLoading || !firstPassDone;

  return (
    <div
      aria-hidden={!show}
      aria-label="Loading"
      role="status"
      className={`video-loader ${show ? 'show' : 'hide'}`}
      style={{ transitionDuration: `${fadeDurationMs}ms`, visibility: overlayMounted ? 'visible' : 'hidden' }}
    >
      <video
        ref={videoRef}
        src="/hamster-loader.mp4"
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        disablePictureInPicture
        controlsList="nodownload nofullscreen noremoteplayback"
        onTimeUpdate={handleTimeUpdate}
      />
    </div>
  );
}
