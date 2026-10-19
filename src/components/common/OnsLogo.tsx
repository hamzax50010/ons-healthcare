import React, { useState, useEffect } from 'react';

export type OnsLogoVariant =
  | 'color'          // Official Color on light background (/assets/branding/ons-logo)
  | 'reversed'       // Official Reversed on dark background (/assets/branding/ons-logo-reversed)
  | 'symbol'         // Official Standalone mark / icon (/assets/branding/ons-symbol)
  | 'favicon'        // Official Favicon (/assets/branding/favicon)
  | 'symbol-reversed'
  | 'horizontal'
  | 'horizontal-reversed';

export interface OnsLogoProps {
  variant?: OnsLogoVariant | string;
  src?: string;
  className?: string;
  height?: number | string;
  width?: number | string;
  alt?: string;
  fallbackVariant?: OnsLogoVariant;
  timestamp?: number;
}

export const OnsLogo: React.FC<OnsLogoProps> = ({
  variant = 'color',
  src,
  className = '',
  height,
  width,
  alt = 'أُنس للرعاية الصحية | ONS Healthcare',
  timestamp,
}) => {
  const isDarkVariant =
    variant === 'reversed' ||
    variant === 'symbol-reversed' ||
    variant === 'horizontal-reversed';

  const isSymbolVariant =
    variant === 'symbol' ||
    variant === 'favicon' ||
    variant === 'symbol-reversed';

  // Base fallback candidate paths
  const candidateBases = isSymbolVariant
    ? ['/assets/branding/ons-symbol', '/assets/branding/favicon', '/logos/ons-symbol']
    : isDarkVariant
    ? ['/assets/branding/ons-logo-reversed', '/logos/ons-logo-reversed']
    : ['/assets/branding/ons-logo', '/logos/ons-logo'];

  const extensions = ['.png', '.svg', '.webp', '.ico'];

  const [candidateIndex, setCandidateIndex] = useState(0);
  const [extIndex, setExtIndex] = useState(0);
  const [srcFailed, setSrcFailed] = useState(false);

  useEffect(() => {
    setCandidateIndex(0);
    setExtIndex(0);
    setSrcFailed(false);
  }, [variant, src, timestamp]);

  const isValidSrc =
    src &&
    !srcFailed &&
    (src.startsWith('/assets/') || src.startsWith('/logos/') || (src.startsWith('/') && !src.startsWith('data:')));

  const baseSrc = isValidSrc
    ? src
    : candidateBases[candidateIndex] + extensions[extIndex];

  const effectiveSrc = timestamp
    ? baseSrc.includes('?')
      ? `${baseSrc}&t=${timestamp}`
      : `${baseSrc}?t=${timestamp}`
    : baseSrc;

  const handleError = () => {
    if (isValidSrc) {
      // Direct src failed, switch to static asset fallbacks immediately
      setSrcFailed(true);
      setCandidateIndex(0);
      setExtIndex(0);
    } else if (extIndex < extensions.length - 1) {
      setExtIndex((prev) => prev + 1);
    } else if (candidateIndex < candidateBases.length - 1) {
      setCandidateIndex((prev) => prev + 1);
      setExtIndex(0);
    }
  };

  return (
    <img
      src={effectiveSrc}
      alt={alt}
      className={`object-contain max-h-full max-w-full select-none bg-transparent ${className}`}
      style={{ height, width }}
      loading="eager"
      decoding="async"
      onError={handleError}
    />
  );
};
