window.RyanBeachdayGames = (function () {
  var initialized = false;
  var screenVisible = false;
  var activeGame = null;
  var fsDb = null;
  var getOrCreateAuthorFn = null;

  var PLAYER_NAME_STORAGE_KEY = 'ryanbeachdayPlayerName';

  function loadStoredPlayerName() {
    try { return localStorage.getItem(PLAYER_NAME_STORAGE_KEY) || ''; } catch (e) { return ''; }
  }

  function saveStoredPlayerName(name) {
    try { localStorage.setItem(PLAYER_NAME_STORAGE_KEY, name); } catch (e) {}
  }

  function slugifyPlayerName(name) {
    var slug = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
    return slug || 'anon';
  }

  // Reuses the message board's author/avatar lookup so a player's profile
  // icon stays the same whether they're posting or playing a mini game.
  function resolveAuthor(displayName) {
    if (!getOrCreateAuthorFn) return Promise.resolve({ displayName: displayName, avatarUrl: '' });
    return getOrCreateAuthorFn(displayName).catch(function (err) {
      console.error('author lookup failed:', err);
      return { displayName: displayName, avatarUrl: '' };
    });
  }

  function recordWin(collectionName, name, avatarUrl) {
    if (!fsDb || !name) return;
    fsDb.collection(collectionName).doc(slugifyPlayerName(name)).set({
      displayName: name,
      avatarUrl: avatarUrl || '',
      wins: firebase.firestore.FieldValue.increment(1),
      updatedAt: Date.now()
    }, { merge: true }).catch(function (err) {
      console.error('leaderboard win write failed (' + collectionName + '):', err);
    });
  }

  // Unlike recordWin, this adds a new entry per game played rather than
  // updating one doc per player — so the same player can hold multiple
  // spots on the score leaderboard.
  function recordScore(collectionName, name, avatarUrl, score) {
    if (!fsDb || !name) return;
    fsDb.collection(collectionName).add({
      displayName: name,
      avatarUrl: avatarUrl || '',
      score: score,
      createdAt: Date.now()
    }).catch(function (err) {
      console.error('leaderboard score write failed (' + collectionName + '):', err);
    });
  }

  /**
   * Gates a game panel behind a display-name prompt, reusing the panel's
   * game-overlay element as the prompt's home. Games that also show a
   * game-over message in that same overlay pass it as `otherBlockEl` so
   * showGate() can swap it out for the name prompt.
   */
  function createNameGate(opts) {
    var name = null;
    var avatarUrl = '';

    function showGate() {
      opts.inputEl.value = name || loadStoredPlayerName();
      opts.gateEl.hidden = false;
      if (opts.otherBlockEl) opts.otherBlockEl.hidden = true;
      opts.overlayEl.classList.add('show');
      opts.inputEl.focus();
    }

    function commit() {
      if (opts.startBtn.disabled) return;
      var typed = opts.inputEl.value.trim().slice(0, 24);
      if (!typed) { opts.inputEl.focus(); return; }
      opts.startBtn.disabled = true;
      opts.startBtn.textContent = 'Starting…';
      resolveAuthor(typed).then(function (author) {
        name = author.displayName || typed;
        avatarUrl = author.avatarUrl || '';
        saveStoredPlayerName(name);
        opts.playerNameEl.textContent = name;
        opts.overlayEl.classList.remove('show');
        opts.startBtn.disabled = false;
        opts.startBtn.textContent = 'Start Game';
        opts.onStart(name);
      });
    }

    opts.startBtn.addEventListener('click', commit);
    opts.inputEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); commit(); }
    });
    opts.changeBtn.addEventListener('click', function () {
      opts.onChange();
      name = null;
      avatarUrl = '';
      opts.playerNameEl.textContent = '—';
      showGate();
    });

    return {
      showGate: showGate,
      getName: function () { return name; },
      getAvatarUrl: function () { return avatarUrl; }
    };
  }

  /* ================= MINESWEEPER ================= */

  var Minesweeper = (function () {
    var SIZE = 9;
    var MINES = 10;

    var gridEl, counterEl, timerEl, faceEl, resetBtn, flagModeBtn, nameGate;
    var cells = [];
    var minesPlaced, gameOver, flagMode, flagCount, revealedCount, seconds, timerHandle;

    function neighbors(idx) {
      var x = idx % SIZE, y = Math.floor(idx / SIZE);
      var out = [];
      for (var dy = -1; dy <= 1; dy++) {
        for (var dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          var nx = x + dx, ny = y + dy;
          if (nx >= 0 && nx < SIZE && ny >= 0 && ny < SIZE) out.push(ny * SIZE + nx);
        }
      }
      return out;
    }

    function buildGrid() {
      gridEl.innerHTML = '';
      gridEl.style.gridTemplateColumns = 'repeat(' + SIZE + ', 26px)';
      cells = [];
      for (var i = 0; i < SIZE * SIZE; i++) {
        var el = document.createElement('div');
        el.className = 'mine-cell';
        el.setAttribute('data-index', i);
        gridEl.appendChild(el);
        cells.push({ el: el, mine: false, count: 0, revealed: false, flagged: false });
      }
    }

    function placeMines(safeIdx) {
      var safeZone = [safeIdx].concat(neighbors(safeIdx));
      var candidates = [];
      for (var i = 0; i < cells.length; i++) {
        if (safeZone.indexOf(i) === -1) candidates.push(i);
      }
      for (var m = 0; m < MINES && candidates.length > 0; m++) {
        var pick = Math.floor(Math.random() * candidates.length);
        cells[candidates[pick]].mine = true;
        candidates.splice(pick, 1);
      }
      for (var j = 0; j < cells.length; j++) {
        if (cells[j].mine) continue;
        var cnt = 0;
        neighbors(j).forEach(function (n) { if (cells[n].mine) cnt++; });
        cells[j].count = cnt;
      }
    }

    function renderCell(i) {
      var c = cells[i];
      var el = c.el;
      el.className = 'mine-cell' + (c.revealed ? ' revealed' : '') + (c.flagged ? ' flagged' : '') + (c.revealed && c.mine ? ' mine' : '');
      if (c.revealed && c.mine) {
        el.textContent = '\u{1F4A3}';
        el.removeAttribute('data-count');
      } else if (c.revealed && c.count > 0) {
        el.textContent = c.count;
        el.setAttribute('data-count', c.count);
      } else if (c.revealed) {
        el.textContent = '';
        el.removeAttribute('data-count');
      } else if (c.flagged) {
        el.textContent = '\u{1F6A9}';
        el.removeAttribute('data-count');
      } else {
        el.textContent = '';
        el.removeAttribute('data-count');
      }
    }

    function updateCounter() {
      counterEl.textContent = MINES - flagCount;
    }

    function startTimer() {
      stopTimer();
      timerHandle = setInterval(function () {
        seconds = Math.min(999, seconds + 1);
        timerEl.textContent = seconds;
      }, 1000);
    }

    function stopTimer() {
      if (timerHandle) { clearInterval(timerHandle); timerHandle = null; }
    }

    function floodReveal(start) {
      var stack = [start];
      while (stack.length) {
        var idx = stack.pop();
        var c = cells[idx];
        if (c.revealed || c.flagged) continue;
        c.revealed = true;
        revealedCount++;
        renderCell(idx);
        if (c.count === 0 && !c.mine) {
          neighbors(idx).forEach(function (n) {
            if (!cells[n].revealed && !cells[n].flagged) stack.push(n);
          });
        }
      }
    }

    function checkWin() {
      if (revealedCount === SIZE * SIZE - MINES) {
        gameOver = true;
        stopTimer();
        faceEl.textContent = '\u{1F60E}';
        cells.forEach(function (c, i) {
          if (c.mine && !c.flagged) { c.flagged = true; flagCount++; renderCell(i); }
        });
        updateCounter();
        recordWin('leaderboardMinesweeper', nameGate.getName(), nameGate.getAvatarUrl());
      }
    }

    function loseGame(lostIdx) {
      gameOver = true;
      stopTimer();
      faceEl.textContent = '\u{1F480}';
      cells.forEach(function (c, i) {
        if (c.mine) { c.revealed = true; renderCell(i); }
      });
      cells[lostIdx].el.classList.add('exploded');
    }

    function reveal(idx) {
      if (gameOver) return;
      var c = cells[idx];
      if (c.revealed || c.flagged) return;

      if (!minesPlaced) {
        placeMines(idx);
        minesPlaced = true;
        seconds = 0;
        timerEl.textContent = '0';
        startTimer();
      }

      if (c.mine) {
        c.revealed = true;
        renderCell(idx);
        loseGame(idx);
        return;
      }

      floodReveal(idx);
      checkWin();
    }

    function toggleFlag(idx) {
      if (gameOver) return;
      var c = cells[idx];
      if (c.revealed) return;
      c.flagged = !c.flagged;
      flagCount += c.flagged ? 1 : -1;
      renderCell(idx);
      updateCounter();
    }

    function resetGame() {
      stopTimer();
      minesPlaced = false;
      gameOver = false;
      flagCount = 0;
      revealedCount = 0;
      seconds = 0;
      faceEl.textContent = '\u{1F642}';
      timerEl.textContent = '0';
      buildGrid();
      updateCounter();

      gridEl.addEventListener('click', onGridClick);
      gridEl.addEventListener('contextmenu', onGridContextMenu);
    }

    function guardedReset() {
      if (!nameGate.getName()) { nameGate.showGate(); return; }
      resetGame();
    }

    function onGridClick(e) {
      if (!nameGate.getName()) return;
      var target = e.target.closest ? e.target.closest('.mine-cell') : null;
      if (!target) return;
      var idx = +target.getAttribute('data-index');
      if (flagMode) toggleFlag(idx);
      else reveal(idx);
    }

    function onGridContextMenu(e) {
      e.preventDefault();
      if (!nameGate.getName()) return;
      var target = e.target.closest ? e.target.closest('.mine-cell') : null;
      if (!target) return;
      toggleFlag(+target.getAttribute('data-index'));
    }

    function init() {
      gridEl = document.getElementById('mineGrid');
      counterEl = document.getElementById('mineCounter');
      timerEl = document.getElementById('mineTimer');
      faceEl = document.getElementById('mineFace');
      resetBtn = document.getElementById('mineResetBtn');
      flagModeBtn = document.getElementById('mineFlagModeBtn');
      flagMode = false;

      nameGate = createNameGate({
        overlayEl: document.getElementById('mineOverlay'),
        gateEl: document.getElementById('mineNameGate'),
        otherBlockEl: null,
        inputEl: document.getElementById('mineNameInput'),
        startBtn: document.getElementById('mineNameStartBtn'),
        playerNameEl: document.getElementById('minePlayerName'),
        changeBtn: document.getElementById('mineChangePlayerBtn'),
        onStart: function () {},
        onChange: function () { resetGame(); }
      });

      resetBtn.addEventListener('click', guardedReset);
      flagModeBtn.addEventListener('click', function () {
        flagMode = !flagMode;
        flagModeBtn.textContent = '\u{1F6A9} Flag Mode: ' + (flagMode ? 'On' : 'Off');
      });

      resetGame();
      nameGate.showGate();
    }

    function start() {
      if (minesPlaced && !gameOver) startTimer();
    }

    function stop() {
      stopTimer();
    }

    return { init: init, start: start, stop: stop };
  })();

  /* ================= SNAKE ================= */

  var Snake = (function () {
    var GRID = 20;
    var CELL = 16;
    var START_TICK = 130;
    var MIN_TICK = 70;

    var canvas, ctx, scoreEl, bestEl, resetBtn, overlayEl, overlayTextEl, overlayBtn, gameOverBlockEl, nameGate;
    var snake, dir, nextDir, apple, score, best, gameOver, tickHandle, listening, tickMs;

    function loadBest() {
      try {
        return parseInt(localStorage.getItem('ryanbeachdaySnakeBest'), 10) || 0;
      } catch (e) { return 0; }
    }

    function saveBest(val) {
      try { localStorage.setItem('ryanbeachdaySnakeBest', String(val)); } catch (e) {}
    }

    function occupied(x, y, list) {
      for (var i = 0; i < list.length; i++) {
        if (list[i].x === x && list[i].y === y) return true;
      }
      return false;
    }

    function spawnApple() {
      var x, y;
      do {
        x = Math.floor(Math.random() * GRID);
        y = Math.floor(Math.random() * GRID);
      } while (occupied(x, y, snake));
      apple = { x: x, y: y };
    }

    function setDirection(dx, dy) {
      if (gameOver) return;
      if (dx === -dir.x && dy === -dir.y) return;
      nextDir = { x: dx, y: dy };
    }

    function draw() {
      ctx.fillStyle = '#001a00';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.fillStyle = '#ff4444';
      ctx.fillRect(apple.x * CELL + 1, apple.y * CELL + 1, CELL - 2, CELL - 2);

      for (var i = 0; i < snake.length; i++) {
        ctx.fillStyle = i === 0 ? '#7CFC00' : '#33cc33';
        ctx.fillRect(snake[i].x * CELL + 1, snake[i].y * CELL + 1, CELL - 2, CELL - 2);
      }
    }

    function updateScoreUI() {
      scoreEl.textContent = score;
      bestEl.textContent = best;
    }

    function showOverlay(text) {
      overlayTextEl.textContent = text;
      gameOverBlockEl.hidden = false;
      document.getElementById('snakeNameGate').hidden = true;
      overlayEl.classList.add('show');
    }

    function hideOverlay() {
      overlayEl.classList.remove('show');
    }

    function endGame() {
      gameOver = true;
      if (tickHandle) { clearTimeout(tickHandle); tickHandle = null; }
      if (score > best) { best = score; saveBest(best); }
      updateScoreUI();
      recordScore('leaderboardSnake', nameGate.getName(), nameGate.getAvatarUrl(), score);
      showOverlay('Game Over — Score: ' + score);
    }

    function tick() {
      dir = nextDir;
      var head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };

      if (head.x < 0 || head.x >= GRID || head.y < 0 || head.y >= GRID) {
        endGame();
        return;
      }

      var grows = head.x === apple.x && head.y === apple.y;
      var bodyToCheck = grows ? snake : snake.slice(0, snake.length - 1);
      if (occupied(head.x, head.y, bodyToCheck)) {
        endGame();
        return;
      }

      snake.unshift(head);
      if (grows) {
        score++;
        updateScoreUI();
        tickMs = Math.max(MIN_TICK, START_TICK - Math.floor(score / 5) * 6);
        spawnApple();
      } else {
        snake.pop();
      }

      draw();
      scheduleTick();
    }

    function scheduleTick() {
      if (gameOver) return;
      tickHandle = setTimeout(tick, tickMs);
    }

    function resetState() {
      if (tickHandle) { clearTimeout(tickHandle); tickHandle = null; }
      snake = [{ x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }];
      dir = { x: 1, y: 0 };
      nextDir = dir;
      score = 0;
      tickMs = START_TICK;
      gameOver = false;
      hideOverlay();
      spawnApple();
      updateScoreUI();
      draw();
    }

    function resetGame() {
      resetState();
      scheduleTick();
    }

    function guardedReset() {
      if (!nameGate.getName()) { nameGate.showGate(); return; }
      resetGame();
    }

    function onKeyDown(e) {
      var map = {
        ArrowUp: [0, -1], w: [0, -1], W: [0, -1],
        ArrowDown: [0, 1], s: [0, 1], S: [0, 1],
        ArrowLeft: [-1, 0], a: [-1, 0], A: [-1, 0],
        ArrowRight: [1, 0], d: [1, 0], D: [1, 0]
      };
      var move = map[e.key];
      if (!move) return;
      if (e.key.indexOf('Arrow') === 0) e.preventDefault();
      setDirection(move[0], move[1]);
    }

    function init() {
      canvas = document.getElementById('snakeCanvas');
      ctx = canvas.getContext('2d');
      scoreEl = document.getElementById('snakeScore');
      bestEl = document.getElementById('snakeBest');
      resetBtn = document.getElementById('snakeResetBtn');
      overlayEl = document.getElementById('snakeOverlay');
      overlayTextEl = document.getElementById('snakeOverlayText');
      overlayBtn = document.getElementById('snakeOverlayBtn');
      gameOverBlockEl = document.getElementById('snakeGameOverBlock');
      best = loadBest();
      listening = false;

      nameGate = createNameGate({
        overlayEl: overlayEl,
        gateEl: document.getElementById('snakeNameGate'),
        otherBlockEl: gameOverBlockEl,
        inputEl: document.getElementById('snakeNameInput'),
        startBtn: document.getElementById('snakeNameStartBtn'),
        playerNameEl: document.getElementById('snakePlayerName'),
        changeBtn: document.getElementById('snakeChangePlayerBtn'),
        onStart: function () { scheduleTick(); },
        onChange: function () { resetState(); }
      });

      resetBtn.addEventListener('click', guardedReset);
      overlayBtn.addEventListener('click', guardedReset);

      document.querySelectorAll('.dpad-btn').forEach(function (btn) {
        var dirs = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
        btn.addEventListener('click', function () {
          var d = dirs[btn.getAttribute('data-dir')];
          setDirection(d[0], d[1]);
        });
      });

      resetState();
      nameGate.showGate();
    }

    function start() {
      if (!listening) {
        window.addEventListener('keydown', onKeyDown);
        listening = true;
      }
      if (!nameGate.getName()) { nameGate.showGate(); return; }
      if (!gameOver && !tickHandle) scheduleTick();
    }

    function stop() {
      if (listening) {
        window.removeEventListener('keydown', onKeyDown);
        listening = false;
      }
      if (tickHandle) { clearTimeout(tickHandle); tickHandle = null; }
    }

    return { init: init, start: start, stop: stop };
  })();

  /* ================= PONG ================= */

  var Pong = (function () {
    var W = 400, H = 260;
    var PADDLE_W = 8, PADDLE_H = 50;
    var BALL_SIZE = 8;
    var PLAYER_X = 14;
    var BOT_X = W - 14 - PADDLE_W;
    var WIN_SCORE = 7;
    var PLAYER_KEY_SPEED = 4.5;
    var BOT_SPEED = 3.1;
    var BASE_BALL_SPEED = 3.2;
    var MAX_BALL_SPEED = 7;

    var canvas, ctx, scorePlayerEl, scoreBotEl, resetBtn, overlayEl, overlayTextEl, overlayBtn, gameOverBlockEl, nameGate;
    var playerY, botY, ball, playerScore, botScore, gameOver, running, rafHandle, keys, listening, botTargetY;

    function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

    function resetBall(towardPlayer) {
      ball = {
        x: W / 2 - BALL_SIZE / 2,
        y: H / 2 - BALL_SIZE / 2,
        speed: BASE_BALL_SPEED
      };
      var angle = (Math.random() * 0.5 - 0.25) * Math.PI;
      var dirX = towardPlayer ? -1 : 1;
      ball.vx = Math.cos(angle) * ball.speed * dirX;
      ball.vy = Math.sin(angle) * ball.speed;
    }

    function resetGame() {
      playerY = H / 2 - PADDLE_H / 2;
      botY = H / 2 - PADDLE_H / 2;
      playerScore = 0;
      botScore = 0;
      gameOver = false;
      botTargetY = botY;
      resetBall(Math.random() < 0.5);
      updateScoreUI();
      hideOverlay();
      draw();
    }

    function guardedReset() {
      if (!nameGate.getName()) { nameGate.showGate(); return; }
      resetGame();
    }

    function updateScoreUI() {
      scorePlayerEl.textContent = playerScore;
      scoreBotEl.textContent = botScore;
    }

    function showOverlay(text) {
      overlayTextEl.textContent = text;
      gameOverBlockEl.hidden = false;
      document.getElementById('pongNameGate').hidden = true;
      overlayEl.classList.add('show');
    }

    function hideOverlay() {
      overlayEl.classList.remove('show');
    }

    function checkWin() {
      if (playerScore >= WIN_SCORE) {
        gameOver = true;
        recordWin('leaderboardPong', nameGate.getName(), nameGate.getAvatarUrl());
        showOverlay('You Win! \u{1F3C6}');
      } else if (botScore >= WIN_SCORE) {
        gameOver = true;
        showOverlay('Bot Wins! \u{1F916}');
      }
    }

    function update() {
      if (!nameGate.getName()) return;

      if (keys.up) playerY -= PLAYER_KEY_SPEED;
      if (keys.down) playerY += PLAYER_KEY_SPEED;
      playerY = clamp(playerY, 0, H - PADDLE_H);

      if (ball.vx > 0 && Math.random() < 0.06) {
        botTargetY = ball.y + BALL_SIZE / 2 - PADDLE_H / 2 + (Math.random() * 20 - 10);
      } else if (ball.vx < 0) {
        botTargetY = H / 2 - PADDLE_H / 2;
      }
      if (botY < botTargetY) botY = Math.min(botY + BOT_SPEED, botTargetY);
      else if (botY > botTargetY) botY = Math.max(botY - BOT_SPEED, botTargetY);
      botY = clamp(botY, 0, H - PADDLE_H);

      ball.x += ball.vx;
      ball.y += ball.vy;

      if (ball.y <= 0) { ball.y = 0; ball.vy = -ball.vy; }
      if (ball.y + BALL_SIZE >= H) { ball.y = H - BALL_SIZE; ball.vy = -ball.vy; }

      if (ball.vx < 0 && ball.x <= PLAYER_X + PADDLE_W && ball.x >= PLAYER_X &&
          ball.y + BALL_SIZE >= playerY && ball.y <= playerY + PADDLE_H) {
        ball.x = PLAYER_X + PADDLE_W;
        var offsetP = (ball.y + BALL_SIZE / 2 - (playerY + PADDLE_H / 2)) / (PADDLE_H / 2);
        ball.speed = Math.min(MAX_BALL_SPEED, ball.speed + 0.3);
        ball.vx = Math.cos(offsetP * 0.4) * ball.speed;
        ball.vy = offsetP * ball.speed;
      }

      if (ball.vx > 0 && ball.x + BALL_SIZE >= BOT_X && ball.x <= BOT_X + PADDLE_W &&
          ball.y + BALL_SIZE >= botY && ball.y <= botY + PADDLE_H) {
        ball.x = BOT_X - BALL_SIZE;
        var offsetB = (ball.y + BALL_SIZE / 2 - (botY + PADDLE_H / 2)) / (PADDLE_H / 2);
        ball.speed = Math.min(MAX_BALL_SPEED, ball.speed + 0.3);
        ball.vx = -Math.cos(offsetB * 0.4) * ball.speed;
        ball.vy = offsetB * ball.speed;
      }

      if (ball.x < -BALL_SIZE) {
        botScore++;
        updateScoreUI();
        checkWin();
        if (!gameOver) resetBall(true);
      } else if (ball.x > W) {
        playerScore++;
        updateScoreUI();
        checkWin();
        if (!gameOver) resetBall(false);
      }
    }

    function draw() {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);

      ctx.strokeStyle = '#444';
      ctx.setLineDash([6, 8]);
      ctx.beginPath();
      ctx.moveTo(W / 2, 0);
      ctx.lineTo(W / 2, H);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = '#fff';
      ctx.fillRect(PLAYER_X, playerY, PADDLE_W, PADDLE_H);
      ctx.fillRect(BOT_X, botY, PADDLE_W, PADDLE_H);
      ctx.fillRect(ball.x, ball.y, BALL_SIZE, BALL_SIZE);
    }

    function loop() {
      if (!running) return;
      if (!gameOver) update();
      draw();
      rafHandle = requestAnimationFrame(loop);
    }

    function pointerYToPaddle(clientY) {
      var rect = canvas.getBoundingClientRect();
      var relY = (clientY - rect.top) * (H / rect.height);
      playerY = clamp(relY - PADDLE_H / 2, 0, H - PADDLE_H);
    }

    function onPointerMove(e) {
      if (e.buttons === undefined || e.buttons > 0 || e.pointerType !== 'mouse') {
        pointerYToPaddle(e.clientY);
      }
    }

    function onKeyDown(e) {
      if (e.key === 'ArrowUp') { keys.up = true; e.preventDefault(); }
      if (e.key === 'ArrowDown') { keys.down = true; e.preventDefault(); }
    }

    function onKeyUp(e) {
      if (e.key === 'ArrowUp') keys.up = false;
      if (e.key === 'ArrowDown') keys.down = false;
    }

    function init() {
      canvas = document.getElementById('pongCanvas');
      ctx = canvas.getContext('2d');
      scorePlayerEl = document.getElementById('pongScorePlayer');
      scoreBotEl = document.getElementById('pongScoreBot');
      resetBtn = document.getElementById('pongResetBtn');
      overlayEl = document.getElementById('pongOverlay');
      overlayTextEl = document.getElementById('pongOverlayText');
      overlayBtn = document.getElementById('pongOverlayBtn');
      gameOverBlockEl = document.getElementById('pongGameOverBlock');
      keys = { up: false, down: false };
      running = false;
      listening = false;

      nameGate = createNameGate({
        overlayEl: overlayEl,
        gateEl: document.getElementById('pongNameGate'),
        otherBlockEl: gameOverBlockEl,
        inputEl: document.getElementById('pongNameInput'),
        startBtn: document.getElementById('pongNameStartBtn'),
        playerNameEl: document.getElementById('pongPlayerName'),
        changeBtn: document.getElementById('pongChangePlayerBtn'),
        onStart: function () {},
        onChange: function () { resetGame(); }
      });

      resetBtn.addEventListener('click', guardedReset);
      overlayBtn.addEventListener('click', guardedReset);
      canvas.addEventListener('pointermove', onPointerMove);
      canvas.addEventListener('pointerdown', function (e) { pointerYToPaddle(e.clientY); });

      resetGame();
      nameGate.showGate();
    }

    function start() {
      if (!listening) {
        window.addEventListener('keydown', onKeyDown);
        window.addEventListener('keyup', onKeyUp);
        listening = true;
      }
      if (!running) {
        running = true;
        rafHandle = requestAnimationFrame(loop);
      }
      if (!nameGate.getName()) nameGate.showGate();
    }

    function stop() {
      running = false;
      if (rafHandle) { cancelAnimationFrame(rafHandle); rafHandle = null; }
      if (listening) {
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('keyup', onKeyUp);
        listening = false;
      }
      keys.up = false;
      keys.down = false;
    }

    return { init: init, start: start, stop: stop };
  })();

  /* ================= LEADERBOARD ================= */

  var Leaderboard = (function () {
    var TOP_N = 5;

    // Minesweeper/Pong rank by total wins (one doc per player, so a player
    // holds at most one spot). Snake ranks by individual game scores (one
    // doc per game played), so the same player can hold multiple spots.
    var CONFIGS = [
      { key: 'minesweeper', collection: 'leaderboardMinesweeper', field: 'wins', label: 'wins' },
      { key: 'snake', collection: 'leaderboardSnake', field: 'score', label: 'pts' },
      { key: 'pong', collection: 'leaderboardPong', field: 'wins', label: 'wins' }
    ];
    var listEls = {};
    var unsubscribers = {};

    function escapeHtml(str) {
      var div = document.createElement('div');
      div.textContent = str == null ? '' : str;
      return div.innerHTML;
    }

    function renderList(el, docs, field, label) {
      if (!docs.length) {
        el.innerHTML = '<li class="leaderboard-empty">No scores yet — be the first!</li>';
        return;
      }
      el.innerHTML = docs.map(function (d) {
        var avatar = d.avatarUrl
          ? '<img class="leaderboard-avatar" src="' + escapeHtml(d.avatarUrl) + '" alt="">'
          : '<span class="leaderboard-avatar"></span>';
        return '<li>' + avatar +
          '<span class="leaderboard-name">' + escapeHtml(d.displayName) + '</span>' +
          '<span class="leaderboard-value">' + d[field] + ' ' + label + '</span></li>';
      }).join('');
    }

    function init() {
      listEls.minesweeper = document.getElementById('lbMinesweeperList');
      listEls.snake = document.getElementById('lbSnakeList');
      listEls.pong = document.getElementById('lbPongList');
    }

    function start() {
      CONFIGS.forEach(function (cfg) {
        if (unsubscribers[cfg.key]) return;
        if (!fsDb) {
          listEls[cfg.key].innerHTML = '<li class="leaderboard-empty">Leaderboard unavailable right now.</li>';
          return;
        }
        unsubscribers[cfg.key] = fsDb.collection(cfg.collection)
          .orderBy(cfg.field, 'desc')
          .limit(TOP_N)
          .onSnapshot(function (snap) {
            renderList(listEls[cfg.key], snap.docs.map(function (d) { return d.data(); }), cfg.field, cfg.label);
          }, function (err) {
            console.error('leaderboard listen failed (' + cfg.collection + '):', err);
            listEls[cfg.key].innerHTML = '<li class="leaderboard-empty">Couldn\'t load leaderboard.</li>';
          });
      });
    }

    function stop() {
      Object.keys(unsubscribers).forEach(function (key) {
        unsubscribers[key]();
        delete unsubscribers[key];
      });
    }

    return { init: init, start: start, stop: stop };
  })();

  /* ================= SWITCHBOARD ================= */

  var games = { minesweeper: Minesweeper, snake: Snake, pong: Pong, leaderboard: Leaderboard };

  function showGame(name) {
    if (activeGame === name) return;
    if (activeGame) games[activeGame].stop();
    activeGame = name;

    document.querySelectorAll('.game-pick-btn').forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-game') === name);
    });
    document.querySelectorAll('.game-panel').forEach(function (panel) {
      panel.classList.toggle('active', panel.getAttribute('data-game-panel') === name);
    });

    if (screenVisible) games[name].start();
  }

  function onEnter() {
    screenVisible = true;
    if (activeGame) games[activeGame].start();
  }

  function onLeave() {
    screenVisible = false;
    if (activeGame) games[activeGame].stop();
  }

  function init(db, getAuthorFn) {
    if (initialized) return;
    initialized = true;
    fsDb = db || null;
    getOrCreateAuthorFn = getAuthorFn || null;

    Minesweeper.init();
    Snake.init();
    Pong.init();
    Leaderboard.init();

    document.querySelectorAll('.game-pick-btn').forEach(function (btn) {
      btn.addEventListener('click', function () { showGame(btn.getAttribute('data-game')); });
    });

    showGame('minesweeper');
  }

  return { init: init, onEnter: onEnter, onLeave: onLeave };
})();
