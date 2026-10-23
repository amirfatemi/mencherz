import { useEffect, useState, type CSSProperties } from 'react';
import { gameAwards, medalsWon } from '../../../shared/awards.ts';
import { COLOR_HEX, type Seat } from '../../../shared/board.ts';
import { peopleIn, type PublicUser, type SeatView } from '../../../shared/protocol.ts';
import { RANKED_MIN_PEOPLE } from '../../../shared/scoring.ts';
import { availablePowers, distinctMoves, freeSquares, placeOptions, ambushTargets, vestOptions, type PowerChoice } from '../../../shared/rules.ts';
import { formatDuration } from '../duration.ts';
import { isMuted, setMuted, sfx } from '../sound.ts';
import { seatName } from '../events.ts';
import { navigate } from '../router.ts';
import { call } from '../socket.ts';
import type { useRoomStream } from '../useRoomStream.ts';
import { Board, TOUCH } from './Board.tsx';
import { BoxRevealCard } from './BoxReveal.tsx';
import type { PieceStyle } from './Piece.tsx';
import { BombBadge, BoxBadge, Dice, EmojiBadge } from './Dice.tsx';
import { HowToPlay } from './HowToPlay.tsx';
import { preloadReactions } from './Reaction.tsx';
import { Modal } from './Modal.tsx';
import { MEDALS, Scoreboard } from './Scoreboard.tsx';

type Stream = ReturnType<typeof useRoomStream>;

const POWER_BUTTONS: { choice: PowerChoice; label: string; className: string; title: string }[] = [
  { choice: 'heaven', label: '🌈 Heaven bridge · +10', className: 'btn primary', title: 'Whoever lands on its start, you too, jumps 10 squares ahead. Once a game.' },
  { choice: 'hell', label: '🔥 Hell bridge · −20', className: 'btn danger', title: 'Whoever lands on its start, you too, falls 20 squares back. Once a game.' },
  { choice: 'box', label: '🎁 Magic box', className: 'btn ghost', title: 'Hide a magic box on any empty square. Whoever lands on it first opens it — you too.' },
  { choice: 'safe', label: '🛡 Safe square', className: 'btn ghost', title: "For two rounds, your pieces on that square can't be knocked out." },
  {
    choice: 'ambush',
    label: '🏹 Ambush · شبیخون',
    className: 'btn ghost',
    title: "For two rounds a second flight line crosses another player's home column, and any flight over it knocks out the whole column. Once a game.",
  },
  {
    choice: 'superBomb',
    label: '💥 Super bomb',
    className: 'btn danger',
    title: 'Whoever lands on it blows up, with every piece within two squares ahead or behind. Once a game.',
  },
];

function useTicker(active: boolean, ms = 250) {
  const [, setN] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setN((n) => n + 1), ms);
    return () => clearInterval(t);
  }, [active, ms]);
}

function usePieceStyle(): [PieceStyle, (s: PieceStyle) => void] {
  const [style, setStyle] = useState<PieceStyle>(() => {
    try {
      return localStorage.getItem('mz.pieces') === 'plane' ? 'plane' : 'pawn';
    } catch {
      return 'pawn';
    }
  });
  const set = (s: PieceStyle) => {
    setStyle(s);
    try {
      localStorage.setItem('mz.pieces', s);
    } catch {
      /* private mode */
    }
  };
  return [style, set];
}

export function GameView({ stream, user }: { stream: Stream; user: PublicUser }) {
  const view = stream.view!;
  const game = view.game!;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [help, setHelp] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [muted, setMutedState] = useState(isMuted);
  const toggleSound = () => {
    setMuted(!muted);
    setMutedState(!muted);
  };
  // The ambush needs a second pick: whose home column it opens.
  const [pickingAmbush, setPickingAmbush] = useState(false);
  const [pieceStyle, setPieceStyle] = usePieceStyle();
  const gifs = view.settings.gifs;
  useEffect(() => {
    if (gifs) preloadReactions();
  }, [gifs]);

  // Seats this device plays: the user's own and anyone sitting at it.
  const playsHere = (s: SeatView) => s.kind === 'human' && !s.left && (s.userId === user.id || s.controllerId === user.id);
  const mySeat = view.seats.findIndex((s) => s.kind === 'human' && s.userId === user.id && !s.left);
  const localSeats = game.active.filter((seat) => seat !== mySeat && playsHere(view.seats[seat]));
  const over = view.status === 'finished' || game.phase === 'over';
  const paused = view.paused && !over;
  const isHost = view.hostId === user.id;
  const busy = stream.animating || pending || paused;
  const myTurn = !over && playsHere(view.seats[game.turn]);
  // On a shared device the turn belongs to whoever is holding it, so say their name.
  const you = mySeat === game.turn ? 'You' : seatName(view.seats, game.turn);
  const canRoll = myTurn && game.phase === 'roll' && !busy;
  // Who wears a vest from a magic box is picked on the board, like a move.
  const givingVest = myTurn && game.phase === 'vest' && !busy;
  const movable = myTurn && game.phase === 'move' && !busy ? game.movable : givingVest ? vestOptions(game) : [];
  const placingBomb = myTurn && game.phase === 'bomb' && !busy;
  const hidingBox = myTurn && game.phase === 'box' && !busy;
  const pickingPower = myTurn && game.phase === 'power' && !busy;
  // A bridge or magic box picked on a power square, being put down.
  const placing = myTurn && game.phase === 'place' && !busy ? game.placing : null;
  const turnName = seatName(view.seats, game.turn);
  const forced = myTurn && game.phase === 'move' && distinctMoves(game).length === 1;

  const deadline = !over && view.turnDeadline ? view.turnDeadline : null;
  useTicker(deadline !== null);
  // The game clock, pauses left out: counts on from the server's figure while the game runs.
  useTicker(view.clockRunning, 15000);
  const played = view.playedMs + (view.clockRunning ? Math.max(0, stream.now() - view.serverNow) : 0);
  const left = deadline ? Math.max(0, deadline - stream.now()) : 0;
  const total = (view.settings.turnSeconds || 6) * 1000;

  const send = (req: Promise<unknown>) => {
    setPending(true);
    setError(null);
    req.catch((e: Error) => setError(e.message)).finally(() => setPending(false));
  };
  const act = (event: 'game:roll' | 'game:move' | 'game:vest' | 'game:bomb' | 'game:box' | 'game:place', n?: number) =>
    send(
      event === 'game:roll'
        ? call(event, { code: view.code })
        : event === 'game:move' || event === 'game:vest'
          ? call(event, { code: view.code, piece: n! })
          : call(event, { code: view.code, square: n! }),
    );
  const pickPower = (choice: PowerChoice, over?: Seat) => {
    setPickingAmbush(false);
    send(call('game:power', { code: view.code, choice, over }));
  };
  const setPaused = (on: boolean) => call('game:pause', { code: view.code, paused: on }).catch((e: Error) => setError(e.message));

  // A chime when the dice is yours to roll.
  useEffect(() => {
    if (canRoll) sfx.turn();
  }, [canRoll, game.turnNo]);

  useEffect(() => {
    if (!canRoll) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === ' ' || e.key === 'Enter') && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault();
        act('game:roll');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const hostName = view.seats.find((s) => s.userId === view.hostId)?.name ?? 'the host';
  const held = stream.held;
  const heldText = held && !over ? `${held.seat === mySeat ? 'You' : seatName(view.seats, held.seat)} rolled ${held.value} — no move` : null;
  let status: string;
  if (held?.wait && heldText) {
    status = heldText;
  } else if (paused) {
    status = isHost ? '⏸ Game paused' : `⏸ Paused by ${hostName}`;
  } else if (over) {
    const top = game.standings[0];
    status =
      top === undefined
        ? 'Game over'
        : game.rules.winBy === 'points'
          ? `${seatName(view.seats, top)} wins with ${game.stats[top].points} points!`
          : `${seatName(view.seats, top)} wins!`;
  } else if (myTurn && game.phase === 'box') {
    status = `🎁 ${mySeat === game.turn ? 'Hide' : `${you}, hide`} your magic box on any square`;
  } else if (myTurn && game.phase === 'bomb') {
    status = `💣 ${mySeat === game.turn ? 'Drop' : `${you}, drop`} your bomb on any empty square`;
  } else if (myTurn && game.phase === 'vest') {
    status = `🦺 A vest! ${mySeat === game.turn ? 'Pick' : `${you}, pick`} the piece that wears it`;
  } else if (myTurn && game.phase === 'power') {
    status = `⚡ Power square! ${mySeat === game.turn ? 'Pick' : `${you}, pick`} a power`;
  } else if (myTurn && game.phase === 'place') {
    const pick = mySeat === game.turn ? 'Pick' : `${you}, pick`;
    status =
      game.placing === 'box'
        ? `🎁 ${pick} where to hide your magic box`
        : game.placing === 'safe'
          ? `🛡 ${pick} a square to make safe`
          : game.placing === 'superBomb'
            ? `💥 ${pick} where your super bomb goes`
            : `${game.placing === 'heaven' ? '🌈' : '🔥'} ${pick} where your ${game.placing} bridge starts`;
  } else if (myTurn) {
    const whose = mySeat === game.turn ? 'Your' : `${you}'s`;
    status = game.phase === 'roll' ? `${whose} turn — roll the dice` : forced ? `${you} rolled ${game.dice} — move your piece` : `${you} rolled ${game.dice} — pick a piece`;
  } else {
    const s = view.seats[game.turn];
    const thinking =
      game.phase === 'box'
        ? 'is hiding a magic box 🎁'
        : game.phase === 'bomb'
          ? 'is placing a bomb 💣'
          : game.phase === 'power'
            ? 'is picking a power ⚡'
            : game.phase === 'vest'
              ? 'is putting a vest on a piece 🦺'
            : game.phase === 'place'
              ? game.placing === 'box'
                ? 'is hiding a magic box 🎁'
                : game.placing === 'safe'
                  ? 'is making a square safe 🛡'
                  : game.placing === 'superBomb'
                    ? 'is placing a super bomb 💥'
                    : `is building a ${game.placing} bridge ${game.placing === 'heaven' ? '🌈' : '🔥'}`
              : s.kind === 'bot'
            ? 'is thinking'
            : game.phase === 'roll'
              ? 'is rolling'
              : 'is picking a piece';
    status = `${turnName} ${thinking}…`;
  }
  // Among people a missed roll doesn't hold anyone up: it stays on the dice while the next player goes.
  if (heldText && !held?.wait && !paused) status = `${heldText} · ${status}`;

  // The dice shows a roll until its move is made, then goes blank for the next roll. A roll that
  // couldn't be played stays up for a few seconds (held) in the colour of whoever rolled it.
  const diceSeat = stream.rolling && stream.lastRoll ? stream.lastRoll.seat : (held?.seat ?? game.turn);
  const diceValue = game.phase === 'move' ? game.dice : (held?.value ?? null);

  return (
    <div className="game">
      <div className="board-area">
        <div className="board-frame">
          <Board
            game={game}
            seats={view.seats}
            anim={stream.anim}
            movable={movable}
            pieceStyle={pieceStyle}
            popups={stream.popups}
            reactions={stream.reactions}
            targets={placing ? placeOptions(game) : placingBomb || hidingBox ? freeSquares(game) : []}
            targetKind={hidingBox ? 'box' : (placing ?? 'bomb')}
            onMove={(p) => act(givingVest ? 'game:vest' : 'game:move', p)}
            onTarget={(sq) => act(hidingBox ? 'game:box' : placing ? 'game:place' : 'game:bomb', sq)}
          />
          {stream.reveal && <BoxRevealCard key={stream.reveal.key} reveal={stream.reveal} seats={view.seats} />}
          {paused && (
            <div className="paused-overlay">
              <div className="paused-card">
                <div className="paused-icon">⏸</div>
                <div>{isHost ? 'The game is paused' : `${hostName} paused the game`}</div>
                {isHost ? (
                  <button className="btn primary big" onClick={() => setPaused(false)}>
                    ▶ Resume
                  </button>
                ) : (
                  <div className="muted small">It carries on when they resume it.</div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <aside className="side">
        <section className="card turn-card" style={{ '--turn': COLOR_HEX[game.turn] } as CSSProperties}>
          <div className="turn-head">
            <div className="turn-status">{status}</div>
          </div>
          <div className={`dice-row${canRoll ? ' solo' : ''}`}>
            {game.phase === 'box' || (game.phase === 'place' && game.placing === 'box') ? (
              <BoxBadge color={COLOR_HEX[game.turn]} />
            ) : (game.phase === 'bomb' && !stream.rolling) || (game.phase === 'place' && game.placing === 'superBomb') ? (
              <BombBadge color={COLOR_HEX[game.turn]} />
            ) : game.phase === 'power' ? (
              <EmojiBadge icon="⚡" color={COLOR_HEX[game.turn]} label="Power square" />
            ) : game.phase === 'vest' ? (
              <EmojiBadge icon="🦺" color={COLOR_HEX[game.turn]} label="Protective vest" />
            ) : game.phase === 'place' ? (
              <EmojiBadge
                icon={game.placing === 'safe' ? '🛡' : game.placing === 'heaven' ? '🌈' : '🔥'}
                color={COLOR_HEX[game.turn]}
                label={game.placing === 'safe' ? 'Safe square' : `${game.placing} bridge`}
              />
            ) : (
              <Dice value={stream.rolling ? null : diceValue} rolling={stream.rolling} color={COLOR_HEX[diceSeat]} canRoll={canRoll} onRoll={() => act('game:roll')} />
            )}
            <div className="dice-help">
              {canRoll ? null : givingVest ? (
                <span>
                  {TOUCH ? 'Tap one of your glowing pieces, then tap it again.' : 'Click one of your glowing pieces.'} It wears the vest — in the hangar or out —
                  until it stops a bomb.
                </span>
              ) : pickingPower && pickingAmbush ? (
                <div className="power-choices">
                  <span>🏹 Ambush whose home column?</span>
                  {ambushTargets(game).map((seat) => (
                    <button key={seat} className="btn seat-pick" style={{ '--seat': COLOR_HEX[seat] } as CSSProperties} onClick={() => pickPower('ambush', seat)}>
                      {seatName(view.seats, seat)}
                    </button>
                  ))}
                  <button className="btn ghost" onClick={() => setPickingAmbush(false)}>
                    ← Back
                  </button>
                </div>
              ) : pickingPower ? (
                <div className="power-choices">
                  {POWER_BUTTONS.map((b) => {
                    const used = !availablePowers(game).includes(b.choice);
                    return (
                      <button
                        key={b.choice}
                        className={b.className}
                        disabled={used}
                        onClick={() => (b.choice === 'ambush' ? setPickingAmbush(true) : pickPower(b.choice))}
                        title={used ? 'Already used this game: each bridge and the super bomb can be picked only once' : b.title}
                      >
                        {b.label}
                        {used ? ' · used' : ''}
                      </button>
                    );
                  })}
                </div>
              ) : placing === 'superBomb' ? (
                <span>
                  {TOUCH ? 'Tap an empty square, then tap it again.' : 'Click any empty square.'} Whoever lands on it blows up, with every piece within two
                  squares ahead or behind — yours too.
                </span>
              ) : placing === 'box' ? (
                <span>{TOUCH ? 'Tap an empty square, then tap it again.' : 'Click any empty square.'} Whoever lands on it first opens it — you too.</span>
              ) : placing === 'safe' ? (
                <span>
                  {TOUCH ? 'Tap a square, then tap it again.' : 'Click a square.'} For two rounds your pieces there can't be knocked out — others can still land
                  there.
                </span>
              ) : placing ? (
                <span>
                  {TOUCH ? 'Tap a square to see where the bridge ends, then tap it again.' : 'Hover a square to see where the bridge ends, then click it.'} It works once, for
                  whoever lands on its start first — you too.
                </span>
              ) : forced && !busy ? (
                <span>Only one move is possible — {TOUCH ? 'tap the glowing piece, then tap it again' : 'click the glowing piece'}.</span>
              ) : hidingBox ? (
                TOUCH && <span>Tap a square, then tap it again.</span>
              ) : placingBomb ? (
                <span>
                  Three sixes! {TOUCH ? 'Tap an empty square, then tap it again to drop the bomb.' : 'Click any empty square.'} Whoever lands there
                  goes back to their hangar.
                </span>
              ) : myTurn && game.phase === 'move' ? (
                <span>{TOUCH ? 'Tap a glowing piece to see its move, then tap it again to go.' : 'Click a glowing piece. Hover to preview its move.'}</span>
              ) : (
                <span className="muted">{over ? 'Thanks for playing!' : paused ? 'Paused' : 'Waiting…'}</span>
              )}
            </div>
          </div>
          {deadline && (
            <div className="timer" aria-label={`${Math.ceil(left / 1000)} seconds left`}>
              <div className="timer-bar" style={{ width: `${Math.min(100, (left / total) * 100)}%` }} />
              <span>{Math.ceil(left / 1000)}s</span>
            </div>
          )}
          {error && <div className="error small">{error}</div>}
        </section>

        <Scoreboard
          game={game}
          seats={view.seats}
          events={view.events}
          mySeat={mySeat}
          over={over}
          userId={user.id}
          spectators={view.spectators}
          played={formatDuration(played)}
        />

        <div className="side-actions">
          <div className="segmented" role="group" aria-label="Piece style">
            <button className={pieceStyle === 'pawn' ? 'on' : ''} onClick={() => setPieceStyle('pawn')} aria-pressed={pieceStyle === 'pawn'}>
              ♟ Pawns
            </button>
            <button className={pieceStyle === 'plane' ? 'on' : ''} onClick={() => setPieceStyle('plane')} aria-pressed={pieceStyle === 'plane'}>
              ✈ Planes
            </button>
          </div>
          <button className="btn ghost small" onClick={() => setHelp(true)}>
            📖 آموزش
          </button>
          <button className="btn ghost small" onClick={toggleSound} aria-pressed={!muted} title={muted ? 'Sounds are off' : 'Sounds are on'}>
            {muted ? '🔇 Sound' : '🔊 Sound'}
          </button>
          {isHost && !over && (
            <button className="btn ghost small" onClick={() => setPaused(!view.paused)} title={view.paused ? 'Resume the game' : 'Pause the game and its timer'}>
              {view.paused ? '▶ Resume' : '⏸ Pause'}
            </button>
          )}
          {mySeat >= 0 && !over ? (
            <button className="btn ghost small" onClick={() => setConfirmLeave(true)}>
              Leave game
            </button>
          ) : (
            <button className="btn ghost small" onClick={() => navigate('/')}>
              Back to lobby
            </button>
          )}
        </div>
      </aside>

      {over && !dismissed && !stream.animating && (
        <Modal title="Game over" onClose={() => setDismissed(true)}>
          <ol className="results">
            {game.standings.map((seat, i) => (
              <li key={seat} style={{ '--seat': COLOR_HEX[seat] } as CSSProperties}>
                <span className="medal">{MEDALS[i]}</span>
                <span className="swatch" />
                <span className="results-name">{seatName(view.seats, seat)}</span>
                {seat === mySeat && <span className="pill accent">You</span>}
                <span className="results-detail">
                  🏁 {game.stats[seat].home} · 💥 {game.stats[seat].captures} · 🤕 {game.stats[seat].lost}
                </span>
                <span className="results-points">{game.stats[seat].points}</span>
              </li>
            ))}
          </ol>
          <p className="results-time">⏱ Game time: {formatDuration(played)}</p>
          {game.standings.length > 0 && (
            <>
              <h3 className="report-head">Highlights</h3>
              <ul className="awards">
                {gameAwards(game).map((a) => (
                  <li key={a.id} style={{ '--seat': COLOR_HEX[a.seat] } as CSSProperties}>
                    <span className="award-icon">{a.icon}</span>
                    <span className="award-text">
                      <b>{a.title}</b>
                      <span>
                        <span className="swatch" /> {seatName(view.seats, a.seat)} · {a.detail}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
              {peopleIn(view.seats) >= RANKED_MIN_PEOPLE &&
                game.standings.some((seat) => view.seats[seat].kind === 'human' && medalsWon(game, seat).length > 0) && (
                  <>
                    <h3 className="report-head">New medals 🏅</h3>
                    <ul className="new-medals">
                      {game.standings
                        .filter((seat) => view.seats[seat].kind === 'human')
                        .map((seat) => {
                          const won = medalsWon(game, seat);
                          return won.length ? (
                            <li key={seat}>
                              <b>{seatName(view.seats, seat)}</b>:{' '}
                              {won.map((m) => (
                                <span key={m.id} className="pill" title={m.how}>
                                  {m.icon} {m.name}
                                </span>
                              ))}
                            </li>
                          ) : null;
                        })}
                    </ul>
                  </>
                )}
            </>
          )}
          {game.standings.length === 0 && <p className="muted">Everyone left, so the game was stopped.</p>}
          {peopleIn(view.seats) < RANKED_MIN_PEOPLE && (
            <p className="muted small">Practice game: with only one person playing, it doesn't count on the leaderboard.</p>
          )}
          <div className="modal-actions">
            <button className="btn ghost" onClick={() => setDismissed(true)}>
              See the board
            </button>
            <button className="btn primary" onClick={() => navigate('/')}>
              Back to lobby
            </button>
          </div>
        </Modal>
      )}

      {confirmLeave && (
        <Modal title="Leave this game?" onClose={() => setConfirmLeave(false)}>
          <p>
            A computer player will take over your planes{localSeats.length ? `, and those of ${localSeats.map((seat) => seatName(view.seats, seat)).join(' and ')} on this device` : ''}. You
            won't be able to take your seat back.
          </p>
          <div className="modal-actions">
            <button className="btn ghost" onClick={() => setConfirmLeave(false)}>
              Stay
            </button>
            <button className="btn danger" onClick={() => call('room:leave', { code: view.code }).finally(() => navigate('/'))}>
              Leave
            </button>
          </div>
          <p className="muted small">
            Just need a break? Go back to the lobby instead and resume from “Your games”. While you're away your turns are played for you
            {view.seats.filter((s) => s.kind === 'human' && !s.left).length > 1 ? ' so the others can keep going' : ', and a solo game simply waits'}.
          </p>
          <button className="btn ghost small" onClick={() => navigate('/')}>
            Back to lobby, keep my seat
          </button>
        </Modal>
      )}

      {help && <HowToPlay onClose={() => setHelp(false)} />}
    </div>
  );
}
