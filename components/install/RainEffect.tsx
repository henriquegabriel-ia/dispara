'use client';

import { useEffect, useState, useMemo } from 'react';

interface RainDrop {
  id: number;
  left: number;
  height: number;
  duration: number;
  delay: number;
}

interface RainEffectProps {
  dropCount?: number;
  className?: string;
}

/**
 * Efeito de chuva estilo Blade Runner.
 * Cria partículas verticais caindo com variação de velocidade e posição.
 */
export function RainEffect({ dropCount = 50, className = '' }: RainEffectProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const drops = useMemo<RainDrop[]>(() => {
    return Array.from({ length: dropCount }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      height: 20 + Math.random() * 80,
      duration: 3 + Math.random() * 4,
      delay: Math.random() * 5,
    }));
  }, [dropCount]);

  if (!mounted) return null;

  return (
    <div className={`br-rain-container ${className}`}>
      {drops.map((drop) => (
        <div
          key={drop.id}
          className="br-rain-drop"
          style={{
            left: `${drop.left}%`,
            height: `${drop.height}px`,
            animationDuration: `${drop.duration}s`,
            animationDelay: `${drop.delay}s`,
          }}
        />
      ))}
    </div>
  );
}
