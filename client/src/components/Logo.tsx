import { COLOR_HEX } from '../../../shared/board.ts';
import { PLANE_PATH } from './Piece.tsx';

export function Logo({ small = false }: { small?: boolean }) {
  return (
    <span className={small ? 'logo small' : 'logo'}>
      <svg viewBox="-12 -12 24 24" className="logo-mark" aria-hidden>
        {COLOR_HEX.map((c, i) => (
          <path key={c} d="M0 0 L-12 -12 L12 -12 Z" fill={c} transform={`rotate(${i * 90 - 90})`} />
        ))}
        <circle r="7.5" fill="#fff" />
        <path d={PLANE_PATH} transform="rotate(45) scale(5.6)" fill="#1d2b3a" />
      </svg>
      <span className="logo-text">
        Mencherz
        {!small && <span className="logo-sub">Aeroplane Chess · online</span>}
      </span>
    </span>
  );
}
