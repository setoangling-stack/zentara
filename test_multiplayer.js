const WebSocket = require('ws');
const assert = require('assert');

async function run() {
  console.log('Testing WebSocket multiplayer synchronization...');

  // Player 1 connects to PUBLIK room
  const ws1 = new WebSocket('ws://localhost:3000/kelas?kode=PUBLIK&nama=PlayerSatu');
  
  await new Promise((resolve, reject) => {
    ws1.on('open', resolve);
    ws1.on('error', reject);
  });
  console.log('Player 1 connected');

  const p1Received = [];
  ws1.on('message', (msg) => {
    p1Received.push(JSON.parse(msg));
  });

  // Player 1 sends hi in 'kota'
  ws1.send(JSON.stringify({
    t: 'hi',
    z: 'kota',
    nama: 'PlayerSatu',
    p: [10, 0, 20, 1.5]
  }));

  // Wait a moment
  await new Promise(r => setTimeout(r, 200));

  // Player 2 connects to same PUBLIK room
  const ws2 = new WebSocket('ws://localhost:3000/kelas?kode=PUBLIK&nama=PlayerDua');
  await new Promise((resolve, reject) => {
    ws2.on('open', resolve);
    ws2.on('error', reject);
  });
  console.log('Player 2 connected');

  const p2Received = [];
  ws2.on('message', (msg) => {
    p2Received.push(JSON.parse(msg));
  });

  // Player 2 sends hi in 'kota'
  ws2.send(JSON.stringify({
    t: 'hi',
    z: 'kota',
    nama: 'PlayerDua',
    p: [12, 0, 22, 0.5]
  }));

  // Wait a moment for handshake
  await new Promise(r => setTimeout(r, 400));

  // Check: Player 2 should have received 'all' with Player 1 in the list
  const allMsg = p2Received.find(m => m.t === 'all');
  assert(allMsg, 'Player 2 must receive "all" message');
  assert(allMsg.list.some(p => p.nama === 'PlayerSatu'), 'Player 2 must see Player 1 in "all" list');
  console.log('PASS: Player 2 received Player 1 in initial peers list ("all")');

  // Check: Player 1 should have received 'join' for Player 2
  const joinMsg = p1Received.find(m => m.t === 'join' && m.nama === 'PlayerDua');
  assert(joinMsg, 'Player 1 must receive "join" for Player 2');
  console.log('PASS: Player 1 received Player 2 "join" notification');

  // Player 1 sends movement position update
  ws1.send(JSON.stringify({
    t: 'p',
    p: [15.5, 0, 25.5, 2.0]
  }));

  await new Promise(r => setTimeout(r, 200));

  // Check: Player 2 should receive position update for Player 1
  const posMsg = p2Received.find(m => m.t === 'p' && m.id === allMsg.list[0].id);
  assert(posMsg, 'Player 2 must receive position update from Player 1');
  assert.deepStrictEqual(posMsg.p, [15.5, 0, 25.5, 2.0]);
  console.log('PASS: Player 2 received position update from Player 1');

  // Player 1 leaves/disconnects
  ws1.close();
  await new Promise(r => setTimeout(r, 200));

  // Check: Player 2 should receive 'left'
  const leftMsg = p2Received.find(m => m.t === 'left' && m.id === allMsg.list[0].id);
  assert(leftMsg, 'Player 2 must receive "left" message for Player 1');
  console.log('PASS: Player 2 received "left" event when Player 1 disconnected');

  ws2.close();
  console.log('ALL MULTIPLAYER TESTS PASSED SUCCESSFULLY!');
}

run().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
