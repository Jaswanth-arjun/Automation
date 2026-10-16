import React from 'react';

export default function PawLogo({ size = 30 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none">
      <circle cx="32" cy="32" r="26.5" stroke="#F2AE6B" strokeWidth="4.5" strokeLinecap="round" strokeDasharray="116 14 42 14" transform="rotate(-55 32 32)" fill="none" />
      <path d="M32 36c7.5 0 13.5 5.1 13.5 11.1 0 4.6-3.2 7.9-7.8 7.9-2.4 0-3.9-1-5.7-1s-3.3 1-5.7 1c-4.6 0-7.8-3.3-7.8-7.9C18.5 41.1 24.5 36 32 36z" fill="#F28B95" />
      <ellipse cx="18" cy="35.5" rx="4.6" ry="5.8" transform="rotate(-20 18 35.5)" fill="#F28B95" />
      <ellipse cx="26.5" cy="26.5" rx="5" ry="6.3" transform="rotate(-8 26.5 26.5)" fill="#F28B95" />
      <ellipse cx="37.5" cy="26.5" rx="5" ry="6.3" transform="rotate(8 37.5 26.5)" fill="#F28B95" />
      <ellipse cx="46" cy="35.5" rx="4.6" ry="5.8" transform="rotate(20 46 35.5)" fill="#F28B95" />
      <path d="M0 4.2C-2.1 2.8-2.9.4-1.8-1.6-0.7-3.4 1.9-3.4 3-1.5 4 .6 2.3 3 0 4.2Z" transform="translate(14.5 27) rotate(-38)" fill="#6E4B33" />
      <path d="M0 4.2C-2.1 2.8-2.9.4-1.8-1.6-0.7-3.4 1.9-3.4 3-1.5 4 .6 2.3 3 0 4.2Z" transform="translate(24.5 18.5) rotate(-14)" fill="#6E4B33" />
      <path d="M0 4.2C-2.1 2.8-2.9.4-1.8-1.6-0.7-3.4 1.9-3.4 3-1.5 4 .6 2.3 3 0 4.2Z" transform="translate(39.5 18.5) rotate(14)" fill="#6E4B33" />
      <path d="M0 4.2C-2.1 2.8-2.9.4-1.8-1.6-0.7-3.4 1.9-3.4 3-1.5 4 .6 2.3 3 0 4.2Z" transform="translate(49.5 27) rotate(38)" fill="#6E4B33" />
      <ellipse cx="24.4" cy="24.2" rx="1.5" ry="2.3" transform="rotate(-24 24.4 24.2)" fill="#FFFFFF" opacity="0.85" />
      <ellipse cx="35.6" cy="24.2" rx="1.5" ry="2.3" transform="rotate(20 35.6 24.2)" fill="#FFFFFF" opacity="0.85" />
      <ellipse cx="27" cy="42.5" rx="1.9" ry="3.2" transform="rotate(-28 27 42.5)" fill="#FFFFFF" opacity="0.7" />
    </svg>
  );
}
