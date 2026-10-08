import { Modal } from './Modal.tsx';

export function HowToPlay({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="How to play" onClose={onClose}>
      <div className="howto">
        <p>
          Everyone has four pieces in their <b>hangar</b>. Score points by bringing pieces into the centre and by knocking out opponents. The
          game ends when someone has all four home, and the <b>most points</b> wins — so a good hunter can beat a fast runner.
        </p>
        <ol>
          <li>
            <b>Launch.</b> Roll a <b>6</b> to move a plane from the hangar to your takeoff spot. A 6 also gives you another roll.
          </li>
          <li>
            <b>Fly around.</b> Planes travel clockwise around the coloured track. When several planes can move, you pick which one.
          </li>
          <li>
            <b>Colour jump.</b> Land on a square of <b>your colour</b> and you jump straight to the next square of your colour.
          </li>
          <li>
            <b>Shortcut ✈.</b> Land on your colour's plane square and you fly along the dashed line across the board, skipping a whole arm. Any opponent sitting on the home square under the flight is sent back to its hangar.
          </li>
          <li>
            <b>Capture 💥.</b> End a move on an opponent's plane and it goes back to its hangar.
          </li>
          <li>
            <b>Home.</b> After a full lap, planes turn at the arrow into their coloured home column. Too high a roll bounces back from the centre.
          </li>
          <li>
            <b>Three sixes</b> in a row is bad luck: every piece that isn't home yet goes back to the hangar.
          </li>
          <li>
            <b>Bomb 💣.</b> After three sixes you get your revenge: drop a bomb on any empty square of the track. The next piece to land on it, yours
            included, goes back to its hangar, and you score for it as if you'd knocked it out. Passing over a bomb is safe.
          </li>
          <li>
            <b>Magic box 🎁.</b> Before the first roll, everyone hides one box on any square of the track. Whoever lands on it first, its owner
            included, opens it and gets one of these at random: a <b>bomb</b> that sends the piece home, a protective{' '}
            <b>vest</b> 🦺 that stops the next bomb they land on, <b>nothing</b>, or <b>−10 points</b>.
          </li>
        </ol>
        <h3>Difficulty</h3>
        <p>
          On <b>normal</b> the dice is fair. On <b>hard</b> it's mean: a third six and a roll that lands you on a bomb come up more often. On{' '}
          <b>easy</b> it's kind.
        </p>
        <h3>Points</h3>
        <ul>
          <li>🏁 Each piece that reaches the centre: <b>+100</b></li>
          <li>💥 Knocking out a piece in the first half of its route: <b>+20</b>, further along: <b>+25</b>, in the last 15%: <b>+30</b></li>
          <li>✈ Flying over a piece in its home column, which only the player opposite can do: <b>+70</b></li>
        </ul>
        <p className="muted">Hosts can switch to the classic race (first all home wins) and change other rules when creating a game.</p>
      </div>
    </Modal>
  );
}
