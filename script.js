
import * as THREE from
"https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";

// =====================================
// GAME SETTINGS
// =====================================

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111b2a);
scene.fog = new THREE.Fog(0x111b2a, 5, 23);

const camera = new THREE.PerspectiveCamera(
  75, window.innerWidth / window.innerHeight, 0.1, 100
);

const renderer = new THREE.WebGLRenderer({
  antialias: true
});

renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById("game").prepend(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xbad8ff, 0x293044, 2));

const light = new THREE.DirectionalLight(0xffffff, 1.5);
light.position.set(5, 10, 5);
light.castShadow = true;
scene.add(light);

const clock = new THREE.Clock();
const raycaster = new THREE.Raycaster();

const TILE = 3;
const WALL_HEIGHT = 3.5;
const PLAYER_RADIUS = 0.35;

let level = 1;
let health = 100;
let ammo = 35;
let reserve = Infinity;
let enemies = [];
let walls = [];
let decorations = [];
let keyObject = null;
let exitObject = null;

let gameStarted = false;
let gameEnded = false;
let hasKey = false;
let reloading = false;
let dashing = false;
let dashCooldown = 0;

let yaw = 0;
let pitch = 0;

const player = {
  x: 0,
  z: 0,
  speed: 4.5
};

camera.position.set(0, 1.65, 0);

// =====================================
// MAZE GENERATION
// =====================================

const SIZE = 15;

let maze = [];

function createMaze() {
  maze = Array.from(
    { length: SIZE },
    () => Array(SIZE).fill(0)
  );

  // Outer walls
  for (let i = 0; i < SIZE; i++) {
    maze[0][i] = 1;
    maze[SIZE - 1][i] = 1;
    maze[i][0] = 1;
    maze[i][SIZE - 1] = 1;
  }

  // Maze obstacles
  const density = 0.13 + level * 0.035;

  for (let z = 2; z < SIZE - 2; z++) {
    for (let x = 2; x < SIZE - 2; x++) {
      if (Math.random() < density) {
        maze[z][x] = 1;
      }
    }
  }

  // Keep a clear route through the centre
  for (let x = 1; x < SIZE - 1; x++) {
    maze[1][x] = 0;
    maze[SIZE - 2][x] = 0;
  }

  for (let z = 1; z < SIZE - 1; z++) {
    maze[z][1] = 0;
    maze[z][SIZE - 2] = 0;
  }

  // Clear starting and destination areas
  for (let z = 1; z <= 3; z++) {
    for (let x = 1; x <= 3; x++) maze[z][x] = 0;
  }

  for (let z = SIZE - 4; z < SIZE - 1; z++) {
    for (let x = SIZE - 4; x < SIZE - 1; x++) {
      maze[z][x] = 0;
    }
  }

  // Clear connecting paths
  for (let x = 1; x < SIZE - 1; x++) {
    maze[SIZE - 2][x] = 0;
  }

  for (let z = 1; z < SIZE - 1; z++) {
    maze[z][SIZE - 2] = 0;
  }
}

function worldX(x) {
  return (x - (SIZE - 1) / 2) * TILE;
}

function worldZ(z) {
  return (z - (SIZE - 1) / 2) * TILE;
}

function gridAt(x, z) {
  const gx = Math.round(x / TILE + (SIZE - 1) / 2);
  const gz = Math.round(z / TILE + (SIZE - 1) / 2);

  if (gx < 0 || gz < 0 || gx >= SIZE || gz >= SIZE) {
    return 1;
  }

  return maze[gz][gx];
}

// =====================================
// WORLD BUILDING
// =====================================

function clearWorld() {
  for (const object of walls) scene.remove(object);
  for (const object of decorations) scene.remove(object);
  for (const enemy of enemies) scene.remove(enemy.group);

  if (keyObject) scene.remove(keyObject);
  if (exitObject) scene.remove(exitObject);

  walls = [];
  decorations = [];
  enemies = [];
  keyObject = null;
  exitObject = null;
}

function addWall(x, z) {
  const geometry = new THREE.BoxGeometry(
    TILE, WALL_HEIGHT, TILE
  );

  const material = new THREE.MeshStandardMaterial({
    color: level % 2 ? 0x34445b : 0x45404e,
    roughness: 0.8
  });

  const wall = new THREE.Mesh(geometry, material);

  wall.position.set(x, WALL_HEIGHT / 2, z);
  wall.castShadow = true;
  wall.receiveShadow = true;

  scene.add(wall);
  walls.push(wall);
}

function buildWorld() {
  clearWorld();
  createMaze();

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(SIZE * TILE, SIZE * TILE),
    new THREE.MeshStandardMaterial({
      color: 0x252d3b,
      roughness: 0.95
    })
  );

  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0;
  floor.receiveShadow = true;
  scene.add(floor);
  decorations.push(floor);

  for (let z = 0; z < SIZE; z++) {
    for (let x = 0; x < SIZE; x++) {
      if (maze[z][x] === 1) {
        addWall(worldX(x), worldZ(z));
      }
    }
  }

  // Decorative ceiling lights
  for (let z = 2; z < SIZE - 2; z += 4) {
    for (let x = 2; x < SIZE - 2; x += 4) {
      if (!maze[z][x]) {
        const lamp = new THREE.PointLight(0x64aaff, 1.2, 8);
        lamp.position.set(worldX(x), 2.8, worldZ(z));
        scene.add(lamp);
        decorations.push(lamp);
      }
    }
  }

  player.x = worldX(1);
  player.z = worldZ(1);

  yaw = 0;
  pitch = 0;

  camera.position.set(player.x, 1.65, player.z);

  createKey();
  createExit();
  createEnemies();
}

// =====================================
// KEY AND EXIT
// =====================================

function createKey() {
  const geometry = new THREE.TorusGeometry(0.35, 0.09, 10, 24);

  keyObject = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      color: 0xffd700,
      emissive: 0x997000,
      emissiveIntensity: 1
    })
  );

  keyObject.position.set(
    worldX(SIZE - 2), 1.2, worldZ(1)
  );

  scene.add(keyObject);
}

function createExit() {
  const group = new THREE.Group();

  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(1.5, 2.7, 0.3),
    new THREE.MeshStandardMaterial({
      color: 0x1677db,
      emissive: 0x064a9e
    })
  );

  group.add(frame);

  const glow = new THREE.Mesh(
    new THREE.BoxGeometry(1.1, 2.3, 0.35),
    new THREE.MeshBasicMaterial({
      color: 0x27c9ff,
      transparent: true,
      opacity: 0.55
    })
  );

  group.add(glow);
  group.position.set(worldX(SIZE - 2), 1.35, worldZ(SIZE - 2));

  scene.add(group);
  exitObject = group;
}

// =====================================
// ENEMIES
// =====================================

function createEnemies() {
  const count = level + 1;

  for (let i = 0; i < count; i++) {
    let x, z;
    let attempts = 0;

    do {
      const gx = 3 + Math.floor(Math.random() * 9);
      const gz = 3 + Math.floor(Math.random() * 9);

      x = worldX(gx);
      z = worldZ(gz);
      attempts++;
    } while (
      (gridAt(x, z) === 1 ||
       Math.hypot(x - player.x, z - player.z) < 5) &&
      attempts < 100
    );

    if (attempts >= 100) continue;

    const group = new THREE.Group();

    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.9, 1.1, 0.9),
      new THREE.MeshStandardMaterial({
        color: 0x9a3de0,
        emissive: 0x431080
      })
    );

    body.position.y = 0.65;
    body.castShadow = true;
    group.add(body);

    const eye = new THREE.Mesh(
      new THREE.SphereGeometry(0.15, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0xff5050 })
    );

    eye.position.set(0, 0.85, -0.47);
    group.add(eye);

    group.position.set(x, 0, z);
    scene.add(group);

    enemies.push({
      group,
      hp: 2 + level,
      speed: 0.7 + level * 0.13,
      active: true,
      attackTimer: 0
    });
  }
}

// =====================================
// PLAYER MOVEMENT
// =====================================

let moveX = 0;
let moveY = 0;
let joystickActive = false;

function canMove(x, z) {
  const r = PLAYER_RADIUS;

  return (
    gridAt(x + r, z) === 0 &&
    gridAt(x - r, z) === 0 &&
    gridAt(x, z + r) === 0 &&
    gridAt(x, z - r) === 0
  );
}

function movePlayer(delta) {
  if (!gameStarted || gameEnded) return;

  const forward = new THREE.Vector3(
    -Math.sin(yaw), 0, -Math.cos(yaw)
  );

  const right = new THREE.Vector3(
    Math.cos(yaw), 0, -Math.sin(yaw)
  );

  const direction = new THREE.Vector3();

  direction.addScaledVector(forward, -moveY);
  direction.addScaledVector(right, moveX);

  if (direction.length() > 1) direction.normalize();

  const speed = dashing ? 11 : player.speed;

  const dx = direction.x * speed * delta;
  const dz = direction.z * speed * delta;

  if (canMove(player.x + dx, player.z)) {
    player.x += dx;
  }

  if (canMove(player.x, player.z + dz)) {
    player.z += dz;
  }

  camera.position.set(player.x, 1.65, player.z);

  camera.rotation.order = "YXZ";
  camera.rotation.y = yaw;
  camera.rotation.x = pitch;
}

// =====================================
// TOUCH JOYSTICK
// =====================================

const joystick = document.getElementById("joystick");
const stick = document.getElementById("stick");

let joyTouch = null;

joystick.addEventListener("pointerdown", e => {
  joyTouch = e.pointerId;
  joystick.setPointerCapture(e.pointerId);
  updateJoystick(e);
});

joystick.addEventListener("pointermove", e => {
  if (e.pointerId === joyTouch) updateJoystick(e);
});

function updateJoystick(e) {
  const rect = joystick.getBoundingClientRect();

  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;

  let dx = e.clientX - cx;
  let dy = e.clientY - cy;

  const max = 42;
  const distance = Math.hypot(dx, dy);

  if (distance > max) {
    dx = dx / distance * max;
    dy = dy / distance * max;
  }

  stick.style.transform =
    `translate(${dx}px, ${dy}px)`;

  moveX = dx / max;
  moveY = dy / max;
}

function releaseJoystick() {
  joyTouch = null;
  joystickActive = false;
  moveX = 0;
  moveY = 0;
  stick.style.transform = "translate(0,0)";
}

joystick.addEventListener("pointerup", releaseJoystick);
joystick.addEventListener("pointercancel", releaseJoystick);

// =====================================
// TOUCH CAMERA
// =====================================

const lookArea = document.getElementById("lookArea");

let lookTouch = null;
let lastLookX = 0;
let lastLookY = 0;

lookArea.addEventListener("pointerdown", e => {
  lookTouch = e.pointerId;
  lastLookX = e.clientX;
  lastLookY = e.clientY;
  lookArea.setPointerCapture(e.pointerId);
});

lookArea.addEventListener("pointermove", e => {
  if (e.pointerId !== lookTouch || !gameStarted) return;

  const dx = e.clientX - lastLookX;
  const dy = e.clientY - lastLookY;

  yaw -= dx * 0.006;
  pitch -= dy * 0.004;

  pitch = THREE.MathUtils.clamp(
    pitch, -1.25, 1.25
  );

  lastLookX = e.clientX;
  lastLookY = e.clientY;
});

function releaseLook() {
  lookTouch = null;
}

lookArea.addEventListener("pointerup", releaseLook);
lookArea.addEventListener("pointercancel", releaseLook);

// =====================================
// SHOOTING
// =====================================

function shoot() {
  if (!gameStarted || gameEnded || reloading) return;

  if (ammo <= 0) {
    reload();
    return;
  }

  ammo--;
  updateHUD();

  const origin = camera.position.clone();
  const direction = new THREE.Vector3();

  camera.getWorldDirection(direction);
  raycaster.set(origin, direction);
  raycaster.far = 22;

  const targets = [];

  enemies.forEach(enemy => {
    if (enemy.active) {
      enemy.group.traverse(object => {
        if (object.isMesh) targets.push(object);
      });
    }
  });

  const hits = raycaster.intersectObjects(targets, false);

  if (hits.length > 0) {
    const hit = hits[0].object;

    const enemy = enemies.find(e => {
      let found = false;
      e.group.traverse(object => {
        if (object === hit) found = true;
      });
      return found;
    });

    if (enemy) {
      enemy.hp--;

      enemy.group.scale.setScalar(0.9);

      setTimeout(() => {
        if (enemy.active) enemy.group.scale.setScalar(1);
      }, 100);

      if (enemy.hp <= 0) {
        enemy.active = false;
        scene.remove(enemy.group);
        enemies = enemies.filter(e => e !== enemy);

        if (enemies.length === 0) {
          document.getElementById("message").textContent =
            "ALL DRONES DEACTIVATED! FIND THE KEY!";
        }
      }
    }
  }

  // Small visual flash
  document.getElementById("crosshair").style.color = "#ffdf70";

  setTimeout(() => {
    document.getElementById("crosshair").style.color = "white";
  }, 100);
}

// =====================================
// RELOADING
// =====================================

function reload() {
  if (reloading || ammo === 35 || !gameStarted) return;

  reloading = true;

  const text = document.getElementById("reloadText");
  text.style.display = "block";

  setTimeout(() => {
    ammo = 35;
    reloading = false;
    text.style.display = "none";
    updateHUD();
  }, 1300);
}

// =====================================
// DASH
// =====================================

function dash() {
  if (!gameStarted || gameEnded || dashCooldown > 0) return;

  dashing = true;
  dashCooldown = 5;

  document.getElementById("dashText").textContent =
    "DASH RECHARGING...";

  setTimeout(() => {
    dashing = false;
  }, 280);

  setTimeout(() => {
    document.getElementById("dashText").textContent =
      "DASH READY";
  }, 5000);
}

// =====================================
// BUTTONS
// =====================================

document.getElementById("fire").addEventListener("pointerdown", e => {
  e.preventDefault();
  shoot();
});

document.getElementById("reload").addEventListener("pointerdown", e => {
  e.preventDefault();
  reload();
});

document.getElementById("dash").addEventListener("pointerdown", e => {
  e.preventDefault();
  dash();
});

// Desktop keyboard controls
const keys = {};

window.addEventListener("keydown", e => {
  keys[e.key.toLowerCase()] = true;

  if (e.key === " ") shoot();
  if (e.key.toLowerCase() === "r") reload();
  if (e.key.toLowerCase() === "shift") dash();
});

window.addEventListener("keyup", e => {
  keys[e.key.toLowerCase()] = false;
});

function keyboardMovement() {
  const x =
    (keys["d"] || keys["arrowright"] ? 1 : 0) -
    (keys["a"] || keys["arrowleft"] ? 1 : 0);

  const y =
    (keys["s"] || keys["arrowdown"] ? 1 : 0) -
    (keys["w"] || keys["arrowup"] ? 1 : 0);

  if (x !== 0 || y !== 0) {
    moveX = x;
    moveY = y;
  } else if (!joystickActive) {
    moveX = 0;
    moveY = 0;
  }
}

// =====================================
// ENEMY AI
// =====================================

function updateEnemies(delta) {
  enemies.forEach(enemy => {
    if (!enemy.active) return;

    const dx = player.x - enemy.group.position.x;
    const dz = player.z - enemy.group.position.z;

    const distance = Math.hypot(dx, dz);

    if (distance < 10 && distance > 1.2) {
      const speed = enemy.speed * delta;

      const nx = dx / distance;
      const nz = dz / distance;

      const nextX = enemy.group.position.x + nx * speed;
      const nextZ = enemy.group.position.z + nz * speed;

      if (gridAt(nextX, enemy.group.position.z) === 0) {
        enemy.group.position.x = nextX;
      }

      if (gridAt(enemy.group.position.x, nextZ) === 0) {
        enemy.group.position.z = nextZ;
      }

      enemy.group.rotation.y = Math.atan2(dx, dz);
    }

    enemy.group.position.y =
      Math.sin(performance.now() * 0.003 + distance) * 0.12;

    enemy.attackTimer -= delta;

    if (distance < 1.5 && enemy.attackTimer <= 0) {
      health -= 10;
      enemy.attackTimer = 1.3;
      updateHUD();

      if (health <= 0) {
        health = 0;
        updateHUD();
        showGameOver();
      }
    }
  });
}

// =====================================
// COLLECT KEY AND EXIT
// =====================================

function checkObjectives() {
  if (!keyObject || gameEnded) return;

  const keyDistance = Math.hypot(
    player.x - keyObject.position.x,
    player.z - keyObject.position.z
  );

  if (!hasKey && keyDistance < 1.3) {
    hasKey = true;
    scene.remove(keyObject);
    keyObject = null;

    document.getElementById("message").textContent =
      "KEY COLLECTED! FIND THE BLUE EXIT!";
  }

  if (!exitObject) return;

  const exitDistance = Math.hypot(
    player.x - exitObject.position.x,
    player.z - exitObject.position.z
  );

  if (exitDistance < 1.5) {
    if (hasKey && enemies.length === 0) {
      completeLevel();
    } else if (!hasKey) {
      document.getElementById("message").textContent =
        "YOU NEED THE KEY!";
    } else {
      document.getElementById("message").textContent =
        "DEACTIVATE ALL DRONES FIRST!";
    }
  }
}

// =====================================
// LEVEL PROGRESSION
// =====================================

function completeLevel() {
  if (gameEnded) return;

  gameEnded = true;

  const screen = document.getElementById("endScreen");
  const title = document.getElementById("endTitle");
  const text = document.getElementById("endText");
  const button = document.getElementById("nextButton");

  screen.classList.remove("hidden");

  if (level >= 5) {
    title.textContent = "MISSION COMPLETE!";
    text.textContent = "You conquered all five mazes!";
    button.textContent = "PLAY AGAIN";
  } else {
    title.textContent = "LEVEL COMPLETE!";
    text.textContent = "Get ready for the next maze.";
    button.textContent = "NEXT LEVEL";
  }
}

function nextLevel() {
  document.getElementById("endScreen").classList.add("hidden");

  if (level >= 5) {
    level = 1;
    health = 100;
  } else {
    level++;
    health = Math.min(100, health + 20);
  }

  ammo = 35;
  hasKey = false;
  gameEnded = false;

  buildWorld();
  updateHUD();

  document.getElementById("message").textContent =
    "FIND THE KEY TO UNLOCK THE EXIT";
}

function showGameOver() {
  gameEnded = true;
  document.getElementById("gameOver").classList.remove("hidden");
}

function restartGame() {
  level = 1;
  health = 100;
  ammo = 35;
  hasKey = false;
  gameEnded = false;

  document.getElementById("gameOver").classList.add("hidden");

  buildWorld();
  updateHUD();
}

// =====================================
// HUD
// =====================================

function updateHUD() {
  document.getElementById("health").textContent = health;
  document.getElementById("level").textContent = level + " / 5";
  document.getElementById("ammo").textContent = ammo + " / ∞";
}

// =====================================
// START BUTTONS
// =====================================

document.getElementById("startButton").addEventListener("click", () => {
  document.getElementById("startScreen").classList.add("hidden");

  gameStarted = true;
  gameEnded = false;

  buildWorld();
  updateHUD();
});

document.getElementById("nextButton").addEventListener("click", nextLevel);

document.getElementById("restartButton").addEventListener("click", restartGame);

// =====================================
// MAIN GAME LOOP
// =====================================

function animate() {
  requestAnimationFrame(animate);

  const delta = Math.min(clock.getDelta(), 0.05);

  if (gameStarted && !gameEnded) {
    keyboardMovement();

    if (dashCooldown > 0) {
      dashCooldown = Math.max(0, dashCooldown - delta);
    }

    movePlayer(delta);
    updateEnemies(delta);
    checkObjectives();

    if (keyObject) {
      keyObject.rotation.y += delta * 2;
    }

    if (exitObject) {
      exitObject.rotation.y = Math.sin(performance.now() * 0.001) * 0.08;
    }
  }

  renderer.render(scene, camera);
}

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();

  renderer.setSize(window.innerWidth, window.innerHeight);
});

buildWorld();
animate();
updateHUD();
