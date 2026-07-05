import * as THREE from 'three'

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x050816)
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 100)
camera.position.set(0, 7, 8)
camera.lookAt(0, 0, 0)
const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setSize(innerWidth, innerHeight)
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
document.body.appendChild(renderer.domElement)

const hud = document.createElement('div')
hud.style.cssText = 'position:fixed;left:16px;top:16px;color:white;font:14px system-ui;background:#0009;padding:10px 12px;border-radius:10px;line-height:1.5'
document.body.appendChild(hud)

scene.add(new THREE.HemisphereLight(0xffffff, 0x172033, 2))
const player = new THREE.Mesh(new THREE.ConeGeometry(0.45, 1.1, 4), new THREE.MeshStandardMaterial({ color: 0x38bdf8 }))
player.rotation.x = Math.PI / 2
scene.add(player)
const arena = new THREE.Mesh(new THREE.RingGeometry(2, 7, 64), new THREE.MeshBasicMaterial({ color: 0x1e293b, side: THREE.DoubleSide }))
arena.rotation.x = -Math.PI / 2
scene.add(arena)

const keys = new Set()
addEventListener('keydown', e => { keys.add(e.key.toLowerCase()); if (e.key.toLowerCase() === 'r') reset(); if (e.code === 'Space') shoot() })
addEventListener('keyup', e => keys.delete(e.key.toLowerCase()))

const bullets = []
const enemies = []
let score = 0
let health = 5
let spawnTimer = 0

function shoot() {
  if (health <= 0) return
  const bullet = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), new THREE.MeshBasicMaterial({ color: 0xf8fafc }))
  bullet.position.copy(player.position)
  bullet.userData.velocity = new THREE.Vector3(0, 0, -12).applyAxisAngle(new THREE.Vector3(0, 1, 0), player.rotation.y)
  bullets.push(bullet)
  scene.add(bullet)
}

function spawnEnemy() {
  const angle = Math.random() * Math.PI * 2
  const enemy = new THREE.Mesh(new THREE.IcosahedronGeometry(0.45), new THREE.MeshStandardMaterial({ color: 0xf43f5e }))
  enemy.position.set(Math.cos(angle) * 7, 0, Math.sin(angle) * 7)
  enemies.push(enemy)
  scene.add(enemy)
}

function reset() {
  for (const item of [...bullets, ...enemies]) scene.remove(item)
  bullets.length = 0
  enemies.length = 0
  score = 0
  health = 5
  player.position.set(0, 0, 0)
}

let last = performance.now()
function tick(now) {
  const dt = Math.min(0.033, (now - last) / 1000)
  last = now
  if (health > 0) {
    if (keys.has('a') || keys.has('arrowleft')) player.rotation.y += 4 * dt
    if (keys.has('d') || keys.has('arrowright')) player.rotation.y -= 4 * dt
    if (keys.has('w') || keys.has('arrowup')) player.position.add(new THREE.Vector3(0, 0, -4 * dt).applyAxisAngle(new THREE.Vector3(0, 1, 0), player.rotation.y))
    if (keys.has('s') || keys.has('arrowdown')) player.position.add(new THREE.Vector3(0, 0, 3 * dt).applyAxisAngle(new THREE.Vector3(0, 1, 0), player.rotation.y))
    player.position.clamp(new THREE.Vector3(-6, 0, -6), new THREE.Vector3(6, 0, 6))
    spawnTimer -= dt
    if (spawnTimer <= 0) { spawnEnemy(); spawnTimer = Math.max(0.35, 1.2 - score / 80) }
  }
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i]
    b.position.addScaledVector(b.userData.velocity, dt)
    if (b.position.length() > 12) { scene.remove(b); bullets.splice(i, 1) }
  }
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i]
    const dir = player.position.clone().sub(e.position).normalize()
    e.position.addScaledVector(dir, (1.3 + score / 80) * dt)
    if (e.position.distanceTo(player.position) < 0.7) { health--; scene.remove(e); enemies.splice(i, 1) }
    for (let j = bullets.length - 1; j >= 0; j--) {
      if (e.position.distanceTo(bullets[j].position) < 0.55) { score += 5; scene.remove(e); scene.remove(bullets[j]); enemies.splice(i, 1); bullets.splice(j, 1); break }
    }
  }
  hud.innerHTML = `Objective: survive and clear drones<br>Controls: WASD/Arrows move, Space shoot, R restart<br>Score: ${score} Health: ${health}${health <= 0 ? '<br><b>Defeated! Press R to restart.</b>' : ''}`
  renderer.render(scene, camera)
  requestAnimationFrame(tick)
}
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight) })
requestAnimationFrame(tick)
