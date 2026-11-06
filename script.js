import * as THREE from
  "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";

// =====================================
// SETUP
// =====================================

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x101827);
scene.fog = new THREE.Fog(0x101827, 5, 28);

const camera = new THREE.PerspectiveCamera(
  75, window.innerWidth / window.innerHeight, 0.1, 100
);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.shadowMap.enabled = true;
document.getElementById("game").appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xbad8ff, 0x293044, 2));

const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(5, 12, 5);
sun.castShadow = true;
scene.add(sun);

const clock = new THREE.Clock();
const raycaster = new THREE.Raycaster();

const TILE = 3;
const SIZE = 15;
const WALL_HEIGHT = 3.5;
const PLAYER_RADIUS = 0.35;

let level = 1;
let health = 100;
let ammo = 35;
let gameStarted = false;
let gameEnded = false;
let hasKey = false;
let reloading = false;
let dashing = false;
let dashCooldown = 0;
let doorOpening = false;
let doorTimer = 0;

let maze = [];
let enemies = [];
let walls = [];
let decorations = [];
let effects = [];
let keyObject = null;
let exitObject = null;
let doorMesh = null;

let yaw = 0;
let pitch = 0;
let moveX = 0;
let moveY = 0;
let joystickActive = false;

const player = {
  x: 0,
  z: 0,
  speed: 4.5
};

// =====================================
// HELPERS
// =====================================

function worldX(x) {
  return (x - (SIZE - 1) / 2) * TILE;
}

function worldZ(z) {
  return (z - (SIZE - 1) / 2) * TILE;
}

function gridAt(x, z) {
  const gx = Math.round(x / TILE + (SIZE - 1) / 2);
  const gz = Math.round(z / TILE + (SIZE - 1) / 2);

  if (gx < 0 || gz < 0 || gx >= SIZE || gz >= SIZE) return 1;
  return maze[gz][gx];
}

function showMessage(message) {
  document.getElementById("message").textContent = message;
}

function updateHUD() {
  document.getElementById("health").textContent = health;
  document.getElementById("level").textContent = level + " / 5";
  document.getElementById("ammo").textContent = ammo + " / 35";
}

// =====================================
// MAZE
// =====================================

function createMaze() {
  maze = Array.from(
    { length: SIZE },
    () => Array(SIZE).fill(0)
  );

  for (let i = 0; i < SIZE; i++) {
    maze[0][i] = 1;
    maze[SIZE - 1][i] = 1;
    maze[i][0] = 1;
    maze[i][SIZE - 1] = 1;
  }

  const density = 0.12 + level * 0.025;

  for (let z = 2; z < SIZE - 2; z++) {
    for (let x = 2; x < SIZE - 2; x++) {
      if (Math.random() < density) maze[z][x] = 1;
    }
  }

  // Keep the outer route clear.
  for (let i = 1; i < SIZE - 1; i++) {
    maze[1][i] = 0;
    maze[SIZE - 2][i] = 0;
    maze[i][1] = 0;
    maze[i][SIZE - 2] = 0;
  }

  // Starting area.
  for (let z = 1; z <= 3; z++) {
    for (let x = 1; x <= 3; x++) maze[z][x] = 0;
  }

  // Key and exit areas.
  for (let z = SIZE - 4; z < SIZE - 1; z++) {
    for (let x = SIZE - 4; x < SIZE - 1; x++) maze[z][x] = 0;
  }

  // Connecting route.
  for (let i = 1; i < SIZE - 1; i++) {
    maze[SIZE - 2][i] = 0;
    maze[i][SIZE - 2] = 0;
  }
}

// =====================================
// WORLD
// =====================================

function clearWorld() {
  [...walls, ...decorations].forEach(o => scene.remove(o));
  enemies.forEach(e => scene.remove(e.group));
  effects.forEach(e => scene.remove(e.object));

  if (keyObject) scene.remove(keyObject);
  if (exitObject) scene.remove(exitObject);

  walls = [];
  decorations = [];
  enemies = [];
  effects = [];
  keyObject = null;
  exitObject = null;
  doorMesh = null;
  doorOpening = false;
  doorTimer = 0;
}

function addWall(x, z) {
  const wall = new THREE.Mesh(
    new THREE.BoxGeometry(TILE, WALL_HEIGHT, TILE),
    new THREE.MeshStandardMaterial({
      color: level % 2 ? 0x344b65 : 0x45404e,
      roughness: 0.8
    })
  );

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
      color: 0x252f40,
      roughness: 0.95
    })
  );

  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  decorations.push(floor);

  for (let z = 0; z < SIZE; z++) {
    for (let x = 0; x < SIZE; x++) {
      if (maze[z][x] === 1) addWall(worldX(x), worldZ(z));
    }
  }

  // Blue ceiling lights.
  for (let z = 2; z < SIZE - 2; z += 4) {
    for (let x = 2; x < SIZE - 2; x += 4) {
      if (maze[z][x] === 0) {
        const lamp = new THREE.PointLight(0x4c9dff, 1.4, 9);
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
// KEY
// =====================================

function createKey() {
  keyObject = new THREE.Group();

  const gold = new THREE.MeshStandardMaterial({
    color: 0xffd22e,
    metalness: 0.8,
    roughness: 0.25,
    emissive: 0x805000
  });

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.22, 0.065, 10, 24),
    gold
  );
  ring.position.x = -0.2;
  keyObject.add(ring);

  const shaft = new THREE.Mesh(
    new THREE.BoxGeometry(0.55, 0.09, 0.09),
    gold
  );
  shaft.position.x = 0.2;
  keyObject.add(shaft);

  const tooth1 = new THREE.Mesh(
    new THREE.BoxGeometry(0.1, 0.2, 0.09),
    gold
  );
  tooth1.position.set(0.35, -0.08, 0);
  keyObject.add(tooth1);

  const tooth2 = tooth1.clone();
  tooth2.position.x = 0.52;
  keyObject.add(tooth2);

  keyObject.position.set(worldX(SIZE - 2), 1.2, worldZ(1));
  scene.add(keyObject);
}

// =====================================
// EXIT DOOR
// =====================================

function createExit() {
  exitObject = new THREE.Group();

  const frameMaterial = new THREE.MeshStandardMaterial({
    color: 0x1765aa,
    metalness: 0.5,
    emissive: 0x063b75
  });

  const left = new THREE.Mesh(
    new THREE.BoxGeometry(0.18, 2.8, 0.3),
    frameMaterial
  );
  left.position.x = -0.8;

  const right = left.clone();
  right.position.x = 0.8;

  const top = new THREE.Mesh(
    new THREE.BoxGeometry(1.7, 0.18, 0.3),
    frameMaterial
  );
  top.position.y = 1.4;

  doorMesh = new THREE.Mesh(
    new THREE.BoxGeometry(1.35, 2.55, 0.18),
    new THREE.MeshStandardMaterial({
      color: 0x16a5e8,
      emissive: 0x07558c,
      metalness: 0.5
    })
  );
  doorMesh.position.y = 1.25;

  exitObject.add(left, right, top, doorMesh);
  exitObject.position.set(worldX(SIZE - 2), 0, worldZ(SIZE - 2));
  scene.add(exitObject);
}

function openDoor() {
  if (doorOpening) return;

  doorOpening = true;
  doorTimer = 0;
  showMessage("KEY ACCEPTED! EXIT UNLOCKED!");
}

// =====================================
// ROBOT BOTS
// =====================================

function createRobot(x, z) {
  const group = new THREE.Group();

  const metal = new THREE.MeshStandardMaterial({
    color: 0x657d98,
    metalness: 0.75,
    roughness: 0.3
  });

  const dark = new THREE.MeshStandardMaterial({
    color: 0x182536,
    metalness: 0.6
  });

  const red = new THREE.MeshStandardMaterial({
    color: 0xff3030,
    emissive: 0x8a0000
  });

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.85, 0.9, 0.55),
    metal
  );
  body.position.y = 1.05;
  body.castShadow = true;
  group.add(body);

  const head = new THREE.Mesh(
    new THREE.BoxGeometry(0.65, 0.5, 0.55),
    dark
  );
  head.position.y = 1.78;
  group.add(head);

  const eye = new THREE.Mesh(
    new THREE.BoxGeometry(0.42, 0.12, 0.08),
    red
  );
  eye.position.set(0, 1.8, -0.3);
  group.add(eye);

  const armGeometry = new THREE.BoxGeometry(0.2, 0.75, 0.22);

  const arm1 = new THREE.Mesh(armGeometry, metal);
  arm1.position.set(-0.55, 1.05, 0);
  group.add(arm1);

  const arm2 = arm1.clone();
  arm2.position.x = 0.55;
  group.add(arm2);

  const legGeometry = new THREE.BoxGeometry(0.25, 0.65, 0.28);

  const leg1 = new THREE.Mesh(legGeometry, dark);
  leg1.position.set(-0.22, 0.33, 0);
  group.add(leg1);

  const leg2 = leg1.clone();
  leg2.position.x = 0.22;
  group.add(leg2);

  group.position.set(x, 0, z);
  scene.add(group);

  return {
    group,
    hp: 3 + level,
    speed: 0.65 + level * 0.12,
    attackTimer: 0,
    active: true,
    walkTime: Math.random() * 5,
    legs: [leg1, leg2],
    arms: [arm1, arm2]
  };
}

function createEnemies() {
  const count = level + 1;

  for (let i = 0; i < count; i++) {
    let x = 0;
    let z = 0;
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
      attempts < 150
    );

    if (attempts < 150) enemies.push(createRobot(x, z));
  }
}

// =====================================
// MOVEMENT
// =====================================

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

  if (canMove(player.x + dx, player.z)) player.x += dx;
  if (canMove(player.x, player.z + dz)) player.z += dz;

  camera.position.set(player.x, 1.65, player.z);
  camera.rotation.order = "YXZ";
  camera.rotation.y = yaw;
  camera.rotation.x = pitch;
}

// =====================================
// JOYSTICK
// =====================================

const joystick = document.getElementById("joystick");
const stick = document.getElementById("stick");
let joyTouch = null;

joystick.addEventListener("pointerdown", e => {
  joyTouch = e.pointerId;
  joystick.setPointerCapture(e.pointerId);
  joystickActive = true;
  updateJoystick(e);
});

joystick.addEventListener("pointermove", e => {
  if (e.pointerId === joyTouch) updateJoystick(e);
});

function updateJoystick(e) {
  const rect = joystick.getBoundingClientRect();
  let dx = e.clientX - (rect.left + rect.width / 2);
  let dy = e.clientY - (rect.top + rect.height / 2);

  const max = 42;
  const distance = Math.hypot(dx, dy);

  if (distance > max) {
    dx = dx / distance * max;
    dy = dy / distance * max;
  }

  stick.style.transform = `translate(${dx}px, ${dy}px)`;
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
// LOOK AROUND
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
  pitch = THREE.MathUtils.clamp(pitch, -1.25, 1.25);

  lastLookX = e.clientX;
  lastLookY = e.clientY;
});

function releaseLook() {
  lookTouch = null;
}

lookArea.addEventListener("pointerup", releaseLook);
lookArea.addEventListener("pointercancel", releaseLook);

// =====================================
// BULLET EFFECTS
// =====================================

function createTracer(start, end, hit) {
  const geometry = new THREE.BufferGeometry().setFromPoints([start, end]);

  const line = new THREE.Line(
    geometry,
    new THREE.LineBasicMaterial({
      color: hit ? 0xffe28a : 0x7bdcff,
      transparent: true,
      opacity: 1
    })
  );

  scene.add(line);
  effects.push({ object: line, life: 0.12 });
}

function showHitMarker() {
  const marker = document.getElementById("hitMarker");
  marker.style.opacity = "1";

  setTimeout(() => {
    marker.style.opacity = "0";
  }, 180);
}

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
  raycaster.far = 25;

  const targets = [];

  enemies.forEach(enemy => {
    if (enemy.active) {
      enemy.group.traverse(object => {
        if (object.isMesh) targets.push(object);
      });
    }
  });

  const hits = raycaster.intersectObjects(targets, false);
  let end = origin.clone().add(direction.clone().multiplyScalar(20));

  if (hits.length > 0) {
    end = hits[0].point.clone();

    const hitObject = hits[0].object;
    const enemy = enemies.find(e => {
      let found = false;
      e.group.traverse(o => {
        if (o === hitObject) found = true;
      });
      return found;
    });

    if (enemy) {
      enemy.hp--;
      showHitMarker();

      enemy.group.scale.setScalar(0.88);
      setTimeout(() => {
        if (enemy.active) enemy.group.scale.setScalar(1);
      }, 100);

      if (enemy.hp <= 0) {
        enemy.active = false;
        scene.remove(enemy.group);
        enemies = enemies.filter(e => e !== enemy);

        if (enemies.length === 0) {
          showMessage("ALL BOTS DEACTIVATED! FIND THE KEY!");
        }
      }
    }
  }

  createTracer(origin.clone(), end, hits.length > 0);

  const crosshair = document.getElementById("crosshair");
  crosshair.style.color = "#ffdf70";
  setTimeout(() => crosshair.style.color = "white", 100);
}

// =====================================
// RELOAD
// =====================================

function reload() {
  if (reloading || ammo === 35 || !gameStarted || gameEnded) return;

  reloading = true;
  document.getElementById("reloadText").style.display = "block";

  setTimeout(() => {
    if (gameEnded) return;

    ammo = 35;
    reloading = false;
    document.getElementById("reloadText").style.display = "none";
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
  document.getElementById("dashText").textContent = "DASH RECHARGING...";

  setTimeout(() => {
    dashing = false;
  }, 280);

  setTimeout(() => {
    document.getElementById("dashText").textContent = "DASH READY";
  }, 5000);
}

// =====================================
// BUTTONS AND KEYBOARD
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

// Only S, R and D are used on the keyboard.
// WASD movement is deliberately disabled.
window.addEventListener("keydown", e => {
  const key = e.key.toLowerCase();

  if (key === "s") {
    e.preventDefault();
    shoot();
  }

  if (key === "r") {
    e.preventDefault();
    reload();
  }

  if (key === "d") {
    e.preventDefault();
    dash();
  }
});

// =====================================
// ROBOT AI
// =====================================

function updateEnemies(delta) {
  enemies.forEach(enemy => {
    if (!enemy.active) return;

    const dx = player.x - enemy.group.position.x;
    const dz = player.z - enemy.group.position.z;
    const distance = Math.hypot(dx, dz);

    enemy.walkTime += delta * 7;

    enemy.legs[0].rotation.x = Math.sin(enemy.walkTime) * 0.45;
    enemy.legs[1].rotation.x = -Math.sin(enemy.walkTime) * 0.45;
    enemy.arms[0].rotation.x = -Math.sin(enemy.walkTime) * 0.25;
    enemy.arms[1].rotation.x = Math.sin(enemy.walkTime) * 0.25;

    if (distance < 12 && distance > 1.25) {
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
      enemy.group.position.y = Math.abs(Math.sin(enemy.walkTime)) * 0.06;
    }

    enemy.attackTimer -= delta;

    if (distance < 1.5 && enemy.attackTimer <= 0) {
      health = Math.max(0, health - 5);
      enemy.attackTimer = 1;
      updateHUD();

      if (health <= 0) {
        showGameOver();
      }
    }
  });
}

// =====================================
// KEY AND EXIT OBJECTIVES
// =====================================

function checkObjectives() {
  if (gameEnded || doorOpening) return;

  if (keyObject && !hasKey) {
    const distance = Math.hypot(
      player.x - keyObject.position.x,
      player.z - keyObject.position.z
    );

    if (distance < 1.3) {
      hasKey = true;
      scene.remove(keyObject);
      keyObject = null;
      showMessage("KEY COLLECTED! NOW FIND THE EXIT!");
    }
  }

  if (!exitObject) return;

  const exitDistance = Math.hypot(
    player.x - exitObject.position.x,
    player.z - exitObject.position.z
  );

  if (exitDistance < 1.7) {
    if (!hasKey) {
      showMessage("THE DOOR IS LOCKED! FIND THE KEY!");
    } else if (enemies.length > 0) {
      showMessage("DEACTIVATE ALL THE BOTS FIRST!");
    } else {
      openDoor();
    }
  }
}

// =====================================
// DOOR ANIMATION
// =====================================

function updateDoor(delta) {
  if (!doorOpening || !doorMesh) return;

  doorTimer += delta;

  // Door slides sideways into its frame.
  doorMesh.position.x = Math.min(1.5, doorTimer * 2.2);
  doorMesh.material.emissiveIntensity =
    Math.max(0, 1 - doorTimer);

  // A short pause, then move to the next level.
  if (doorTimer > 1.3) {
    completeLevel();
  }
}

// =====================================
// LEVELS
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
    text.textContent = "You escaped all five maze levels!";
    button.textContent = "PLAY AGAIN";
  } else {
    title.textContent = "LEVEL COMPLETE!";
    text.textContent = "The door has opened. Prepare for the next maze.";
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
  reloading = false;

  document.getElementById("reloadText").style.display = "none";
  buildWorld();
  updateHUD();
  showMessage("DEACTIVATE THE BOTS. FIND THE KEY. ESCAPE.");
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
  reloading = false;
  dashing = false;

  document.getElementById("gameOver").classList.add("hidden");
  document.getElementById("reloadText").style.display = "none";

  buildWorld();
  updateHUD();
  showMessage("DEACTIVATE THE BOTS. FIND THE KEY. ESCAPE.");
}

// =====================================
// START BUTTON
// =====================================

document.getElementById("startButton").addEventListener("pointerup", e => {
  e.preventDefault();

  document.getElementById("startScreen").classList.add("hidden");
  gameStarted = true;
  gameEnded = false;

  buildWorld();
  updateHUD();
});

document.getElementById("nextButton").addEventListener("click", nextLevel);
document.getElementById("restartButton").addEventListener("click", restartGame);

// =====================================
// MAIN LOOP
// =====================================

function animate() {
  requestAnimationFrame(animate);

  const delta = Math.min(clock.getDelta(), 0.05);

  if (gameStarted && !gameEnded) {
    if (dashCooldown > 0) {
      dashCooldown = Math.max(0, dashCooldown - delta);
    }

    movePlayer(delta);
    updateEnemies(delta);
    checkObjectives();
    updateDoor(delta);

    if (keyObject) {
      keyObject.rotation.y += delta * 2;
      keyObject.position.y = 1.2 + Math.sin(performance.now() * 0.003) * 0.12;
    }

    if (exitObject && !doorOpening) {
      exitObject.rotation.y =
        Math.sin(performance.now() * 0.001) * 0.04;
    }
  }

  // Remove old bullet tracers.
  for (let i = effects.length - 1; i >= 0; i--) {
    effects[i].life -= delta;

    if (effects[i].life <= 0) {
      scene.remove(effects[i].object);
      effects.splice(i, 1);
    }
  }

  renderer.render(scene, camera);
}

// =====================================
// RESIZE
// =====================================

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// =====================================
// START
// =====================================

buildWorld();
updateHUD();
animate();
