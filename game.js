"use strict";

const CONFIG = Object.freeze({
  boardWidth: 10,
  boardHeight: 20,
  cellSize: 30,
  boardX: 48,
  boardY: 40,
  canvasWidth: 650,
  canvasHeight: 680,
  sidebarX: 390,
  sidebarWidth: 212,
  panelPadding: 18,
  queueSize: 3,
  previewCellSize: 17,
  previewHeight: 82,
  spawnY: -1,
  initialLevel: 1,
  linesPerLevel: 10,
  gravityStartMs: 800,
  gravityMultiplier: 0.84,
  gravityMinimumMs: 90,
  maximumDeltaMs: 100,
  rotationKickOffsets: Object.freeze([0, 1, -1]),
  scoreTable: Object.freeze({ 1: 100, 2: 300, 3: 500, 4: 800 }),
  blockInset: 2,
  blockRadius: 5,
  gridLineWidth: 1,
  borderWidth: 2,
  overlayAlpha: 0.86,
  ghostAlpha: 0.52,
  titleY: 210,
  lineHeight: 25,
  colors: Object.freeze({
    background: "#090b16", board: "#0d1020", grid: "#191d30", border: "#393050",
    fixed: "#615a79", fixedEdge: "#8e85aa", active: "#b675ff", activeEdge: "#e7c9ff",
    ghost: "#9d78ca", text: "#f7f5ff", muted: "#918ba8", accent: "#a875ff",
    panel: "#101322", overlay: "#080a13"
  })
});

const PIECE_DEFINITIONS = Object.freeze([
  { id: "O", cells: [[1, 1], [1, 1]] },
  { id: "L", cells: [[1, 0, 0], [1, 1, 1]] },
  { id: "J", cells: [[0, 0, 1], [1, 1, 1]] },
  { id: "T", cells: [[0, 1, 0], [1, 1, 1]] },
  { id: "S", cells: [[0, 1, 1], [1, 1, 0]] },
  { id: "Z", cells: [[1, 1, 0], [0, 1, 1]] },
  { id: "P", cells: [[1, 1, 0], [0, 1, 1]] },
  { id: "C", cells: [[1, 0], [1, 0], [1, 1]] },
  { id: "V", cells: [[1, 1], [0, 1], [0, 1]] },
  { id: "U", cells: [[1, 1, 1], [0, 1, 0]] },
  { id: "R", cells: [[0, 1, 0], [1, 1, 0], [0, 1, 0]] },
  { id: "Q", cells: [[1, 1, 0], [0, 1, 0], [0, 1, 0]] }
].map((piece) => Object.freeze({ id: piece.id, cells: Object.freeze(piece.cells.map((row) => Object.freeze(row.slice()))) })));

const canvas = document.getElementById("game");
const context = canvas.getContext("2d");

const gameState = {
  phase: "start",
  paused: false,
  board: [],
  currentPiece: null,
  ghostY: null,
  nextQueue: [],
  bag: [],
  score: 0,
  lines: 0,
  level: CONFIG.initialLevel,
  dropAccumulator: 0,
  lastTimestamp: 0,
  input: { actions: [] }
};

function createBoard() {
  return Array.from({ length: CONFIG.boardHeight }, () => Array(CONFIG.boardWidth).fill(0));
}

function resetGame() {
  gameState.phase = "playing";
  gameState.paused = false;
  gameState.board = createBoard();
  gameState.currentPiece = null;
  gameState.ghostY = null;
  gameState.nextQueue = [];
  gameState.bag = [];
  gameState.score = 0;
  gameState.lines = 0;
  gameState.level = CONFIG.initialLevel;
  gameState.dropAccumulator = 0;
  gameState.lastTimestamp = 0;
  gameState.input.actions.length = 0;
  refillQueue();
  spawnNextPiece();
}

function shuffleBag(ids) {
  const shuffled = ids.slice();
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function refillBag() {
  gameState.bag = shuffleBag(PIECE_DEFINITIONS.map((piece) => piece.id));
}

function drawFromBag() {
  if (gameState.bag.length === 0) refillBag();
  return gameState.bag.pop();
}

function refillQueue() {
  while (gameState.nextQueue.length < CONFIG.queueSize + 1) gameState.nextQueue.push(drawFromBag());
}

function getDefinition(id) {
  return PIECE_DEFINITIONS.find((piece) => piece.id === id) || null;
}

function spawnNextPiece() {
  refillQueue();
  const definition = getDefinition(gameState.nextQueue.shift());
  refillQueue();
  if (!definition) {
    gameState.phase = "gameover";
    gameState.currentPiece = null;
    return false;
  }
  const cells = definition.cells.map((row) => row.slice());
  const x = Math.floor((CONFIG.boardWidth - cells[0].length) / 2);
  const piece = { id: definition.id, cells, x, y: CONFIG.spawnY };
  if (!canPlace(piece, x, piece.y, cells)) {
    gameState.phase = "gameover";
    gameState.currentPiece = null;
    return false;
  }
  gameState.currentPiece = piece;
  gameState.ghostY = getDropY(piece);
  return true;
}

function getOccupiedCells(cells) {
  const occupied = [];
  if (!Array.isArray(cells)) return occupied;
  cells.forEach((row, y) => {
    if (!Array.isArray(row)) return;
    row.forEach((value, x) => { if (value === 1) occupied.push({ x, y }); });
  });
  return occupied;
}

function canPlace(piece, targetX, targetY, cells = piece?.cells) {
  if (!piece || !Array.isArray(cells)) return false;
  return getOccupiedCells(cells).every((cell) => {
    const boardX = targetX + cell.x;
    const boardY = targetY + cell.y;
    if (boardX < 0 || boardX >= CONFIG.boardWidth || boardY >= CONFIG.boardHeight) return false;
    if (boardY < 0) return true;
    const row = gameState.board[boardY];
    return Array.isArray(row) && row[boardX] === 0;
  });
}

function tryMove(dx, dy) {
  const piece = gameState.currentPiece;
  if (!piece || !canPlace(piece, piece.x + dx, piece.y + dy)) return false;
  piece.x += dx;
  piece.y += dy;
  return true;
}

function rotateMatrixClockwise(cells) {
  const height = cells.length;
  const width = cells[0]?.length || 0;
  return Array.from({ length: width }, (_, y) =>
    Array.from({ length: height }, (_, x) => cells[height - 1 - x][y]));
}

function tryRotate() {
  const piece = gameState.currentPiece;
  if (!piece) return false;
  const rotated = rotateMatrixClockwise(piece.cells);
  for (const offset of CONFIG.rotationKickOffsets) {
    if (canPlace(piece, piece.x + offset, piece.y, rotated)) {
      piece.cells = rotated;
      piece.x += offset;
      return true;
    }
  }
  return false;
}

function getDropY(piece = gameState.currentPiece) {
  if (!piece) return null;
  let dropY = piece.y;
  while (canPlace(piece, piece.x, dropY + 1, piece.cells)) dropY += 1;
  return dropY;
}

function hardDrop() {
  const piece = gameState.currentPiece;
  if (!piece) return;
  const dropY = getDropY(piece);
  if (dropY !== null) piece.y = dropY;
  lockCurrentPiece();
}

function clearCompletedLines() {
  const remaining = gameState.board.filter((row) => !row.every((cell) => cell === 1));
  const cleared = CONFIG.boardHeight - remaining.length;
  const emptyRows = Array.from({ length: cleared }, () => Array(CONFIG.boardWidth).fill(0));
  gameState.board = emptyRows.concat(remaining).slice(-CONFIG.boardHeight);
  return cleared;
}

function updateScoreAndLevel(cleared) {
  if (cleared > 0) {
    gameState.score += CONFIG.scoreTable[cleared] || 0;
    gameState.lines += cleared;
    gameState.level = Math.floor(gameState.lines / CONFIG.linesPerLevel) + CONFIG.initialLevel;
  }
}

function lockCurrentPiece() {
  const piece = gameState.currentPiece;
  if (!piece) return;
  const occupied = getOccupiedCells(piece.cells);
  const topOut = occupied.some((cell) => piece.y + cell.y < 0);
  if (topOut) {
    gameState.phase = "gameover";
    gameState.currentPiece = null;
    gameState.ghostY = null;
    return;
  }
  occupied.forEach((cell) => {
    const x = piece.x + cell.x;
    const y = piece.y + cell.y;
    const row = y >= 0 && y < CONFIG.boardHeight ? gameState.board[y] : null;
    if (row && x >= 0 && x < CONFIG.boardWidth) row[x] = 1;
  });
  updateScoreAndLevel(clearCompletedLines());
  gameState.currentPiece = null;
  gameState.ghostY = null;
  gameState.dropAccumulator = 0;
  spawnNextPiece();
}

function getGravityInterval() {
  return Math.max(CONFIG.gravityMinimumMs,
    CONFIG.gravityStartMs * Math.pow(CONFIG.gravityMultiplier, gameState.level - CONFIG.initialLevel));
}

function processAction(action) {
  if (action === "start" && gameState.phase !== "playing") {
    resetGame();
    return;
  }
  if (action === "pause" && gameState.phase === "playing") {
    gameState.paused = !gameState.paused;
    gameState.dropAccumulator = 0;
    return;
  }
  if (gameState.phase !== "playing" || gameState.paused || !gameState.currentPiece) return;
  if (action === "left") tryMove(-1, 0);
  else if (action === "right") tryMove(1, 0);
  else if (action === "down" && !tryMove(0, 1)) lockCurrentPiece();
  else if (action === "rotate") tryRotate();
  else if (action === "drop") hardDrop();
}

function update(deltaTime) {
  const actions = gameState.input.actions.splice(0);
  actions.forEach(processAction);
  if (gameState.phase !== "playing" || gameState.paused || !gameState.currentPiece) return;
  gameState.dropAccumulator += Math.min(deltaTime, CONFIG.maximumDeltaMs);
  const interval = getGravityInterval();
  while (gameState.dropAccumulator >= interval && gameState.currentPiece) {
    gameState.dropAccumulator -= interval;
    if (!tryMove(0, 1)) lockCurrentPiece();
  }
  gameState.ghostY = getDropY(gameState.currentPiece);
}

function roundedRect(x, y, width, height, radius) {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
}

function drawBlock(gridX, gridY, fill, edge, alpha = 1) {
  const x = CONFIG.boardX + gridX * CONFIG.cellSize + CONFIG.blockInset;
  const y = CONFIG.boardY + gridY * CONFIG.cellSize + CONFIG.blockInset;
  const size = CONFIG.cellSize - CONFIG.blockInset * 2;
  context.save();
  context.globalAlpha = alpha;
  roundedRect(x, y, size, size, CONFIG.blockRadius);
  context.fillStyle = fill;
  context.fill();
  context.strokeStyle = edge;
  context.lineWidth = CONFIG.gridLineWidth;
  context.stroke();
  context.restore();
}

function renderBoard() {
  context.fillStyle = CONFIG.colors.board;
  context.fillRect(CONFIG.boardX, CONFIG.boardY, CONFIG.boardWidth * CONFIG.cellSize, CONFIG.boardHeight * CONFIG.cellSize);
  context.strokeStyle = CONFIG.colors.grid;
  context.lineWidth = CONFIG.gridLineWidth;
  for (let x = 0; x <= CONFIG.boardWidth; x += 1) {
    context.beginPath(); context.moveTo(CONFIG.boardX + x * CONFIG.cellSize, CONFIG.boardY);
    context.lineTo(CONFIG.boardX + x * CONFIG.cellSize, CONFIG.boardY + CONFIG.boardHeight * CONFIG.cellSize); context.stroke();
  }
  for (let y = 0; y <= CONFIG.boardHeight; y += 1) {
    context.beginPath(); context.moveTo(CONFIG.boardX, CONFIG.boardY + y * CONFIG.cellSize);
    context.lineTo(CONFIG.boardX + CONFIG.boardWidth * CONFIG.cellSize, CONFIG.boardY + y * CONFIG.cellSize); context.stroke();
  }
  gameState.board.forEach((row, y) => row.forEach((cell, x) => {
    if (cell === 1) drawBlock(x, y, CONFIG.colors.fixed, CONFIG.colors.fixedEdge);
  }));
  context.strokeStyle = CONFIG.colors.border;
  context.lineWidth = CONFIG.borderWidth;
  context.strokeRect(CONFIG.boardX, CONFIG.boardY, CONFIG.boardWidth * CONFIG.cellSize, CONFIG.boardHeight * CONFIG.cellSize);
}

function renderPiece(piece) {
  if (!piece) return;
  getOccupiedCells(piece.cells).forEach((cell) => {
    const y = piece.y + cell.y;
    if (y >= 0) drawBlock(piece.x + cell.x, y, CONFIG.colors.active, CONFIG.colors.activeEdge);
  });
}

function renderGhost(piece) {
  if (!piece) return;
  const dropY = gameState.ghostY;
  if (dropY === null || dropY === piece.y) return;
  getOccupiedCells(piece.cells).forEach((cell) => {
    const y = dropY + cell.y;
    if (y >= 0) drawBlock(piece.x + cell.x, y, CONFIG.colors.board, CONFIG.colors.ghost, CONFIG.ghostAlpha);
  });
}

function drawText(text, x, y, size, color = CONFIG.colors.text, align = "left") {
  context.fillStyle = color;
  context.font = `800 ${size}px Inter, system-ui, sans-serif`;
  context.textAlign = align;
  context.fillText(text, x, y);
}

function renderNextQueue() {
  drawText("NEXT 3", CONFIG.sidebarX + CONFIG.panelPadding, CONFIG.boardY + 25, 13, CONFIG.colors.muted);
  gameState.nextQueue.slice(0, CONFIG.queueSize).forEach((id, index) => {
    const definition = getDefinition(id);
    if (!definition) return;
    const top = CONFIG.boardY + 43 + index * CONFIG.previewHeight;
    const cells = definition.cells;
    const width = (cells[0]?.length || 0) * CONFIG.previewCellSize;
    const startX = CONFIG.sidebarX + (CONFIG.sidebarWidth - width) / 2;
    getOccupiedCells(cells).forEach((cell) => {
      const x = startX + cell.x * CONFIG.previewCellSize;
      const y = top + cell.y * CONFIG.previewCellSize;
      context.fillStyle = CONFIG.colors.active;
      context.fillRect(x + CONFIG.blockInset, y + CONFIG.blockInset,
        CONFIG.previewCellSize - CONFIG.blockInset * 2, CONFIG.previewCellSize - CONFIG.blockInset * 2);
    });
  });
}

function renderHUD() {
  const panelY = CONFIG.boardY + 308;
  context.fillStyle = CONFIG.colors.panel;
  roundedRect(CONFIG.sidebarX, panelY, CONFIG.sidebarWidth, 166, CONFIG.blockRadius * 2);
  context.fill();
  const labelX = CONFIG.sidebarX + CONFIG.panelPadding;
  [["SCORE", gameState.score], ["LINES", gameState.lines], ["LEVEL", gameState.level]].forEach((entry, index) => {
    const y = panelY + 30 + index * 48;
    drawText(entry[0], labelX, y, 11, CONFIG.colors.muted);
    drawText(String(entry[1]).padStart(entry[0] === "SCORE" ? 6 : 2, "0"), CONFIG.sidebarX + CONFIG.sidebarWidth - CONFIG.panelPadding, y + 2, 20, CONFIG.colors.text, "right");
  });
  drawText("MOVE", labelX, panelY + 204, 10, CONFIG.colors.muted);
  drawText("← → / A D", labelX, panelY + 225, 13);
  drawText("ROTATE", labelX, panelY + 254, 10, CONFIG.colors.muted);
  drawText("↑ / W", labelX, panelY + 275, 13);
  drawText("SOFT / HARD DROP", labelX, panelY + 304, 10, CONFIG.colors.muted);
  drawText("↓ / S     SPACE", labelX, panelY + 325, 13);
  drawText("P / ESC  PAUSE", labelX, panelY + 361, 11, CONFIG.colors.accent);
}

function renderOverlay() {
  if (gameState.phase === "playing" && !gameState.paused) return;
  context.save();
  context.globalAlpha = CONFIG.overlayAlpha;
  context.fillStyle = CONFIG.colors.overlay;
  context.fillRect(0, 0, CONFIG.canvasWidth, CONFIG.canvasHeight);
  context.restore();
  const center = CONFIG.canvasWidth / 2;
  if (gameState.phase === "start") {
    drawText("VOID BLOCKS", center, CONFIG.titleY, 46, CONFIG.colors.text, "center");
    drawText("EMPTY SPACE HAS NO COLLISION", center, CONFIG.titleY + 42, 13, CONFIG.colors.accent, "center");
    drawText("Let fixed blocks pass through a piece's voids.", center, CONFIG.titleY + 88, 14, CONFIG.colors.muted, "center");
    drawText("Slot shapes into places that look impossible.", center, CONFIG.titleY + 111, 14, CONFIG.colors.muted, "center");
    drawText("← → MOVE   ·   ↑ ROTATE   ·   ↓ SOFT DROP", center, CONFIG.titleY + 164, 12, CONFIG.colors.text, "center");
    drawText("SPACE HARD DROP   ·   P / ESC PAUSE", center, CONFIG.titleY + 188, 12, CONFIG.colors.text, "center");
    drawText("PRESS ENTER TO START", center, CONFIG.titleY + 250, 17, CONFIG.colors.active, "center");
  } else if (gameState.phase === "gameover") {
    drawText("GAME OVER", center, CONFIG.titleY, 46, CONFIG.colors.active, "center");
    drawText(`FINAL SCORE  ${gameState.score}`, center, CONFIG.titleY + 62, 18, CONFIG.colors.text, "center");
    drawText(`LINES  ${gameState.lines}    LEVEL  ${gameState.level}`, center, CONFIG.titleY + 94, 14, CONFIG.colors.muted, "center");
    drawText("PRESS ENTER TO RESTART", center, CONFIG.titleY + 158, 17, CONFIG.colors.active, "center");
  } else {
    drawText("PAUSED", center, CONFIG.titleY + 80, 46, CONFIG.colors.text, "center");
    drawText("P / ESC TO RESUME", center, CONFIG.titleY + 126, 14, CONFIG.colors.accent, "center");
  }
}

function render() {
  context.clearRect(0, 0, CONFIG.canvasWidth, CONFIG.canvasHeight);
  context.fillStyle = CONFIG.colors.background;
  context.fillRect(0, 0, CONFIG.canvasWidth, CONFIG.canvasHeight);
  renderBoard();
  renderGhost(gameState.currentPiece);
  renderPiece(gameState.currentPiece);
  renderNextQueue();
  renderHUD();
  renderOverlay();
}

function gameLoop(timestamp) {
  const deltaTime = gameState.lastTimestamp === 0 ? 0 : timestamp - gameState.lastTimestamp;
  gameState.lastTimestamp = timestamp;
  update(deltaTime);
  render();
  requestAnimationFrame(gameLoop);
}

const KEY_ACTIONS = Object.freeze({
  ArrowLeft: "left", KeyA: "left", ArrowRight: "right", KeyD: "right",
  ArrowDown: "down", KeyS: "down", ArrowUp: "rotate", KeyW: "rotate",
  Space: "drop", KeyP: "pause", Escape: "pause", Enter: "start"
});

document.addEventListener("keydown", (event) => {
  const action = KEY_ACTIONS[event.code];
  if (!action) return;
  event.preventDefault();
  if (event.repeat && (action === "drop" || action === "rotate" || action === "pause" || action === "start")) return;
  gameState.input.actions.push(action);
});

window.VoidBlocks = Object.freeze({
  CONFIG, PIECE_DEFINITIONS, gameState, createBoard, resetGame, canPlace, getOccupiedCells,
  rotateMatrixClockwise, tryRotate, getDropY, clearCompletedLines, updateScoreAndLevel,
  lockCurrentPiece, getGravityInterval, update, render
});

gameState.board = createBoard();
canvas.width = CONFIG.canvasWidth;
canvas.height = CONFIG.canvasHeight;
requestAnimationFrame(gameLoop);
