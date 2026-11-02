// game.js - Canvas 2D Web RPG Engine (Realistic RPG Graphics & Smooth Controls)
(() => {
  // --- SOUND SYNTHESIZER (Web Audio API) ---
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  let audioCtx = null;
  function initAudio() {
    if (!audioCtx) audioCtx = new AudioCtx();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  }

  function playSound(type) {
    if (!audioCtx) return;
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);

    if (type === 'hit') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(180, now);
      osc.frequency.exponentialRampToValueAtTime(30, now + 0.12);
      gain.gain.setValueAtTime(0.35, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.12);
      osc.start(now);
      osc.stop(now + 0.12);
    } else if (type === 'slash') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(420, now);
      osc.frequency.exponentialRampToValueAtTime(110, now + 0.08);
      gain.gain.setValueAtTime(0.25, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.08);
      osc.start(now);
      osc.stop(now + 0.08);
    } else if (type === 'coin') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(987.77, now);
      osc.frequency.setValueAtTime(1318.51, now + 0.08);
      gain.gain.setValueAtTime(0.25, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.28);
      osc.start(now);
      osc.stop(now + 0.28);
    } else if (type === 'upgrade') {
      const notes = [523.25, 659.25, 783.99, 1046.50];
      notes.forEach((freq, idx) => {
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        o.type = 'triangle';
        o.frequency.value = freq;
        o.connect(g);
        g.connect(audioCtx.destination);
        const startTime = now + idx * 0.09;
        g.gain.setValueAtTime(0.2, startTime);
        g.gain.exponentialRampToValueAtTime(0.01, startTime + 0.24);
        o.start(startTime);
        o.stop(startTime + 0.24);
      });
    } else if (type === 'wrong') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(130, now);
      gain.gain.setValueAtTime(0.35, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.25);
      osc.start(now);
      osc.stop(now + 0.25);
    }
  }

  // --- STATE ---
  let ws = null;
  let myId = null;
  let animTick = 0;

  let me = {
    x: 1050,
    y: 850,
    targetX: 1050,
    targetY: 850,
    vx: 0,
    vy: 0,
    facing: 1,
    walkFrame: 0,
    attackAnim: 0,
    speed: 4.2,
    name: '',
    hp: 100,
    maxHp: 100,
    coins: 0,
    weaponLvl: 1,
    weaponName: 'Tongkat Kayu Magis',
    weaponAtk: 12,
    weaponColor: '#8d6e63',
    score: 0
  };

  let world = {
    width: 2200,
    height: 1600,
    missionBoard: { x: 1100, y: 800, radius: 65 },
    bossMonster: { x: 1750, y: 400, radius: 55, hp: 250, maxHp: 250, isAlive: true },
    smallMobs: [],
    obstacles: [],
    weapons: []
  };

  const otherPlayers = new Map();
  const floatingTexts = [];
  const particles = [];

  // DOM Elements
  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d');
  const minimapCanvas = document.getElementById('minimapCanvas');
  const mmCtx = minimapCanvas.getContext('2d');

  // HUD
  const hudName = document.getElementById('hud-name');
  const hudHpBar = document.getElementById('hud-hp-bar');
  const hudCoins = document.getElementById('hud-coins');
  const hudWeapon = document.getElementById('hud-weapon');
  const hudAtk = document.getElementById('hud-atk');
  const hudScore = document.getElementById('hud-score');
  const leaderboardList = document.getElementById('leaderboard-list');

  // Modals
  const modalJoin = document.getElementById('modal-join');
  const inputUsername = document.getElementById('input-username');
  const btnJoin = document.getElementById('btn-join');

  const modalMission = document.getElementById('modal-mission');
  const missionInfo = document.getElementById('mission-info');
  const missionCost = document.getElementById('mission-cost');
  const missionPlayerCoins = document.getElementById('mission-player-coins');
  const missionQuizArea = document.getElementById('mission-quiz-area');
  const missionQuestion = document.getElementById('mission-question');
  const missionOptions = document.getElementById('mission-options');
  const btnStartMission = document.getElementById('btn-start-mission');
  const btnCloseMission = document.getElementById('btn-close-mission');

  const modalBoss = document.getElementById('modal-boss');
  const bossQuestion = document.getElementById('boss-question');
  const bossOptions = document.getElementById('boss-options');
  const btnCloseBoss = document.getElementById('btn-close-boss');

  const modalDuelConfirm = document.getElementById('modal-duel-confirm');
  const duelChallengerName = document.getElementById('duel-challenger-name');
  const duelChallengerWeapon = document.getElementById('duel-challenger-weapon');
  const btnAcceptDuel = document.getElementById('btn-accept-duel');
  const btnRejectDuel = document.getElementById('btn-reject-duel');

  const modalDuelArena = document.getElementById('modal-duel-arena');
  const duelP1Name = document.getElementById('duel-p1-name');
  const duelP1Hp = document.getElementById('duel-p1-hp');
  const duelP2Name = document.getElementById('duel-p2-name');
  const duelP2Hp = document.getElementById('duel-p2-hp');
  const duelQuestion = document.getElementById('duel-question');
  const duelOptions = document.getElementById('duel-options');
  const btnSurrenderDuel = document.getElementById('btn-surrender-duel');

  const btnAction = document.getElementById('btn-action');
  const chatMessages = document.getElementById('chat-messages');
  const chatForm = document.getElementById('chat-form');
  const chatInput = document.getElementById('chat-input');
  const toastContainer = document.getElementById('toast-container');

  let currentChallengerId = null;
  let activeMissionData = null;
  let activeBossQ = null;
  let activeDuelQ = null;
  let targetedMobId = null;

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  window.addEventListener('resize', resize);
  resize();

  function showToast(msg) {
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerText = msg;
    toastContainer.appendChild(el);
    setTimeout(() => el.remove(), 2800);
  }

  function addFloatingText(text, x, y, color = '#ffeb3b') {
    floatingTexts.push({ text, x, y, color, alpha: 1.0, vy: -1.3 });
  }

  function spawnHitParticles(x, y, color = '#ffeb3b', count = 10) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const spd = 1.5 + Math.random() * 3.5;
      particles.push({
        x,
        y,
        vx: Math.cos(angle) * spd,
        vy: Math.sin(angle) * spd,
        life: 1.0,
        decay: 0.03 + Math.random() * 0.03,
        size: 3 + Math.random() * 3,
        color
      });
    }
  }

  // --- CONTROLS ---
  const keys = {};
  window.addEventListener('keydown', (e) => {
    keys[e.key.toLowerCase()] = true;
    if (e.key === ' ' || e.code === 'Space') {
      if (document.activeElement !== chatInput) {
        e.preventDefault();
        triggerNearestAction();
      }
    }
  });
  window.addEventListener('keyup', (e) => {
    keys[e.key.toLowerCase()] = false;
  });

  canvas.addEventListener('mousedown', (e) => {
    if (!myId) return;
    initAudio();
    const rect = canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;

    const camX = me.x - canvas.width / 2;
    const camY = me.y - canvas.height / 2;
    const worldClickX = screenX + camX;
    const worldClickY = screenY + camY;

    // 1. Click other player -> challenge duel
    for (const [id, p] of otherPlayers.entries()) {
      const d = Math.hypot(worldClickX - p.x, worldClickY - p.y);
      if (d < 38) {
        if (confirm(`Tantang ${p.name} berduel kuis kecerdasan?`)) {
          wsSend({ type: 'challenge_duel', targetId: id });
        }
        return;
      }
    }

    // 2. Click boss -> trigger or move close
    if (world.bossMonster.isAlive) {
      const d = Math.hypot(worldClickX - world.bossMonster.x, worldClickY - world.bossMonster.y);
      if (d < world.bossMonster.radius + 25) {
        const selfDist = Math.hypot(me.x - world.bossMonster.x, me.y - world.bossMonster.y);
        if (selfDist <= 160) {
          wsSend({ type: 'trigger_boss' });
        } else {
          me.targetX = world.bossMonster.x;
          me.targetY = world.bossMonster.y;
          showToast('Mendekati Raja Golem...');
        }
        return;
      }
    }

    // 3. Click mission board
    const dBoard = Math.hypot(worldClickX - world.missionBoard.x, worldClickY - world.missionBoard.y);
    if (dBoard < world.missionBoard.radius + 25) {
      const selfDist = Math.hypot(me.x - world.missionBoard.x, me.y - world.missionBoard.y);
      if (selfDist <= 160) {
        wsSend({ type: 'open_mission' });
      } else {
        me.targetX = world.missionBoard.x;
        me.targetY = world.missionBoard.y;
        showToast('Mendekati Papan Misi...');
      }
      return;
    }

    // 4. Click small mob -> track & attack
    for (const mob of world.smallMobs) {
      if (!mob.isAlive) continue;
      const d = Math.hypot(worldClickX - mob.x, worldClickY - mob.y);
      if (d < (mob.radius || 24) + 15) {
        targetedMobId = mob.id;
        const selfDist = Math.hypot(me.x - mob.x, me.y - mob.y);
        if (selfDist <= 120) {
          attackMob(mob);
        } else {
          me.targetX = mob.x;
          me.targetY = mob.y;
          showToast(`Memburu ${mob.name || 'Monster'}!`);
        }
        return;
      }
    }

    // Default: walk to destination
    targetedMobId = null;
    me.targetX = Math.max(30, Math.min(world.width - 30, worldClickX));
    me.targetY = Math.max(30, Math.min(world.height - 30, worldClickY));
  });

  // Virtual Joystick
  const joyZone = document.getElementById('joystick-zone');
  const joyKnob = document.getElementById('joystick-knob');
  let joyActive = false;
  let joyVec = { x: 0, y: 0 };

  function handleJoyMove(clientX, clientY) {
    const rect = joyZone.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const dx = clientX - centerX;
    const dy = clientY - centerY;
    const dist = Math.hypot(dx, dy);
    const maxR = rect.width / 2;

    if (dist > 0) {
      const norm = Math.min(dist, maxR);
      joyVec.x = (dx / dist) * (norm / maxR);
      joyVec.y = (dy / dist) * (norm / maxR);
      joyKnob.style.transform = `translate(${joyVec.x * maxR}px, ${joyVec.y * maxR}px)`;
    }
  }

  function joyStart(e) {
    initAudio();
    joyActive = true;
    const t = e.touches ? e.touches[0] : e;
    handleJoyMove(t.clientX, t.clientY);
  }
  function joyMove(e) {
    if (!joyActive) return;
    const t = e.touches ? e.touches[0] : e;
    handleJoyMove(t.clientX, t.clientY);
  }
  function joyEnd() {
    joyActive = false;
    joyVec.x = 0;
    joyVec.y = 0;
    joyKnob.style.transform = 'translate(0px, 0px)';
  }

  joyZone.addEventListener('mousedown', joyStart);
  window.addEventListener('mousemove', joyMove);
  window.addEventListener('mouseup', joyEnd);
  joyZone.addEventListener('touchstart', joyStart);
  window.addEventListener('touchmove', joyMove);
  window.addEventListener('touchend', joyEnd);

  btnAction.addEventListener('click', () => {
    initAudio();
    triggerNearestAction();
  });

  function attackMob(mob) {
    me.attackAnim = 12;
    playSound('slash');
    wsSend({ type: 'attack_mob', mobId: mob.id });
  }

  function triggerNearestAction() {
    if (!myId) return;

    // 1. Mission board close?
    const distBoard = Math.hypot(me.x - world.missionBoard.x, me.y - world.missionBoard.y);
    if (distBoard < 150) {
      wsSend({ type: 'open_mission' });
      return;
    }

    // 2. Boss close?
    if (world.bossMonster.isAlive) {
      const distBoss = Math.hypot(me.x - world.bossMonster.x, me.y - world.bossMonster.y);
      if (distBoss < 150) {
        wsSend({ type: 'trigger_boss' });
        return;
      }
    }

    // 3. Small mob close?
    let closestMob = null;
    let minDist = 120;
    for (const mob of world.smallMobs) {
      if (!mob.isAlive) continue;
      const d = Math.hypot(me.x - mob.x, me.y - mob.y);
      if (d < minDist) {
        minDist = d;
        closestMob = mob;
      }
    }
    if (closestMob) {
      attackMob(closestMob);
      return;
    }

    // 4. Other player close? Challenge duel
    let closestP = null;
    let minP = 130;
    for (const [id, p] of otherPlayers.entries()) {
      const d = Math.hypot(me.x - p.x, me.y - p.y);
      if (d < minP) {
        minP = d;
        closestP = p;
      }
    }
    if (closestP) {
      if (confirm(`Tantang ${closestP.name} berduel?`)) {
        wsSend({ type: 'challenge_duel', targetId: closestP.id });
      }
      return;
    }

    showToast('Dekati Monster, Boss, atau Papan Misi!');
  }

  // --- WEBSOCKET CONNECTION ---
  function connect(username) {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${proto}//${location.host}`);

    ws.onopen = () => {
      wsSend({ type: 'join', name: username });
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      handleWsMessage(msg);
    };

    ws.onclose = () => {
      showToast('Koneksi terputus. Silakan refresh halaman.');
    };
  }

  function wsSend(obj) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(obj));
    }
  }

  function handleWsMessage(msg) {
    switch (msg.type) {
      case 'init': {
        myId = msg.self.id;
        me.name = msg.self.name;
        me.x = msg.self.x;
        me.y = msg.self.y;
        me.targetX = me.x;
        me.targetY = me.y;
        me.hp = msg.self.hp;
        me.maxHp = msg.self.maxHp;
        me.coins = msg.self.coins;
        me.weaponLvl = msg.self.weaponLvl;
        me.weaponName = msg.self.weaponName;
        me.weaponAtk = msg.self.weaponAtk;
        me.weaponColor = msg.self.weaponColor;
        me.score = msg.self.score;

        world = { ...world, ...msg.world };
        updateHud();
        modalJoin.classList.add('modal-hidden');
        refreshLeaderboard();
        break;
      }

      case 'world_tick': {
        // Update players
        for (const p of msg.players) {
          if (p.id === myId) {
            me.hp = p.hp;
            updateHud();
          } else {
            const existing = otherPlayers.get(p.id);
            if (existing) {
              existing.x += (p.x - existing.x) * 0.35;
              existing.y += (p.y - existing.y) * 0.35;
              existing.vx = p.vx;
              existing.vy = p.vy;
              existing.facing = p.facing || 1;
              existing.hp = p.hp;
              existing.weaponLvl = p.weaponLvl;
              existing.weaponName = p.weaponName;
              existing.weaponColor = p.weaponColor;
              existing.inDuel = p.inDuel;
            } else {
              otherPlayers.set(p.id, { ...p });
            }
          }
        }
        const activeIds = new Set(msg.players.map(p => p.id));
        for (const id of otherPlayers.keys()) {
          if (!activeIds.has(id)) otherPlayers.delete(id);
        }

        // Update mobs
        if (msg.mobs) {
          for (const sm of msg.mobs) {
            const existingMob = world.smallMobs.find(m => m.id === sm.id);
            if (existingMob) {
              existingMob.x += (sm.x - existingMob.x) * 0.25;
              existingMob.y += (sm.y - existingMob.y) * 0.25;
              existingMob.hp = sm.hp;
              existingMob.isAlive = sm.isAlive;
            } else {
              world.smallMobs.push(sm);
            }
          }
        }

        // Update boss
        if (msg.boss) {
          world.bossMonster.hp = msg.boss.hp;
          world.bossMonster.isAlive = msg.boss.isAlive;
        }
        break;
      }

      case 'chat': {
        appendChat(msg.from, msg.text);
        break;
      }

      case 'alert': {
        showToast(msg.msg);
        break;
      }

      case 'damage_effect': {
        playSound('hit');
        addFloatingText(`-${msg.dmg}`, msg.x, msg.y - 25, '#ff3d00');
        spawnHitParticles(msg.x, msg.y, '#ff5252', 12);
        if (msg.targetType === 'mob') {
          const mob = world.smallMobs.find(m => m.id === msg.targetId);
          if (mob) mob.hp -= msg.dmg;
        } else if (msg.targetType === 'boss') {
          world.bossMonster.hp = Math.max(0, world.bossMonster.hp - msg.dmg);
        }
        break;
      }

      case 'reward': {
        playSound('coin');
        me.coins = msg.coins;
        me.score = msg.score;
        updateHud();
        addFloatingText(msg.msg, me.x, me.y - 35, '#ffd700');
        spawnHitParticles(me.x, me.y, '#ffd700', 10);
        break;
      }

      case 'mob_spawn': {
        const mob = world.smallMobs.find(m => m.id === msg.mob.id);
        if (mob) Object.assign(mob, msg.mob);
        break;
      }

      case 'mob_died': {
        const mob = world.smallMobs.find(m => m.id === msg.mobId);
        if (mob) {
          mob.isAlive = false;
          spawnHitParticles(mob.x, mob.y, '#69f0ae', 16);
        }
        break;
      }

      case 'boss_spawn': {
        Object.assign(world.bossMonster, msg.boss);
        showToast('👑 Raja Golem bangkit kembali di arena!');
        break;
      }

      case 'boss_died': {
        world.bossMonster.isAlive = false;
        playSound('upgrade');
        spawnHitParticles(world.bossMonster.x, world.bossMonster.y, '#ffd700', 30);
        break;
      }

      // --- MISSION BOARD POPUP ---
      case 'mission_popup': {
        activeMissionData = msg;
        missionCost.innerText = msg.cost;
        missionPlayerCoins.innerText = msg.currentCoins;
        missionInfo.innerHTML = `Tingkatkan senjatamu ke <b>${msg.nextWeapon.name}</b> (ATK: ${msg.nextWeapon.atk})!<br><span style="font-size:12px;color:#795548;">${msg.nextWeapon.desc}</span>`;

        missionQuizArea.classList.add('modal-hidden');
        document.getElementById('mission-buttons-init').classList.remove('modal-hidden');
        modalMission.classList.remove('modal-hidden');
        break;
      }

      case 'upgrade_success': {
        playSound('upgrade');
        me.weaponLvl = msg.weaponLvl;
        me.weaponName = msg.weaponName;
        me.weaponAtk = msg.weaponAtk;
        me.weaponColor = msg.weaponColor;
        me.coins = msg.coins;
        me.score = msg.score;
        updateHud();
        modalMission.classList.add('modal-hidden');
        showToast(msg.msg);
        addFloatingText(`UPGRADE: ${msg.weaponName}!`, me.x, me.y - 45, '#00e676');
        spawnHitParticles(me.x, me.y, '#76ff03', 25);
        refreshLeaderboard();
        break;
      }

      case 'upgrade_fail': {
        playSound('wrong');
        showToast(msg.msg);
        break;
      }

      // --- BOSS QUESTION POPUP ---
      case 'boss_question_popup': {
        activeBossQ = msg.question;
        bossQuestion.innerHTML = `<b>[${msg.question.subject}]</b> ${msg.question.question}`;
        bossOptions.innerHTML = '';
        ['A', 'B', 'C', 'D'].forEach(opt => {
          const btn = document.createElement('button');
          btn.className = 'quiz-opt-btn';
          btn.innerText = `${opt}. ${msg.question['opt_' + opt.toLowerCase()]}`;
          btn.onclick = () => {
            wsSend({ type: 'answer_boss', questionId: activeBossQ.id, answer: opt });
            modalBoss.classList.add('modal-hidden');
          };
          bossOptions.appendChild(btn);
        });
        modalBoss.classList.remove('modal-hidden');
        break;
      }

      case 'boss_result': {
        if (msg.success) {
          playSound('coin');
          showToast(msg.msg);
        } else {
          playSound('wrong');
          showToast(msg.msg);
        }
        break;
      }

      // --- DUEL EVENTS ---
      case 'duel_request': {
        currentChallengerId = msg.challengerId;
        duelChallengerName.innerText = msg.challengerName;
        duelChallengerWeapon.innerText = `${msg.weaponName} (Lv.${msg.weaponLvl})`;
        modalDuelConfirm.classList.remove('modal-hidden');
        break;
      }

      case 'duel_start': {
        modalDuelConfirm.classList.add('modal-hidden');
        const isP1Me = msg.p1.id === myId;
        duelP1Name.innerText = isP1Me ? `${msg.p1.name} (Kamu)` : `${msg.p1.name} (Lawan)`;
        duelP2Name.innerText = !isP1Me ? `${msg.p2.name} (Kamu)` : `${msg.p2.name} (Lawan)`;
        duelP1Hp.style.width = '100%';
        duelP2Hp.style.width = '100%';
        renderDuelQuestion(msg.question);
        modalDuelArena.classList.remove('modal-hidden');
        break;
      }

      case 'duel_hit': {
        playSound('hit');
        showToast(`${msg.attackerName} tebas ${msg.defenderName} (-${msg.dmg} HP)!`);
        const myHpVal = msg.attackerId === myId ? msg.attackerHp : msg.defenderHp;
        const oppHpVal = msg.attackerId === myId ? msg.defenderHp : msg.attackerHp;
        duelP1Hp.style.width = `${Math.max(0, myHpVal)}%`;
        duelP2Hp.style.width = `${Math.max(0, oppHpVal)}%`;
        break;
      }

      case 'duel_next_question': {
        renderDuelQuestion(msg.question);
        break;
      }

      case 'duel_wrong_answer': {
        playSound('wrong');
        showToast(msg.msg);
        setTimeout(() => {
          Array.from(duelOptions.children).forEach(b => b.disabled = false);
        }, 1000);
        break;
      }

      case 'duel_end': {
        modalDuelArena.classList.add('modal-hidden');
        if (msg.winnerId === myId) {
          playSound('upgrade');
          showToast(`🏆 KAMU MENANG DUEL MELAWAN ${msg.loserName}! (+25 Koin, +120 Skor)`);
        } else {
          playSound('wrong');
          showToast(`💀 Kamu kalah dalam duel melawan ${msg.winnerName}.`);
        }
        refreshLeaderboard();
        break;
      }
    }
  }

  function renderDuelQuestion(q) {
    activeDuelQ = q;
    duelQuestion.innerHTML = `<b>[${q.subject}]</b> ${q.question}`;
    duelOptions.innerHTML = '';
    ['A', 'B', 'C', 'D'].forEach(opt => {
      const btn = document.createElement('button');
      btn.className = 'quiz-opt-btn';
      btn.innerText = `${opt}. ${q['opt_' + opt.toLowerCase()]}`;
      btn.onclick = () => {
        wsSend({ type: 'answer_duel', questionId: activeDuelQ.id, answer: opt });
        Array.from(duelOptions.children).forEach(b => b.disabled = true);
      };
      duelOptions.appendChild(btn);
    });
  }

  btnJoin.onclick = () => {
    initAudio();
    const name = inputUsername.value.trim();
    if (!name) return alert('Nama ksatria harus diisi!');
    connect(name);
  };
  inputUsername.onkeydown = (e) => {
    if (e.key === 'Enter') btnJoin.onclick();
  };

  btnStartMission.onclick = () => {
    if (!activeMissionData) return;
    if (me.coins < activeMissionData.cost) {
      showToast('Koin tidak mencukupi untuk ujian upgrade!');
      return;
    }
    const q = activeMissionData.question;
    missionQuestion.innerHTML = `<b>[${q.subject} - Tingkat ${q.tier}]</b> ${q.question}`;
    missionOptions.innerHTML = '';
    ['A', 'B', 'C', 'D'].forEach(opt => {
      const btn = document.createElement('button');
      btn.className = 'quiz-opt-btn';
      btn.innerText = `${opt}. ${q['opt_' + opt.toLowerCase()]}`;
      btn.onclick = () => {
        wsSend({ type: 'answer_mission', questionId: q.id, answer: opt });
      };
      missionOptions.appendChild(btn);
    });

    missionQuizArea.classList.remove('modal-hidden');
    document.getElementById('mission-buttons-init').classList.add('modal-hidden');
  };

  btnCloseMission.onclick = () => modalMission.classList.add('modal-hidden');
  btnCloseBoss.onclick = () => modalBoss.classList.add('modal-hidden');

  btnAcceptDuel.onclick = () => {
    wsSend({ type: 'respond_duel', challengerId: currentChallengerId, accept: true });
    modalDuelConfirm.classList.add('modal-hidden');
  };
  btnRejectDuel.onclick = () => {
    wsSend({ type: 'respond_duel', challengerId: currentChallengerId, accept: false });
    modalDuelConfirm.classList.add('modal-hidden');
  };
  btnSurrenderDuel.onclick = () => {
    if (confirm('Yakin ingin menyerah dalam duel?')) {
      wsSend({ type: 'surrender_duel' });
      modalDuelArena.classList.add('modal-hidden');
    }
  };

  chatForm.onsubmit = (e) => {
    e.preventDefault();
    const text = chatInput.value.trim();
    if (text) {
      wsSend({ type: 'chat', text });
      chatInput.value = '';
    }
  };

  function appendChat(from, text) {
    const el = document.createElement('div');
    if (from === 'SISTEM') el.className = 'chat-msg-system';
    else if (from === 'PENGUMUMAN' || from === 'DUEL') el.className = 'chat-msg-duel';
    else el.className = 'chat-msg-player';
    el.innerText = `${from}: ${text}`;
    chatMessages.appendChild(el);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function updateHud() {
    hudName.innerText = me.name;
    hudHpBar.style.width = `${(me.hp / me.maxHp) * 100}%`;
    hudCoins.innerText = me.coins;
    hudWeapon.innerText = `Lv.${me.weaponLvl} ${me.weaponName}`;
    hudAtk.innerText = me.weaponAtk;
    hudScore.innerText = `Skor: ${me.score}`;
  }

  async function refreshLeaderboard() {
    try {
      const res = await fetch('/api/stats');
      const list = await res.json();
      leaderboardList.innerHTML = '';
      list.slice(0, 5).forEach((p, idx) => {
        const li = document.createElement('li');
        li.innerHTML = `<span>${idx + 1}. ${p.username} (Lv.${p.weapon_lvl})</span> <b>${p.score}</b>`;
        leaderboardList.appendChild(li);
      });
    } catch {}
  }

  // --- GAME UPDATE & RENDER LOOP ---
  let lastMoveSent = 0;

  function update() {
    if (!myId) return;
    animTick++;

    let moveX = 0;
    let moveY = 0;

    // Keyboard
    if (keys['w'] || keys['arrowup']) moveY -= 1;
    if (keys['s'] || keys['arrowdown']) moveY += 1;
    if (keys['a'] || keys['arrowleft']) moveX -= 1;
    if (keys['d'] || keys['arrowright']) moveX += 1;

    // Joystick
    if (joyActive) {
      moveX += joyVec.x;
      moveY += joyVec.y;
    }

    if (moveX !== 0 || moveY !== 0) {
      const len = Math.hypot(moveX, moveY);
      me.vx = (moveX / len) * me.speed;
      me.vy = (moveY / len) * me.speed;
      me.x += me.vx;
      me.y += me.vy;
      me.targetX = me.x;
      me.targetY = me.y;
      targetedMobId = null;
      if (me.vx > 0.2) me.facing = 1;
      else if (me.vx < -0.2) me.facing = -1;
      me.walkFrame += 0.25;
    } else {
      // Move towards click or targeted mob
      let destX = me.targetX;
      let destY = me.targetY;
      if (targetedMobId) {
        const tm = world.smallMobs.find(m => m.id === targetedMobId && m.isAlive);
        if (tm) {
          destX = tm.x;
          destY = tm.y;
        } else {
          targetedMobId = null;
        }
      }

      const dx = destX - me.x;
      const dy = destY - me.y;
      const dist = Math.hypot(dx, dy);
      const stopDist = targetedMobId ? 80 : 4;

      if (dist > stopDist) {
        me.vx = (dx / dist) * Math.min(dist, me.speed);
        me.vy = (dy / dist) * Math.min(dist, me.speed);
        me.x += me.vx;
        me.y += me.vy;
        if (me.vx > 0.2) me.facing = 1;
        else if (me.vx < -0.2) me.facing = -1;
        me.walkFrame += 0.25;
      } else {
        me.vx = 0;
        me.vy = 0;
        me.walkFrame = 0;
        if (targetedMobId) {
          const tm = world.smallMobs.find(m => m.id === targetedMobId && m.isAlive);
          if (tm) {
            attackMob(tm);
            targetedMobId = null;
          }
        }
      }
    }

    // World bounds
    me.x = Math.max(35, Math.min(world.width - 35, me.x));
    me.y = Math.max(35, Math.min(world.height - 35, me.y));

    if (me.attackAnim > 0) me.attackAnim--;

    // Send position to server throttled (50ms)
    const now = Date.now();
    if (now - lastMoveSent > 50) {
      wsSend({ type: 'move', x: me.x, y: me.y });
      lastMoveSent = now;
    }

    // Update floating texts
    for (let i = floatingTexts.length - 1; i >= 0; i--) {
      const ft = floatingTexts[i];
      ft.y += ft.vy;
      ft.alpha -= 0.02;
      if (ft.alpha <= 0) floatingTexts.splice(i, 1);
    }

    // Update particles
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.life -= p.decay;
      if (p.life <= 0) particles.splice(i, 1);
    }
  }

  function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!myId) {
      requestAnimationFrame(render);
      return;
    }

    // Camera follow with smooth bounds
    const camX = me.x - canvas.width / 2;
    const camY = me.y - canvas.height / 2;

    ctx.save();
    ctx.translate(-camX, -camY);

    // 1. World Terrain (Realistic RPG Grassland & Paths)
    renderTerrain();

    // 2. Obstacles (Stylized realistic trees & boulders)
    renderObstacles();

    // 3. Mission Board (Ancient stone runic altar with glowing parchment)
    renderMissionBoard();

    // 4. Boss Monster (Realistic Colossus Golem)
    renderBossMonster();

    // 5. Small Mobs (Realistic Slimes, Goblins, Wolves)
    for (const mob of world.smallMobs) {
      if (!mob.isAlive) continue;
      renderRealisticMob(mob);
    }

    // 6. Other Players
    for (const [id, p] of otherPlayers.entries()) {
      renderRealisticCharacter(p.x, p.y, p.name, p.weaponColor, p.weaponLvl, false, p.inDuel, p.facing || 1, p.vx || 0, p.vy || 0, 0);
    }

    // 7. Self Player
    renderRealisticCharacter(me.x, me.y, me.name, me.weaponColor, me.weaponLvl, true, false, me.facing, me.vx, me.vy, me.attackAnim);

    // 8. Particles
    for (const p of particles) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // 9. Floating Texts
    for (const ft of floatingTexts) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, ft.alpha);
      ctx.fillStyle = ft.color;
      ctx.font = 'bold 16px sans-serif';
      ctx.textAlign = 'center';
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
      ctx.lineWidth = 4;
      ctx.strokeText(ft.text, ft.x, ft.y);
      ctx.fillText(ft.text, ft.x, ft.y);
      ctx.restore();
    }

    ctx.restore();

    renderMinimap();
    requestAnimationFrame(render);
  }

  // --- REALISTIC GRAPHICS RENDERING FUNCTIONS ---

  function renderTerrain() {
    // Lush green RPG base
    const grad = ctx.createLinearGradient(0, 0, world.width, world.height);
    grad.addColorStop(0, '#558b2f');
    grad.addColorStop(1, '#33691e');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, world.width, world.height);

    // Stone pathway around mission board and boss
    ctx.fillStyle = '#8d6e63';
    ctx.beginPath();
    ctx.ellipse(world.missionBoard.x, world.missionBoard.y, 140, 100, 0, 0, Math.PI * 2);
    ctx.fill();

    // Grass clumps
    ctx.fillStyle = '#689f38';
    for (let gx = 80; gx < world.width; gx += 160) {
      for (let gy = 80; gy < world.height; gy += 160) {
        ctx.beginPath();
        ctx.ellipse(gx, gy, 12, 6, Math.PI / 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // World border wall (Stone fortress battlements)
    ctx.strokeStyle = '#272727';
    ctx.lineWidth = 14;
    ctx.strokeRect(0, 0, world.width, world.height);
  }

  function renderObstacles() {
    for (const obs of world.obstacles) {
      if (obs.type === 'tree') {
        // Drop shadow
        ctx.fillStyle = 'rgba(10, 20, 10, 0.35)';
        ctx.beginPath();
        ctx.ellipse(obs.x, obs.y + obs.r * 0.75, obs.r * 1.1, obs.r * 0.45, 0, 0, Math.PI * 2);
        ctx.fill();

        // Realistic layered trunk
        const trunkGrad = ctx.createLinearGradient(obs.x - 12, obs.y, obs.x + 12, obs.y);
        trunkGrad.addColorStop(0, '#4e342e');
        trunkGrad.addColorStop(0.5, '#795548');
        trunkGrad.addColorStop(1, '#3e2723');
        ctx.fillStyle = trunkGrad;
        ctx.beginPath();
        ctx.moveTo(obs.x - 12, obs.y + obs.r * 0.7);
        ctx.lineTo(obs.x - 7, obs.y - 10);
        ctx.lineTo(obs.x + 7, obs.y - 10);
        ctx.lineTo(obs.x + 12, obs.y + obs.r * 0.7);
        ctx.closePath();
        ctx.fill();

        // Foliage layers with rich shading
        const leaves = [
          { dx: 0, dy: -obs.r * 0.5, r: obs.r, c1: '#2e7d32', c2: '#1b5e20' },
          { dx: -obs.r * 0.35, dy: -obs.r * 0.25, r: obs.r * 0.8, c1: '#388e3c', c2: '#2e7d32' },
          { dx: obs.r * 0.35, dy: -obs.r * 0.25, r: obs.r * 0.8, c1: '#43a047', c2: '#2e7d32' },
          { dx: 0, dy: -obs.r * 0.75, r: obs.r * 0.75, c1: '#4caf50', c2: '#388e3c' }
        ];
        for (const l of leaves) {
          const lGrad = ctx.createRadialGradient(obs.x + l.dx - 10, obs.y + l.dy - 10, 5, obs.x + l.dx, obs.y + l.dy, l.r);
          lGrad.addColorStop(0, l.c1);
          lGrad.addColorStop(1, l.c2);
          ctx.fillStyle = lGrad;
          ctx.beginPath();
          ctx.arc(obs.x + l.dx, obs.y + l.dy, l.r, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (obs.type === 'rock') {
        // Realistic craggy boulder
        ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.beginPath();
        ctx.ellipse(obs.x, obs.y + obs.r * 0.6, obs.r * 1.1, obs.r * 0.5, 0, 0, Math.PI * 2);
        ctx.fill();

        const rockGrad = ctx.createRadialGradient(obs.x - obs.r * 0.3, obs.y - obs.r * 0.3, 5, obs.x, obs.y, obs.r);
        rockGrad.addColorStop(0, '#cfd8dc');
        rockGrad.addColorStop(0.6, '#78909c');
        rockGrad.addColorStop(1, '#37474f');
        ctx.fillStyle = rockGrad;
        ctx.beginPath();
        ctx.arc(obs.x, obs.y, obs.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function renderMissionBoard() {
    const mb = world.missionBoard;
    // Ancient magic circle aura
    const pulse = Math.sin(animTick * 0.05) * 6;
    ctx.fillStyle = 'rgba(255, 215, 0, 0.18)';
    ctx.beginPath();
    ctx.arc(mb.x, mb.y, mb.radius + 18 + pulse, 0, Math.PI * 2);
    ctx.fill();

    // Stone dais
    ctx.fillStyle = '#616161';
    ctx.strokeStyle = '#37474f';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(mb.x, mb.y, mb.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Golden runic ring
    ctx.strokeStyle = '#ffd54f';
    ctx.lineWidth = 3;
    ctx.setLineDash([8, 6]);
    ctx.beginPath();
    ctx.arc(mb.x, mb.y, mb.radius - 10, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Open book / parchment icon
    ctx.fillStyle = '#fff9c4';
    ctx.fillRect(mb.x - 22, mb.y - 14, 44, 28);
    ctx.fillStyle = '#5d4037';
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('MISI', mb.x, mb.y + 4);

    // Board Title
    ctx.font = 'bold 14px sans-serif';
    ctx.fillStyle = '#ffe082';
    ctx.strokeStyle = '#212121';
    ctx.lineWidth = 3;
    ctx.strokeText('📜 Papan Misi Pengetahuan', mb.x, mb.y - mb.radius - 12);
    ctx.fillText('📜 Papan Misi Pengetahuan', mb.x, mb.y - mb.radius - 12);
  }

  function renderBossMonster() {
    const boss = world.bossMonster;
    if (!boss.isAlive) return;

    const hover = Math.sin(animTick * 0.06) * 6;
    const bx = boss.x;
    const by = boss.y + hover;
    const r = boss.radius;

    // Colossus ground aura
    ctx.fillStyle = 'rgba(123, 31, 162, 0.22)';
    ctx.beginPath();
    ctx.ellipse(bx, boss.y + r + 15, r * 1.3, r * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();

    // Orbiting ancient magical rune glyphs
    const orbitCount = 4;
    for (let i = 0; i < orbitCount; i++) {
      const angle = (animTick * 0.03) + (i * (Math.PI * 2 / orbitCount));
      const ox = bx + Math.cos(angle) * (r + 30);
      const oy = by + Math.sin(angle) * (r * 0.6);
      ctx.fillStyle = '#e040fb';
      ctx.shadowColor = '#e040fb';
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(ox, oy, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    // Heavy Chiseled Stone Body
    const stoneGrad = ctx.createRadialGradient(bx - 15, by - 15, 10, bx, by, r);
    stoneGrad.addColorStop(0, '#5c6bc0');
    stoneGrad.addColorStop(0.7, '#283593');
    stoneGrad.addColorStop(1, '#1a237e');
    ctx.fillStyle = stoneGrad;
    ctx.strokeStyle = '#0d47a1';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(bx, by, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Runic Chest Plate with Glowing Glyph
    ctx.fillStyle = '#ff80ab';
    ctx.shadowColor = '#ff4081';
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.moveTo(bx, by - 16);
    ctx.lineTo(bx + 14, by + 12);
    ctx.lineTo(bx - 14, by + 12);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;

    // Menacing glowing eyes
    ctx.fillStyle = '#ff1744';
    ctx.shadowColor = '#ff1744';
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.ellipse(bx - 16, by - 12, 6, 8, -0.2, 0, Math.PI * 2);
    ctx.ellipse(bx + 16, by - 12, 6, 8, 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // Ancient Granite Horns
    ctx.fillStyle = '#1a237e';
    ctx.beginPath();
    ctx.moveTo(bx - 25, by - r + 8);
    ctx.quadraticCurveTo(bx - 45, by - r - 25, bx - 20, by - r - 35);
    ctx.lineTo(bx - 15, by - r + 5);
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(bx + 25, by - r + 8);
    ctx.quadraticCurveTo(bx + 45, by - r - 25, bx + 20, by - r - 35);
    ctx.lineTo(bx + 15, by - r + 5);
    ctx.fill();

    // Boss Name & HP Bar
    ctx.font = 'bold 15px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ff80ab';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 4;
    ctx.strokeText(`👑 ${boss.name}`, bx, by - r - 42);
    ctx.fillText(`👑 ${boss.name}`, bx, by - r - 42);

    const barW = 120;
    const barH = 10;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(bx - barW / 2, by - r - 34, barW, barH);
    ctx.fillStyle = '#e91e63';
    ctx.fillRect(bx - barW / 2 + 1, by - r - 33, ((boss.hp / boss.maxHp) * (barW - 2)), barH - 2);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(bx - barW / 2, by - r - 34, barW, barH);
  }

  function renderRealisticMob(mob) {
    const mx = mob.x;
    const my = mob.y;
    const type = mob.type || 'slime';
    const r = mob.radius || 22;

    // Ground shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
    ctx.beginPath();
    ctx.ellipse(mx, my + r * 0.75, r * 1.1, r * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();

    if (type === 'slime') {
      // Volumetric translucent squishy slime
      const wobble = Math.sin(animTick * 0.15 + mob.id) * 3;
      const squishX = r + wobble;
      const squishY = r - wobble * 0.8;

      const slimeGrad = ctx.createRadialGradient(mx - 6, my - 6, 4, mx, my, r);
      slimeGrad.addColorStop(0, '#81d4fa');
      slimeGrad.addColorStop(0.7, '#0288d1');
      slimeGrad.addColorStop(1, '#01579b');
      ctx.fillStyle = slimeGrad;
      ctx.strokeStyle = '#0277bd';
      ctx.lineWidth = 2.5;

      ctx.beginPath();
      ctx.ellipse(mx, my, squishX, squishY, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Specular highlight
      ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
      ctx.beginPath();
      ctx.ellipse(mx - squishX * 0.35, my - squishY * 0.35, squishX * 0.35, squishY * 0.2, -0.4, 0, Math.PI * 2);
      ctx.fill();

      // Slime cute eyes
      ctx.fillStyle = '#0d47a1';
      ctx.beginPath();
      ctx.arc(mx - 7, my - 2, 3.5, 0, Math.PI * 2);
      ctx.arc(mx + 7, my - 2, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(mx - 8, my - 3, 1.2, 0, Math.PI * 2);
      ctx.arc(mx + 6, my - 3, 1.2, 0, Math.PI * 2);
      ctx.fill();
    } else if (type === 'goblin') {
      // Green goblin raider with ears & spiked club
      const gGrad = ctx.createRadialGradient(mx - 4, my - 4, 3, mx, my, r);
      gGrad.addColorStop(0, '#81c784');
      gGrad.addColorStop(0.8, '#388e3c');
      gGrad.addColorStop(1, '#1b5e20');
      ctx.fillStyle = gGrad;
      ctx.beginPath();
      ctx.arc(mx, my, r, 0, Math.PI * 2);
      ctx.fill();

      // Pointed ears
      ctx.fillStyle = '#2e7d32';
      ctx.beginPath();
      ctx.moveTo(mx - r + 2, my - 4);
      ctx.lineTo(mx - r - 12, my - 12);
      ctx.lineTo(mx - r + 4, my + 6);
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(mx + r - 2, my - 4);
      ctx.lineTo(mx + r + 12, my - 12);
      ctx.lineTo(mx + r - 4, my + 6);
      ctx.fill();

      // Angry yellow slit eyes
      ctx.fillStyle = '#ffd600';
      ctx.beginPath();
      ctx.ellipse(mx - 6, my - 3, 4, 2.5, 0.2, 0, Math.PI * 2);
      ctx.ellipse(mx + 6, my - 3, 4, 2.5, -0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#212121';
      ctx.fillRect(mx - 7, my - 5, 2, 4);
      ctx.fillRect(mx + 5, my - 5, 2, 4);

      // Spiked morningstar weapon
      ctx.fillStyle = '#37474f';
      ctx.beginPath();
      ctx.arc(mx + r + 6, my + 4, 7, 0, Math.PI * 2);
      ctx.fill();
    } else if (type === 'wolf') {
      // Shadow wolf with predator snout & red eyes
      const wGrad = ctx.createRadialGradient(mx - 4, my - 4, 4, mx, my, r);
      wGrad.addColorStop(0, '#546e7a');
      wGrad.addColorStop(0.7, '#263238');
      wGrad.addColorStop(1, '#102027');
      ctx.fillStyle = wGrad;
      ctx.beginPath();
      ctx.ellipse(mx, my, r * 1.15, r * 0.85, 0, 0, Math.PI * 2);
      ctx.fill();

      // Wolf pointed ears
      ctx.fillStyle = '#263238';
      ctx.beginPath();
      ctx.moveTo(mx - 12, my - r * 0.7);
      ctx.lineTo(mx - 16, my - r - 8);
      ctx.lineTo(mx - 4, my - r * 0.7);
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(mx + 4, my - r * 0.7);
      ctx.lineTo(mx + 16, my - r - 8);
      ctx.lineTo(mx + 12, my - r * 0.7);
      ctx.fill();

      // Glowing crimson eyes
      ctx.fillStyle = '#ff1744';
      ctx.beginPath();
      ctx.arc(mx - 6, my - 2, 3, 0, Math.PI * 2);
      ctx.arc(mx + 6, my - 2, 3, 0, Math.PI * 2);
      ctx.fill();

      // Bushy tail sway
      const tailAngle = Math.sin(animTick * 0.15 + mob.id) * 0.4;
      ctx.save();
      ctx.translate(mx - r, my);
      ctx.rotate(tailAngle);
      ctx.fillStyle = '#37474f';
      ctx.beginPath();
      ctx.ellipse(-10, 0, 10, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Mob Health Bar
    const hpBarW = 38;
    const hpBarH = 5;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(mx - hpBarW / 2, my - r - 12, hpBarW, hpBarH);
    ctx.fillStyle = '#4caf50';
    ctx.fillRect(mx - hpBarW / 2, my - r - 12, ((mob.hp / mob.maxHp) * hpBarW), hpBarH);
    ctx.strokeStyle = '#212121';
    ctx.lineWidth = 1;
    ctx.strokeRect(mx - hpBarW / 2, my - r - 12, hpBarW, hpBarH);
  }

  function renderRealisticCharacter(x, y, name, weaponColor, weaponLvl, isMe, inDuel, facing, vx, vy, attackAnim) {
    const isMoving = Math.hypot(vx, vy) > 0.3;
    const walkStride = isMoving ? Math.sin(animTick * 0.3) * 6 : 0;

    // Ground Shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.beginPath();
    ctx.ellipse(x, y + 20, 20, 9, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.translate(x, y);
    if (facing < 0) ctx.scale(-1, 1);

    // 1. Flowing Knight Cape
    const capeFlap = isMoving ? Math.sin(animTick * 0.25) * 8 : Math.sin(animTick * 0.08) * 3;
    ctx.fillStyle = isMe ? '#c62828' : '#1565c0';
    ctx.beginPath();
    ctx.moveTo(-10, -6);
    ctx.quadraticCurveTo(-22 - capeFlap, 10, -14 - capeFlap, 22);
    ctx.lineTo(-4, 20);
    ctx.lineTo(-4, -6);
    ctx.closePath();
    ctx.fill();

    // 2. Leather Boots with walking cycle
    ctx.fillStyle = '#3e2723';
    // Left foot
    ctx.beginPath();
    ctx.ellipse(-7, 18 + walkStride, 5, 3.5, 0, 0, Math.PI * 2);
    ctx.fill();
    // Right foot
    ctx.beginPath();
    ctx.ellipse(7, 18 - walkStride, 5, 3.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // 3. Steel Armored Torso / Breastplate
    const armorGrad = ctx.createLinearGradient(-12, -10, 12, 14);
    armorGrad.addColorStop(0, isMe ? '#eceff1' : '#b0bec5');
    armorGrad.addColorStop(0.6, isMe ? '#90a4ae' : '#78909c');
    armorGrad.addColorStop(1, '#455a64');
    ctx.fillStyle = armorGrad;
    ctx.strokeStyle = '#263238';
    ctx.lineWidth = 2.5;

    ctx.beginPath();
    ctx.roundRect(-12, -8, 24, 22, 6);
    ctx.fill();
    ctx.stroke();

    // Gold trim on knight armor
    ctx.strokeStyle = '#ffd54f';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(-8, -4, 16, 12);

    // 4. Shoulder Pauldrons
    ctx.fillStyle = '#607d8b';
    ctx.beginPath();
    ctx.arc(-13, -6, 5, 0, Math.PI * 2);
    ctx.arc(13, -6, 5, 0, Math.PI * 2);
    ctx.fill();

    // 5. Shield on Left Arm
    ctx.fillStyle = '#455a64';
    ctx.strokeStyle = '#ffd54f';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-14, -8);
    ctx.lineTo(-6, -8);
    ctx.lineTo(-6, 8);
    ctx.lineTo(-10, 14);
    ctx.lineTo(-14, 8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // 6. Knight Head & Visor Helmet
    // Face skin
    ctx.fillStyle = '#ffcc80';
    ctx.beginPath();
    ctx.arc(0, -18, 11, 0, Math.PI * 2);
    ctx.fill();

    // Knight Helmet / Circlet
    ctx.fillStyle = '#78909c';
    ctx.beginPath();
    ctx.arc(0, -21, 11, Math.PI, Math.PI * 2);
    ctx.fill();

    // Expressive Knight Eyes
    ctx.fillStyle = '#212121';
    ctx.beginPath();
    ctx.arc(3, -18, 2, 0, Math.PI * 2);
    ctx.arc(7, -18, 2, 0, Math.PI * 2);
    ctx.fill();

    // Helmet plume feather
    ctx.fillStyle = isMe ? '#ff1744' : '#00e5ff';
    ctx.beginPath();
    ctx.moveTo(0, -32);
    ctx.quadraticCurveTo(-6, -26, 0, -22);
    ctx.quadraticCurveTo(6, -26, 0, -32);
    ctx.fill();

    // 7. Dynamic RPG Weapon on Right Hand
    const swingAngle = attackAnim > 0 ? (attackAnim / 12) * Math.PI * 0.85 : 0;
    ctx.save();
    ctx.translate(14, 4);
    ctx.rotate(0.2 - swingAngle);

    renderRealisticWeapon(weaponLvl, weaponColor);
    ctx.restore();

    ctx.restore();

    // Player Nametag & Level Badge
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = isMe ? '#ffff8d' : '#ffffff';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 3.5;
    const tag = inDuel ? `⚔️ [DUEL] ${name}` : `${name} (Lv.${weaponLvl})`;
    ctx.strokeText(tag, x, y - 38);
    ctx.fillText(tag, x, y - 38);

    // HP Mini Bar
    const pBarW = 44;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(x - pBarW / 2, y - 34, pBarW, 5);
    ctx.fillStyle = isMe ? '#00e676' : '#29b6f6';
    const hpVal = isMe ? me.hp : 100;
    ctx.fillRect(x - pBarW / 2, y - 34, (hpVal / 100) * pBarW, 5);
  }

  function renderRealisticWeapon(level, color) {
    if (level === 1) {
      // Lv.1: Magic Oak Staff with glowing emerald crystal
      ctx.fillStyle = '#5d4037';
      ctx.fillRect(-2, -26, 5, 34);
      ctx.fillStyle = '#00e676';
      ctx.shadowColor = '#00e676';
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(0, -28, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
    } else if (level === 2) {
      // Lv.2: Steel Knight Sword
      ctx.fillStyle = '#cfd8dc';
      ctx.strokeStyle = '#37474f';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(-3, -26);
      ctx.lineTo(0, -32);
      ctx.lineTo(3, -26);
      ctx.lineTo(3, 4);
      ctx.lineTo(-3, 4);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Golden crossguard
      ctx.fillStyle = '#ffd54f';
      ctx.fillRect(-7, 4, 15, 3.5);
      // Leather hilt
      ctx.fillStyle = '#4e342e';
      ctx.fillRect(-2, 7.5, 4, 6);
    } else if (level === 3) {
      // Lv.3: Flame Falchion with animated burning fire particles
      ctx.fillStyle = '#ff3d00';
      ctx.beginPath();
      ctx.moveTo(-4, -28);
      ctx.quadraticCurveTo(8, -20, 4, 4);
      ctx.lineTo(-4, 4);
      ctx.closePath();
      ctx.fill();

      // Flame glow aura
      ctx.fillStyle = '#ffeb3b';
      ctx.shadowColor = '#ff5722';
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(0, -18, 4 + Math.sin(animTick * 0.4) * 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      // Guard
      ctx.fillStyle = '#bf360c';
      ctx.fillRect(-7, 4, 15, 4);
    } else if (level === 4) {
      // Lv.4: Lightning Halberd with electric sparks
      ctx.fillStyle = '#ffd600';
      ctx.fillRect(-2, -34, 4, 42);

      ctx.fillStyle = '#40c4ff';
      ctx.shadowColor = '#00e5ff';
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.moveTo(0, -38);
      ctx.lineTo(10, -26);
      ctx.lineTo(0, -22);
      ctx.lineTo(-10, -26);
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;
    } else {
      // Lv.5: Holy Mythic Blade with celestial prismatic aura
      const bladeGrad = ctx.createLinearGradient(0, -38, 0, 8);
      bladeGrad.addColorStop(0, '#ffffff');
      bladeGrad.addColorStop(0.5, '#ea80fc');
      bladeGrad.addColorStop(1, '#7c4dff');
      ctx.fillStyle = bladeGrad;
      ctx.shadowColor = '#e040fb';
      ctx.shadowBlur = 16;
      ctx.beginPath();
      ctx.moveTo(-4, -30);
      ctx.lineTo(0, -42);
      ctx.lineTo(4, -30);
      ctx.lineTo(4, 6);
      ctx.lineTo(-4, 6);
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;

      // Divine golden wings guard
      ctx.fillStyle = '#ffd700';
      ctx.beginPath();
      ctx.moveTo(-11, 4);
      ctx.lineTo(11, 4);
      ctx.lineTo(0, 8);
      ctx.closePath();
      ctx.fill();
    }
  }

  // --- MINIMAP RENDER ---
  function renderMinimap() {
    mmCtx.clearRect(0, 0, minimapCanvas.width, minimapCanvas.height);

    const scaleX = minimapCanvas.width / world.width;
    const scaleY = minimapCanvas.height / world.height;

    // Minimap terrain
    mmCtx.fillStyle = '#2e7d32';
    mmCtx.fillRect(0, 0, minimapCanvas.width, minimapCanvas.height);

    // Mission Board (Gold pulse)
    mmCtx.fillStyle = '#ffd54f';
    mmCtx.beginPath();
    mmCtx.arc(world.missionBoard.x * scaleX, world.missionBoard.y * scaleY, 5, 0, Math.PI * 2);
    mmCtx.fill();

    // Boss (Bright Purple)
    if (world.bossMonster.isAlive) {
      mmCtx.fillStyle = '#e040fb';
      mmCtx.beginPath();
      mmCtx.arc(world.bossMonster.x * scaleX, world.bossMonster.y * scaleY, 6, 0, Math.PI * 2);
      mmCtx.fill();
    }

    // Small Mobs (Red)
    mmCtx.fillStyle = '#ff5252';
    for (const mob of world.smallMobs) {
      if (mob.isAlive) {
        mmCtx.beginPath();
        mmCtx.arc(mob.x * scaleX, mob.y * scaleY, 2.5, 0, Math.PI * 2);
        mmCtx.fill();
      }
    }

    // Other Players (Teal)
    mmCtx.fillStyle = '#00e5ff';
    for (const p of otherPlayers.values()) {
      mmCtx.beginPath();
      mmCtx.arc(p.x * scaleX, p.y * scaleY, 3.5, 0, Math.PI * 2);
      mmCtx.fill();
    }

    // Self Player (Gold star)
    if (myId) {
      mmCtx.fillStyle = '#ffeb3b';
      mmCtx.beginPath();
      mmCtx.arc(me.x * scaleX, me.y * scaleY, 5, 0, Math.PI * 2);
      mmCtx.fill();
      mmCtx.strokeStyle = '#ffffff';
      mmCtx.lineWidth = 1.5;
      mmCtx.stroke();
    }
  }

  // Game Loop
  setInterval(update, 1000 / 60);
  requestAnimationFrame(render);

  inputUsername.focus();
})();
