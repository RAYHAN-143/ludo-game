
// Simple 2-player online Ludo using Firebase Realtime Database
// Game model (stored under /rooms/{roomId}):
// {
//   players: { p1: uid_or_label, p2: uid_or_label },
//   state: { currentPlayer: 1, dice: 0, started: false },
//   tokens: { p1: [0,0,0,0], p2: [0,0,0,0] },
//   points: { p1:0, p2:0 },
//   ready: { p1:false, p2:false },
//   winner: null
// }

const createBtn = document.getElementById('createBtn');
const roomIdInput = document.getElementById('roomId');
const statusEl = document.getElementById('status');
const gameEl = document.getElementById('game');
const playerLabelEl = document.getElementById('playerLabel');
const currentPlayerEl = document.getElementById('currentPlayer');
const diceValueEl = document.getElementById('diceValue');
const rollBtn = document.getElementById('rollBtn');
const readyBtn = document.getElementById('readyBtn');
const messageEl = document.getElementById('message');
const p1PointsEl = document.getElementById('p1Points');
const p2PointsEl = document.getElementById('p2Points');
const boardEl = document.getElementById('board');

let roomRef = null;
let roomId = null;
let myPlayer = null; // "p1" or "p2"
let uid = 'u_' + Math.floor(Math.random()*1000000);

// create board UI 8x8 = 64 cells
for (let i=0;i<64;i++){
  const c = document.createElement('div');
  c.className = 'cell';
  c.dataset.idx = i;
  boardEl.appendChild(c);
}

createBtn.addEventListener('click', async () => {
  roomId = roomIdInput.value.trim();
  if (!roomId) return alert('Room id লাগবে');
  roomRef = firebase.database().ref('rooms/' + roomId);

  statusEl.textContent = 'Connecting...';
  // try to join as p1 or p2
  const snap = await roomRef.child('players').once('value');
  const players = snap.val() || {};
  if (!players.p1) {
    myPlayer = 'p1';
    await roomRef.child('players/p1').set(uid);
  } else if (!players.p2 && players.p1 !== uid) {
    myPlayer = 'p2';
    await roomRef.child('players/p2').set(uid);
  } else if (players.p1 === uid) {
    myPlayer = 'p1';
  } else if (players.p2 === uid) {
    myPlayer = 'p2';
  } else {
    alert('Room full (only 2 players allowed). Use a different room id.');
    statusEl.textContent = 'Room full';
    return;
  }

  // initialize room if first creator
  const init = {
    state: { currentPlayer: 1, dice: 0, started:false },
    tokens: { p1: [0,0,0,0], p2: [0,0,0,0] },
    points: { p1:0, p2:0 },
    ready: { p1:false, p2:false },
    winner: null
  };
  await roomRef.child('initCheck').transaction(cur => cur || init);

  statusEl.textContent = 'Connected as ' + myPlayer;
  playerLabelEl.textContent = myPlayer;
  gameEl.style.display = 'block';

  // listen room changes
  roomRef.on('value', snapshot => {
    const data = snapshot.val();
    if (!data) return;
    // update UI
    const state = data.state || {};
    currentPlayerEl.textContent = state.currentPlayer || '-';
    diceValueEl.textContent = state.dice || '-';
    p1PointsEl.textContent = (data.points && data.points.p1) || 0;
    p2PointsEl.textContent = (data.points && data.points.p2) || 0;
    if (data.winner) {
      messageEl.textContent = data.winner + ' জয়ী!';
      rollBtn.disabled = true;
    } else {
      messageEl.textContent = '';
      rollBtn.disabled = !(state.currentPlayer === (myPlayer === 'p1' ? 1 : 2) && state.started);
    }
    renderTokens((data.tokens) ? data.tokens : { p1:[0,0,0,0], p2:[0,0,0,0] });
  });

});

// Ready button to start when both ready
readyBtn.addEventListener('click', async () => {
  if (!roomRef) return;
  await roomRef.child('ready/' + myPlayer).set(true);
  const r = await roomRef.child('ready').once('value');
  const ready = r.val() || {};
  if (ready.p1 && ready.p2) {
    await roomRef.child('state').update({ started: true, currentPlayer: 1, dice:0 });
    await roomRef.child('message').set('Game started');
  } else {
    alert('Ready হলেই অপেক্ষা করুন অন্য প্লেয়ারও Ready হবে');
  }
});

// Roll dice
rollBtn.addEventListener('click', async () => {
  if (!roomRef) return;
  const snap = await roomRef.child('state').once('value');
  const state = snap.val() || {};
  const myPlayerNum = myPlayer === 'p1' ? 1 : 2;
  if (state.currentPlayer !== myPlayerNum) { alert('এখন আপনার পালা নয়'); return; }
  if (!state.started) { alert('কিছুক্ষণের জন্য Ready চাপুন এবং উভয় Ready অপেক্ষা করুন'); return; }

  // roll
  const dice = Math.floor(Math.random()*6) + 1;
  // update dice in DB
  await roomRef.child('state').update({ dice: dice });

  // move a token: choose first movable token (basic rule)
  const tokensSnap = await roomRef.child('tokens').once('value');
  const tokens = tokensSnap.val();
  const playerKey = myPlayer;
  const playerTokens = tokens[playerKey] || [0,0,0,0];
  // choose token index: prefer token not finished and moveable
  let tokenIndex = -1;
  for (let i=0;i<4;i++){
    if (playerTokens[i] < 63) { tokenIndex = i; break; }
  }
  if (tokenIndex === -1) {
    // all finished
    await roomRef.child('state').update({ dice: dice });
    return;
  }
  playerTokens[tokenIndex] += dice;
  if (playerTokens[tokenIndex] > 63) playerTokens[tokenIndex] = 63;

  // update points
  const pointsSnap = await roomRef.child('points').once('value');
  const points = pointsSnap.val() || { p1:0, p2:0 };
  points[playerKey] = (points[playerKey] || 0) + dice;

  // check capture
  const opponentKey = playerKey === 'p1' ? 'p2' : 'p1';
  const opponentTokensSnap = await roomRef.child('tokens/' + opponentKey).once('value');
  const opponentTokens = opponentTokensSnap.val() || [0,0,0,0];
  for (let i=0;i<4;i++){
    if (opponentTokens[i] === playerTokens[tokenIndex] && playerTokens[tokenIndex] !== 0) {
      // capture
      opponentTokens[i] = 0;
      points[playerKey] += 10;
      await roomRef.child('tokens/' + opponentKey).set(opponentTokens);
    }
  }

  // write updates atomically
  const updates = {};
  updates['/tokens/' + playerKey] = playerTokens;
  updates['/points'] = points;
  updates['/state/dice'] = dice;
  // switch turn
  updates['/state/currentPlayer'] = (myPlayer === 'p1') ? 2 : 1;

  await roomRef.update(updates);

  // check winner
  const allFinished = playerTokens.every(p => p === 63);
  if (allFinished) {
    await roomRef.child('winner').set((myPlayer === 'p1') ? 'Player 1' : 'Player 2');
  }
});

// render tokens on board
function renderTokens(tokens) {
  document.querySelectorAll('.cell').forEach(c => c.innerHTML = '');
  const p1 = tokens.p1 || [0,0,0,0];
  const p2 = tokens.p2 || [0,0,0,0];
  p1.forEach((pos, idx) => {
    const el = document.createElement('div');
    el.className = 'token player1';
    el.style.transform = `translate(0,0)`;
    boardEl.children[pos].appendChild(el);
  });
  p2.forEach((pos, idx) => {
    const el = document.createElement('div');
    el.className = 'token player2';
    el.style.transform = `translate(10px,10px)`;
    boardEl.children[pos].appendChild(el);
  });
}
