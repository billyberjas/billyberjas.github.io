// Woodoku Clone - core logic
// Plain JavaScript implementation: 9x9 board, selectable pieces, placement, clearing, scoring, game over.

(() => {
  const SIZE = 9;

  const TOUCH_POINT_OFFSET_Y = 50; // px: vertical offset applied during touch drag for visibility

  function getPieceUnit() {
    try {
      if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) return 28;
    } catch (_) {}
    return 20;
  }

  function haptic(kind) {
    try {
      if (!('vibrate' in navigator)) return;
      switch (kind) {
        case 'start': navigator.vibrate(8); break;
        case 'success': navigator.vibrate([12, 40, 12]); break;
        case 'error': navigator.vibrate([20, 30, 20]); break;
        case 'select': navigator.vibrate(6); break;
      }
    } catch (_) {}
  }

  const boardEl = document.getElementById('board');
  const trayEl = document.getElementById('tray');
  const scoreEl = document.getElementById('score');
  const resetBtn = document.getElementById('resetBtn');
  const statusEl = document.getElementById('status');

  let board = createEmptyBoard();
  let tray = [];
  let selectedPieceId = null;
  let score = 0;
  let gameOver = false;
  let hoverCells = [];
  let squareHintCells = [];
  let ghostEl = null; // overlay that shows a semi-transparent piece under the cursor
  let squareOverlayEl = null; // overlay above ghost to show 3x3 clear hints
  let pointerGhostEl = null; // floating ghost near finger for touch
  // Pointer-based drag state for mobile/touch
  let pointerDragging = false;
  let pointerDragPieceId = null;
  let pointerHoverR = null;
  let pointerHoverC = null;

  // Shapes are arrays of [r, c] with origin at (0,0)
  const SHAPES = [
    // Singles and lines
    [[0,0]],
    [[0,0],[0,1]],
    [[0,0],[1,0]],
    [[0,0],[0,1],[0,2]],
    [[0,0],[1,0],[2,0]],
    [[0,0],[0,1],[0,2],[0,3]],
    [[0,0],[1,0],[2,0],[3,0]],
    [[0,0],[0,1],[0,2],[0,3],[0,4]],
    [[0,0],[1,0],[2,0],[3,0],[4,0]],

    // Squares
    [[0,0],[0,1],[1,0],[1,1]],
    [[0,0],[0,1],[0,2],[1,0],[1,1],[1,2],[2,0],[2,1],[2,2]], // 3x3

    // L shapes (4 blocks)
    [[0,0],[1,0],[2,0],[2,1]],
    [[0,1],[1,1],[2,1],[2,0]],
    [[0,0],[0,1],[1,0],[2,0]],
    [[0,0],[0,1],[1,1],[2,1]],

    // T shapes
    [[0,0],[0,1],[0,2],[1,1]],
    [[0,1],[1,0],[1,1],[2,1]],

    // Z/S small
    [[0,0],[0,1],[1,1],[1,2]],
    [[0,1],[0,2],[1,0],[1,1]],
  ];

  function createEmptyBoard() {
    return Array.from({ length: SIZE }, () => Array(SIZE).fill(0));
  }

  function renderBoard() {
    boardEl.innerHTML = '';
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const cell = document.createElement('div');
        cell.className = 'cell' + (board[r][c] ? ' filled' : '');
        cell.dataset.row = String(r);
        cell.dataset.col = String(c);
        cell.role = 'gridcell';
        cell.setAttribute('draggable', 'false');
        boardEl.appendChild(cell);
      }
    }
  }

  function updateBoardDOM() {
    const cells = boardEl.children;
    let i = 0;
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const el = cells[i++];
        if (!el) continue;
        if (board[r][c]) el.classList.add('filled');
        else el.classList.remove('filled');
      }
    }
  }

  function clearHover() {
    for (const el of hoverCells) {
      el.classList.remove('hover-valid');
      el.classList.remove('hover-invalid');
    }
    hoverCells = [];
    for (const el of squareHintCells) {
      el.classList.remove('square-hint');
    }
    squareHintCells = [];
    clearSquareOverlay();
  }

  function ensureGhostEl() {
    if (ghostEl && ghostEl.parentElement) return ghostEl;
    ghostEl = document.createElement('div');
    ghostEl.className = 'ghost-piece';
    ghostEl.style.pointerEvents = 'none';
    ghostEl.style.position = 'absolute';
    ghostEl.style.top = '0px';
    ghostEl.style.left = '0px';
    ghostEl.style.width = '100%';
    ghostEl.style.height = '100%';
    boardEl.appendChild(ghostEl);
    return ghostEl;
  }

  function ensureSquareOverlayEl() {
    if (squareOverlayEl && squareOverlayEl.parentElement) return squareOverlayEl;
    squareOverlayEl = document.createElement('div');
    squareOverlayEl.className = 'square-hint-overlay';
    squareOverlayEl.style.pointerEvents = 'none';
    squareOverlayEl.style.position = 'absolute';
    squareOverlayEl.style.top = '0px';
    squareOverlayEl.style.left = '0px';
    squareOverlayEl.style.width = '100%';
    squareOverlayEl.style.height = '100%';
    boardEl.appendChild(squareOverlayEl);
    return squareOverlayEl;
  }

  function hideGhost() {
    if (ghostEl) ghostEl.innerHTML = '';
  }

  function clearSquareOverlay() {
    if (squareOverlayEl) squareOverlayEl.innerHTML = '';
  }

  function ensurePointerGhostEl() {
    if (pointerGhostEl && pointerGhostEl.parentElement) return pointerGhostEl;
    pointerGhostEl = document.createElement('div');
    pointerGhostEl.className = 'pointer-ghost';
    pointerGhostEl.style.position = 'fixed';
    pointerGhostEl.style.pointerEvents = 'none';
    pointerGhostEl.style.top = '0px';
    pointerGhostEl.style.left = '0px';
    document.body.appendChild(pointerGhostEl);
    return pointerGhostEl;
  }
  function hidePointerGhost() {
    if (pointerGhostEl) pointerGhostEl.innerHTML = '';
  }
  function renderPointerGhostAtCell(shape, baseR, baseC) {
    const el = ensurePointerGhostEl();
    el.innerHTML = '';
    // Base cell rect drives exact sizing to match board
    const baseIdx = baseR * SIZE + baseC;
    const baseCell = boardEl.children[baseIdx];
    if (!(baseCell instanceof HTMLElement)) return;
    const cellRect = baseCell.getBoundingClientRect();
    const boardRect = boardEl.getBoundingClientRect();
    const { rows, cols } = getPieceBounds(shape);
    const unitW = cellRect.width;
    const unitH = cellRect.height;
    el.style.width = (cols * unitW) + 'px';
    el.style.height = (rows * unitH) + 'px';
    // Align top-left of ghost with the top-left of the base cell (hit-testing already uses the offset)
    el.style.left = (cellRect.left) + 'px';
    el.style.top = (cellRect.top) + 'px';
    el.style.display = 'grid';
    el.style.gridTemplateColumns = `repeat(${cols}, ${unitW}px)`;
    el.style.gridTemplateRows = `repeat(${rows}, ${unitH}px)`;
    for (let rr = 0; rr < rows; rr++) {
      for (let cc = 0; cc < cols; cc++) {
        const has = shape.some(([r,c]) => r === rr && c === cc);
        const d = document.createElement('div');
        d.className = 'pghost-block';
        d.style.width = unitW + 'px';
        d.style.height = unitH + 'px';
        if (!has) d.style.visibility = 'hidden';
        el.appendChild(d);
      }
    }
  }

  function renderGhost(shape, baseR, baseC) {
    const container = ensureGhostEl();
    container.innerHTML = '';
    const boardRect = boardEl.getBoundingClientRect();
    for (const [dr, dc] of shape) {
      const r = baseR + dr;
      const c = baseC + dc;
      if (r < 0 || r >= SIZE || c < 0 || c >= SIZE) continue; // don't render out of bounds
      const idx = r * SIZE + c;
      const cell = boardEl.children[idx];
      if (!(cell instanceof HTMLElement)) continue;
      const rect = cell.getBoundingClientRect();
      const block = document.createElement('div');
      block.className = 'ghost-block';
      block.style.position = 'absolute';
      block.style.left = (rect.left - boardRect.left) + 'px';
      block.style.top = (rect.top - boardRect.top) + 'px';
      block.style.width = rect.width + 'px';
      block.style.height = rect.height + 'px';
      container.appendChild(block);
    }
  }

  function highlightPlacement(shape, baseR, baseC) {
    clearHover();
    let valid = true;
    const candidates = [];
    for (const [dr, dc] of shape) {
      const r = baseR + dr;
      const c = baseC + dc;
      if (r < 0 || r >= SIZE || c < 0 || c >= SIZE) {
        valid = false;
        continue; // out-of-bounds cells are not highlightable
      }
      if (board[r][c] !== 0) valid = false;
      candidates.push(r * SIZE + c);
    }
    for (const idx of candidates) {
      const el = boardEl.children[idx];
      if (!(el instanceof HTMLElement)) continue;
      el.classList.add(valid ? 'hover-valid' : 'hover-invalid');
      hoverCells.push(el);
    }

    // If the placement is valid, highlight any 3x3 squares that would be cleared by this placement
    if (valid) {
      const absShape = new Set();
      for (const [dr, dc] of shape) {
        absShape.add(`${baseR + dr},${baseC + dc}`);
      }
      const overlay = ensureSquareOverlayEl();
      overlay.innerHTML = '';
      const boardRect = boardEl.getBoundingClientRect();
      let hintedCount = 0;
      for (let br = 0; br < SIZE; br += 3) {
        for (let bc = 0; bc < SIZE; bc += 3) {
          let full = true;
          for (let r = br; r < br + 3; r++) {
            for (let c = bc; c < bc + 3; c++) {
              if (board[r][c] !== 1 && !absShape.has(`${r},${c}`)) { full = false; break; }
            }
            if (!full) break;
          }
          if (full) {
            hintedCount++;
            for (let r = br; r < br + 3; r++) {
              for (let c = bc; c < bc + 3; c++) {
                const idx = r * SIZE + c;
                const cell = boardEl.children[idx];
                if (!(cell instanceof HTMLElement)) continue;
                const rect = cell.getBoundingClientRect();
                const block = document.createElement('div');
                block.className = 'square-hint-block';
                block.style.position = 'absolute';
                block.style.left = (rect.left - boardRect.left) + 'px';
                block.style.top = (rect.top - boardRect.top) + 'px';
                block.style.width = rect.width + 'px';
                block.style.height = rect.height + 'px';
                overlay.appendChild(block);
              }
            }
          }
        }
      }

      // Row clear hints
      for (let r = 0; r < SIZE; r++) {
        let full = true;
        for (let c = 0; c < SIZE; c++) {
          if (board[r][c] !== 1 && !absShape.has(`${r},${c}`)) { full = false; break; }
        }
        if (full) {
          for (let c = 0; c < SIZE; c++) {
            const idx = r * SIZE + c;
            const cell = boardEl.children[idx];
            if (!(cell instanceof HTMLElement)) continue;
            const rect = cell.getBoundingClientRect();
            const block = document.createElement('div');
            block.className = 'line-hint-block';
            block.style.position = 'absolute';
            block.style.left = (rect.left - boardRect.left) + 'px';
            block.style.top = (rect.top - boardRect.top) + 'px';
            block.style.width = rect.width + 'px';
            block.style.height = rect.height + 'px';
            overlay.appendChild(block);
          }
        }
      }

      // Column clear hints
      for (let c = 0; c < SIZE; c++) {
        let full = true;
        for (let r = 0; r < SIZE; r++) {
          if (board[r][c] !== 1 && !absShape.has(`${r},${c}`)) { full = false; break; }
        }
        if (full) {
          for (let r = 0; r < SIZE; r++) {
            const idx = r * SIZE + c;
            const cell = boardEl.children[idx];
            if (!(cell instanceof HTMLElement)) continue;
            const rect = cell.getBoundingClientRect();
            const block = document.createElement('div');
            block.className = 'line-hint-block';
            block.style.position = 'absolute';
            block.style.left = (rect.left - boardRect.left) + 'px';
            block.style.top = (rect.top - boardRect.top) + 'px';
            block.style.width = rect.width + 'px';
            block.style.height = rect.height + 'px';
            overlay.appendChild(block);
          }
        }
      }
    }

    return valid;
  }

  function randomInt(n) { return Math.floor(Math.random() * n); }

  let pieceIdCounter = 1;
  function makePiece(shape) {
    return { id: 'p' + (pieceIdCounter++), shape };
  }

  function generateTray() {
    tray = [makePiece(SHAPES[randomInt(SHAPES.length)]), makePiece(SHAPES[randomInt(SHAPES.length)]), makePiece(SHAPES[randomInt(SHAPES.length)])];
    selectedPieceId = null;
    renderTray();
  }

  function getPieceBounds(shape) {
    let maxR = 0, maxC = 0;
    for (const [r,c] of shape) { if (r > maxR) maxR = r; if (c > maxC) maxC = c; }
    return { rows: maxR + 1, cols: maxC + 1 };
  }

  function renderTray() {
    trayEl.innerHTML = '';
    for (const piece of tray) {
      const { rows, cols } = getPieceBounds(piece.shape);
      const el = document.createElement('div');
      el.className = 'piece' + (selectedPieceId === piece.id ? ' selected' : '');
      const unit = getPieceUnit();
      el.style.gridTemplateColumns = `repeat(${cols}, ${unit}px)`;
      el.style.gridTemplateRows = `repeat(${rows}, ${unit}px)`;
      el.dataset.pieceId = piece.id;
      el.setAttribute('draggable', 'true');

      function handleDragStart(ev) {
        if (gameOver) { ev.preventDefault(); return; }
        const dt = ev.dataTransfer;
        if (dt) {
          dt.setData('text/plain', piece.id);
          dt.effectAllowed = 'move';
          // Create a custom drag image to show the piece under the cursor
          try {
            const dragImg = document.createElement('div');
            dragImg.style.position = 'absolute';
            dragImg.style.top = '-1000px';
            dragImg.style.left = '-1000px';
            const { rows, cols } = getPieceBounds(piece.shape);
            const unit = getPieceUnit();
            dragImg.style.display = 'grid';
            dragImg.style.gridTemplateColumns = `repeat(${cols}, ${unit}px)`;
            dragImg.style.gridTemplateRows = `repeat(${rows}, ${unit}px)`;
            for (let rr = 0; rr < rows; rr++) {
              for (let cc = 0; cc < cols; cc++) {
                const has = piece.shape.some(([r,c]) => r === rr && c === cc);
                const d = document.createElement('div');
                d.style.width = unit + 'px';
                d.style.height = unit + 'px';
                if (has) {
                  d.style.background = 'linear-gradient(180deg, #d4a373, #b07f59)';
                  d.style.borderRadius = '3px';
                  d.style.boxShadow = 'inset 0 0 0 1px #7a4f2b';
                  d.style.opacity = '0.6';
                }
                dragImg.appendChild(d);
              }
            }
            document.body.appendChild(dragImg);
            // Offset to roughly center on pointer
            dt.setDragImage(dragImg, 10, 10);
            // Cleanup after a tick
            setTimeout(() => dragImg.remove(), 0);
          } catch {}
        }
        selectedPieceId = piece.id;
        hideGhost();
        const container = ev.target instanceof HTMLElement ? ev.target.closest('.piece') : null;
        if (container) container.classList.add('dragging');
        setStatus('Drag over a board cell and release to place.');
        haptic('start');
      }

      function handleDragEnd(ev) {
        const container = ev.target instanceof HTMLElement ? ev.target.closest('.piece') : null;
        if (container) container.classList.remove('dragging');
        selectedPieceId = null;
        clearHover();
      }

      el.addEventListener('dragstart', handleDragStart);
      el.addEventListener('dragend', handleDragEnd);
      el.addEventListener('click', () => {
        if (gameOver) return;
        selectedPieceId = selectedPieceId === piece.id ? null : piece.id;
        renderTray();
        setStatus(selectedPieceId ? 'Selected a piece. Click a board cell to place.' : 'Piece deselected.');
      });
      // Pointer-based drag (mobile/touch)
      el.addEventListener('pointerdown', (ev) => {
        if (gameOver) return;
        if (ev.pointerType === 'mouse') return; // keep native DnD for mouse
        startPointerDrag(piece.id, ev);
      });

      // Build mini grid
      const grid = Array.from({ length: rows }, () => Array(cols).fill(0));
      for (const [r,c] of piece.shape) grid[r][c] = 1;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (grid[r][c]) {
            const cell = document.createElement('div');
            cell.className = 'p-cell';
            cell.style.width = '100%';
            cell.style.height = '100%';
            cell.setAttribute('draggable', 'true');
            cell.dataset.pieceId = piece.id;
            cell.addEventListener('dragstart', handleDragStart);
            cell.addEventListener('dragend', handleDragEnd);
            // Pointer-based drag (mobile/touch)
            cell.addEventListener('pointerdown', (ev) => {
              if (gameOver) return;
              if (ev.pointerType === 'mouse') return;
              startPointerDrag(piece.id, ev);
            });
            el.appendChild(cell);
          } else {
            const spacer = document.createElement('div');
            spacer.style.width = '100%';
            spacer.style.height = '100%';
            // Allow easier grabbing by making spacer draggable too
            spacer.setAttribute('draggable', 'true');
            spacer.dataset.pieceId = piece.id;
            spacer.addEventListener('dragstart', handleDragStart);
            spacer.addEventListener('dragend', handleDragEnd);
            // Pointer-based drag (mobile/touch)
            spacer.addEventListener('pointerdown', (ev) => {
              if (gameOver) return;
              if (ev.pointerType === 'mouse') return;
              startPointerDrag(piece.id, ev);
            });
            el.appendChild(spacer);
          }
        }
      }

      trayEl.appendChild(el);
    }
  }

  function canPlace(shape, baseR, baseC) {
    for (const [dr, dc] of shape) {
      const r = baseR + dr;
      const c = baseC + dc;
      if (r < 0 || r >= SIZE || c < 0 || c >= SIZE) return false;
      if (board[r][c] !== 0) return false;
    }
    return true;
  }

  function placeShape(shape, baseR, baseC) {
    for (const [dr, dc] of shape) {
      const r = baseR + dr;
      const c = baseC + dc;
      board[r][c] = 1;
    }
  }

  function clearFulls() {
    const fullRows = [];
    const fullCols = [];
    const fullSquares = [];

    // Rows
    for (let r = 0; r < SIZE; r++) {
      if (board[r].every(v => v === 1)) fullRows.push(r);
    }
    // Cols
    for (let c = 0; c < SIZE; c++) {
      let full = true;
      for (let r = 0; r < SIZE; r++) { if (board[r][c] !== 1) { full = false; break; } }
      if (full) fullCols.push(c);
    }
    // 3x3 blocks
    for (let br = 0; br < SIZE; br += 3) {
      for (let bc = 0; bc < SIZE; bc += 3) {
        let full = true;
        for (let r = br; r < br + 3; r++) {
          for (let c = bc; c < bc + 3; c++) {
            if (board[r][c] !== 1) { full = false; break; }
          }
          if (!full) break;
        }
        if (full) fullSquares.push([br, bc]);
      }
    }

    // Clear them
    for (const r of fullRows) board[r] = Array(SIZE).fill(0);
    for (const c of fullCols) for (let r = 0; r < SIZE; r++) board[r][c] = 0;
    for (const [br, bc] of fullSquares) {
      for (let r = br; r < br + 3; r++) {
        for (let c = bc; c < bc + 3; c++) {
          board[r][c] = 0;
        }
      }
    }

    const clearedUnits = fullRows.length + fullCols.length + fullSquares.length;
    return clearedUnits;
  }

  function anyPlacementPossible() {
    for (const piece of tray) {
      for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
          if (canPlace(piece.shape, r, c)) return true;
        }
      }
    }
    return false;
  }

  function setStatus(msg) {
    statusEl.textContent = msg || '';
  }

  function onBoardClick(e) {
    if (gameOver) return;
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;
    if (!target.classList.contains('cell')) return;

    if (!selectedPieceId) {
      setStatus('Select a piece first.');
      return;
    }

    const r = Number(target.dataset.row);
    const c = Number(target.dataset.col);
    const pieceIndex = tray.findIndex(p => p.id === selectedPieceId);
    if (pieceIndex === -1) return;
    const piece = tray[pieceIndex];

    if (!canPlace(piece.shape, r, c)) {
      setStatus('Invalid placement. Try another cell.');
      haptic('error');
      return;
    }

    // Place and score
    placeShape(piece.shape, r, c);
    const placedCells = piece.shape.length;
    tray.splice(pieceIndex, 1);
    selectedPieceId = null;

    let gained = placedCells; // base points per block
    const clearedUnits = clearFulls();
    if (clearedUnits > 0) {
      gained += 10 * clearedUnits; // bonus per line/square cleared
    }
    score += gained;
    scoreEl.textContent = String(score);

    updateBoardDOM();
    renderTray();

    if (tray.length === 0) {
      generateTray();
    }

    if (!anyPlacementPossible()) {
      gameOver = true;
      setStatus('Game Over! No valid moves remain.');
    } else {
      setStatus('Placed!');
      haptic('success');
    }
  }

  function onBoardDragOver(e) {
    if (gameOver) return;
    e.preventDefault(); // Always allow drop over the board to avoid blocked cursor
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;

    // Determine the hovered cell robustly
    let cellEl = target.classList.contains('cell') ? target : null;
    if (!cellEl && typeof document !== 'undefined' && e.clientX != null && e.clientY != null) {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      cellEl = el instanceof HTMLElement ? el.closest('.cell') : null;
    }
    if (!cellEl) { clearHover(); hideGhost(); return; }

    const pieceId = selectedPieceId; // use state from dragstart (some browsers block getData during dragover)
    if (!pieceId) { clearHover(); hideGhost(); return; }
    const piece = tray.find(p => p.id === pieceId);
    if (!piece) { clearHover(); hideGhost(); return; }

    const r = Number(cellEl.dataset.row);
    const c = Number(cellEl.dataset.col);

    renderGhost(piece.shape, r, c);
    const ok = highlightPlacement(piece.shape, r, c);
    if (e.dataTransfer) e.dataTransfer.dropEffect = ok ? 'move' : 'none';
  }

  function onBoardDrop(e) {
    e.preventDefault();
    if (gameOver) return;
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;

    // Determine drop cell
    const cellEl = target.classList.contains('cell') ? target : (target.closest ? target.closest('.cell') : null);
    if (!cellEl) { clearHover(); hideGhost(); return; }

    const pieceId = selectedPieceId || (e.dataTransfer ? e.dataTransfer.getData('text/plain') : '');
    if (!pieceId) { setStatus('No piece to drop.'); clearHover(); hideGhost(); return; }

    const r = Number(cellEl.dataset.row);
    const c = Number(cellEl.dataset.col);
    const pieceIndex = tray.findIndex(p => p.id === pieceId);
    if (pieceIndex === -1) { setStatus('That piece is not available.'); clearHover(); hideGhost(); return; }
    const piece = tray[pieceIndex];

    if (!canPlace(piece.shape, r, c)) {
      setStatus('Invalid placement. Try another cell.');
      haptic('error');
      clearHover();
      return;
    }

    // Place and score
    placeShape(piece.shape, r, c);
    const placedCells = piece.shape.length;
    tray.splice(pieceIndex, 1);
    selectedPieceId = null;

    let gained = placedCells; // base points per block
    const clearedUnits = clearFulls();
    if (clearedUnits > 0) {
      gained += 10 * clearedUnits; // bonus per line/square cleared
    }
    score += gained;
    scoreEl.textContent = String(score);

    updateBoardDOM();
    renderTray();
    clearHover();
    hideGhost();

    if (tray.length === 0) {
      generateTray();
    }

    if (!anyPlacementPossible()) {
      gameOver = true;
      setStatus('Game Over! No valid moves remain.');
    } else {
      setStatus('Placed!');
      haptic('success');
    }
  }

  function onBoardClick(e) {
    if (gameOver) return;
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;
    if (!target.classList.contains('cell')) return;

    if (!selectedPieceId) {
      setStatus('Select a piece first.');
      return;
    }

    const r = Number(target.dataset.row);
    const c = Number(target.dataset.col);
    const pieceIndex = tray.findIndex(p => p.id === selectedPieceId);
    if (pieceIndex === -1) return;
    const piece = tray[pieceIndex];

    if (!canPlace(piece.shape, r, c)) {
      setStatus('Invalid placement. Try another cell.');
      return;
    }

    // Place and score
    placeShape(piece.shape, r, c);
    const placedCells = piece.shape.length;
    tray.splice(pieceIndex, 1);
    selectedPieceId = null;

    let gained = placedCells; // base points per block
    const clearedUnits = clearFulls();
    if (clearedUnits > 0) {
      gained += 10 * clearedUnits; // bonus per line/square cleared
    }
    score += gained;
    scoreEl.textContent = String(score);

    updateBoardDOM();
    renderTray();
    clearHover();
    hideGhost();

    if (tray.length === 0) {
      generateTray();
    }

    if (!anyPlacementPossible()) {
      gameOver = true;
      setStatus('Game Over! No valid moves remain.');
    } else {
      setStatus('Placed!');
    }
  }

  function resetGame() {
    board = createEmptyBoard();
    score = 0;
    scoreEl.textContent = '0';
    gameOver = false;
    selectedPieceId = null;
    renderBoard();
    generateTray();
    setStatus('New game started.');
  }

  // Pointer-based drag helpers (mobile/touch)
  function getCellAtPoint(clientX, clientY, offsetY = 0) {
    const el = document.elementFromPoint(clientX, clientY - offsetY);
    if (!(el instanceof HTMLElement)) return null;
    const cellEl = el.closest('.cell');
    if (!cellEl) return null;
    const r = Number(cellEl.getAttribute('data-row'));
    const c = Number(cellEl.getAttribute('data-col'));
    if (Number.isNaN(r) || Number.isNaN(c)) return null;
    return { cellEl, r, c };
  }

  function startPointerDrag(pieceId, ev) {
    ev.preventDefault();
    pointerDragging = true;
    pointerDragPieceId = pieceId;
    selectedPieceId = pieceId;
    pointerHoverR = null;
    pointerHoverC = null;
    setStatus('Drag over a board cell and release to place.');
    haptic('start');
    // First preview will appear on pointermove when we know the hovered cell
  }

  function onPointerMove(ev) {
    if (!pointerDragging) return;
    const piece = tray.find(p => p.id === pointerDragPieceId);
    if (!piece) return;
    if (ev.clientX == null || ev.clientY == null) return;
    const hit = getCellAtPoint(ev.clientX, ev.clientY, TOUCH_POINT_OFFSET_Y);
    if (!hit) { hideGhost(); clearHover(); return; }
    pointerHoverR = hit.r;
    pointerHoverC = hit.c;
    renderGhost(piece.shape, hit.r, hit.c);
    highlightPlacement(piece.shape, hit.r, hit.c);
    renderPointerGhostAtCell(piece.shape, hit.r, hit.c);
  }

  function onPointerUp(ev) {
    if (!pointerDragging) return;
    const pieceIndex = tray.findIndex(p => p.id === pointerDragPieceId);
    if (pieceIndex !== -1 && pointerHoverR != null && pointerHoverC != null) {
      const piece = tray[pieceIndex];
      if (canPlace(piece.shape, pointerHoverR, pointerHoverC)) {
        placeShape(piece.shape, pointerHoverR, pointerHoverC);
        const placedCells = piece.shape.length;
        tray.splice(pieceIndex, 1);
        selectedPieceId = null;
        let gained = placedCells;
        const clearedUnits = clearFulls();
        if (clearedUnits > 0) gained += 10 * clearedUnits;
        score += gained;
        scoreEl.textContent = String(score);
        updateBoardDOM();
        renderTray();
        setStatus('Placed!');
        if (tray.length === 0) generateTray();
        if (!anyPlacementPossible()) { gameOver = true; setStatus('Game Over! No valid moves remain.'); }
      } else {
        setStatus('Invalid placement. Try another cell.');
        haptic('error');
      }
    }
    // Cleanup
    pointerDragging = false;
    pointerDragPieceId = null;
    pointerHoverR = pointerHoverC = null;
    hideGhost();
    hidePointerGhost();
    clearHover();
  }

  // Event bindings
  function onBoardMouseMove(e) {
    if (gameOver) { hideGhost(); clearHover(); return; }
    const pieceId = selectedPieceId;
    if (!pieceId) { hideGhost(); clearHover(); return; }
    const piece = tray.find(p => p.id === pieceId);
    if (!piece) { hideGhost(); clearHover(); return; }
    const target = e.target;
    if (!(target instanceof HTMLElement)) { hideGhost(); clearHover(); return; }
    let cellEl = target.classList.contains('cell') ? target : (target.closest ? target.closest('.cell') : null);
    if (!cellEl && typeof document !== 'undefined' && e.clientX != null && e.clientY != null) {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      cellEl = el instanceof HTMLElement ? el.closest('.cell') : null;
    }
    if (!cellEl) { hideGhost(); clearHover(); return; }
    const r = Number(cellEl.dataset.row);
    const c = Number(cellEl.dataset.col);
    renderGhost(piece.shape, r, c);
    highlightPlacement(piece.shape, r, c);
  }

  boardEl.addEventListener('dragenter', (e) => { e.preventDefault(); });
  boardEl.addEventListener('dragover', onBoardDragOver);
  boardEl.addEventListener('drop', onBoardDrop);
  boardEl.addEventListener('click', onBoardClick);
  boardEl.addEventListener('mousemove', onBoardMouseMove);
  // Global pointer listeners for mobile/touch dragging
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  boardEl.addEventListener('mouseleave', () => { hideGhost(); clearHover(); });
  boardEl.addEventListener('dragleave', (e) => {
    // When leaving the board entirely, clear highlights.
    const related = e.relatedTarget;
    if (!(related instanceof Node) || !boardEl.contains(related)) {
      clearHover();
      hideGhost();
    }
  });
  resetBtn.addEventListener('click', resetGame);

  // Responsive fit: adjust cell size so layout fits within viewport without page scroll
  function fitToViewport() {
    const layoutEl = document.querySelector('.layout');
    const topbarEl = document.querySelector('.topbar');
    const footerEl = document.querySelector('.footer');
    if (!layoutEl || !topbarEl) return;
    const cs = getComputedStyle(layoutEl);
    const layoutPad = parseInt(cs.paddingTop || '16') + parseInt(cs.paddingBottom || '16');
    const gap = 2; // .board gap
    const pad = 16; // layout side padding approximation used in width calc
    const boardPad = 16; // .board padding 8*2
    // Start from width-constrained cell size
    const maxCellByW = Math.floor((window.innerWidth - pad - pad - boardPad - (SIZE - 1) * gap) / SIZE);
    let cell = Math.min(Math.max(maxCellByW, 18), 42);
    for (let i = 0; i < 20; i++) {
      document.documentElement.style.setProperty('--cell-size', cell + 'px');
      // Force reflow to get updated heights
      const topH = topbarEl.offsetHeight;
      const footH = footerEl ? footerEl.offsetHeight : 0;
      const totalH = topH + layoutEl.scrollHeight + footH;
      if (totalH <= window.innerHeight) break;
      cell -= 1;
      if (cell < 18) break;
    }
  }

  window.addEventListener('resize', fitToViewport);

  // Initial render
  renderBoard();
  generateTray();
  fitToViewport();
  setStatus('Drag a piece onto a board cell, or click a piece then move over a cell to preview and click to place.');
})();
