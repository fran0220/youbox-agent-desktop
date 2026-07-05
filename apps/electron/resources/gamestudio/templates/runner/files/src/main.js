import * as THREE from 'three'

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x07111f)
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 100)
camera.position.set(0, 4.5, 7)
camera.lookAt(0, 0, -4)

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setSize(innerWidth, innerHeight)
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
document.body.appendChild(renderer.domElement)

const hud = document.createElement('div')
hud.style.cssText = 'position:fixed;left:16px;top:16px;color:white;font:14px system-ui;background:#0008;padding:10px 12px;border-radius:10px;line-height:1.5'
document.body.appendChild(hud)

scene.add(new THREE.HemisphereLight(0x9ecbff, 0x172033, 2.2))
const laneMat = new THREE.MeshStandardMaterial({ color: 0x24324a })
const playerMat = new THREE.MeshStandardMaterial({ color: 0x22d3ee })
const hazardMat = new THREE.MeshStandardMaterial({ color: 0xfb7185 })
const coinMat = new THREE.MeshStandardMaterial({ color: 0xfacc15 })

const floor = new THREE.Mesh(new THREE.BoxGeometry(8, 0.2, 120), laneMat)
floor.position.z = -45
scene.add(floor)

const player = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8), playerMat)
player.position.y = 0.55
scene.add(player)

const keys = new Set()
addEventListener('keydown', e => { keys.add(e.key.toLowerCase()); if (e.key.toLowerCase() === 'r') reset() })
addEventListener('keyup', e => keys.delete(e.key.toLowerCase()))

const objects = []
let score = 0
let speed = 7
let gameOver = false
let spawnTimer = 0

function spawn() {
  const isCoin = Math.random() > 0.45
  const mesh = new THREE.Mesh(isCoin ? new THREE.SphereGeometry(0.32, 18, 12) : new THREE.BoxGeometry(0.9, 0.9, 0.9), isCoin ? coinMat : hazardMat)
  mesh.userData.kind = isCoin ? 'coin' : 'hazard'
  mesh.position.set([-2.4, 0, 2.4][Math.floor(Math.random() * 3)], isCoin ? 0.8 : 0.55, -48)
  objects.push(mesh)
  scene.add(mesh)
}

function reset() {
  for (const object of objects.splice(0)) scene.remove(object)
  score = 0
  speed = 7
  gameOver = false
  player.position.x = 0
}

let last = performance.now()
function tick(now) {
  const dt = Math.min(0.033, (now - last) / 1000)
  last = now
  if (!gameOver) {
    if (keys.has('arrowleft') || keys.has('a')) player.position.x -= 6 * dt
    if (keys.has('arrowright') || keys.has('d')) player.position.x += 6 * dt
    player.position.x = THREE.MathUtils.clamp(player.position.x, -2.6, 2.6)
    spawnTimer -= dt
    if (spawnTimer <= 0) { spawn(); spawnTimer = Math.max(0.35, 1.1 - score / 80) }
    for (let i = objects.length - 1; i >= 0; i--) {
      const object = objects[i]
      object.position.z += speed * dt
      object.rotation.y += dt * 3
      if (object.position.distanceTo(player.position) < 0.75) {
        if (object.userData.kind === 'coin') score += 10
        else gameOver = true
        scene.remove(object)
        objects.splice(i, 1)
      } else if (object.position.z > 5) {
        scene.remove(object)
        objects.splice(i, 1)
      }
    }
    score += dt * 2
    speed += dt * 0.18
  }
  hud.innerHTML = `Objective: collect gold, dodge red blocks<br>Controls: A/D or ←/→, R restart<br>Score: ${Math.floor(score)}${gameOver ? '<br><b>Crash! Press R to restart.</b>' : ''}`
  renderer.render(scene, camera)
  requestAnimationFrame(tick)
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(innerWidth, innerHeight)
})
requestAnimationFrame(tick)
