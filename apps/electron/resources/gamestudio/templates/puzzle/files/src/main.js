import * as THREE from 'three'

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x111827)
const camera = new THREE.OrthographicCamera(-5, 5, 4, -4, 0.1, 50)
camera.position.set(0, 8, 6)
camera.lookAt(0, 0, 0)
const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setSize(innerWidth, innerHeight)
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
document.body.appendChild(renderer.domElement)

const hud = document.createElement('div')
hud.style.cssText = 'position:fixed;left:16px;top:16px;color:white;font:14px system-ui;background:#0009;padding:10px 12px;border-radius:10px;line-height:1.5'
document.body.appendChild(hud)
scene.add(new THREE.HemisphereLight(0xffffff, 0x334155, 2.2))

const grid = []
const size = 5
const colors = [0x38bdf8, 0xa78bfa, 0x34d399]
const matByColor = colors.map(color => new THREE.MeshStandardMaterial({ color }))
const selectedMat = new THREE.MeshStandardMaterial({ color: 0xfacc15 })
const cursor = { x: 0, y: 0 }
let moves = 0
let solved = false

for (let y = 0; y < size; y++) {
  grid[y] = []
  for (let x = 0; x < size; x++) {
    const value = Math.floor(Math.random() * colors.length)
    const tile = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.25, 0.85), matByColor[value])
    tile.position.set((x - 2) * 1.05, 0, (y - 2) * 1.05)
    tile.userData.value = value
    grid[y][x] = tile
    scene.add(tile)
  }
}

function cycle(x, y) {
  const tile = grid[y]?.[x]
  if (!tile) return
  tile.userData.value = (tile.userData.value + 1) % colors.length
  tile.material = matByColor[tile.userData.value]
}

function press() {
  if (solved) return
  moves++
  cycle(cursor.x, cursor.y)
  cycle(cursor.x - 1, cursor.y)
  cycle(cursor.x + 1, cursor.y)
  cycle(cursor.x, cursor.y - 1)
  cycle(cursor.x, cursor.y + 1)
  solved = grid.flat().every(tile => tile.userData.value === grid[0][0].userData.value)
}

function reset() {
  for (const tile of grid.flat()) {
    tile.userData.value = Math.floor(Math.random() * colors.length)
    tile.material = matByColor[tile.userData.value]
  }
  moves = 0
  solved = false
}

addEventListener('keydown', e => {
  if (e.key === 'ArrowLeft' || e.key.toLowerCase() === 'a') cursor.x = Math.max(0, cursor.x - 1)
  if (e.key === 'ArrowRight' || e.key.toLowerCase() === 'd') cursor.x = Math.min(size - 1, cursor.x + 1)
  if (e.key === 'ArrowUp' || e.key.toLowerCase() === 'w') cursor.y = Math.max(0, cursor.y - 1)
  if (e.key === 'ArrowDown' || e.key.toLowerCase() === 's') cursor.y = Math.min(size - 1, cursor.y + 1)
  if (e.key === ' ' || e.key === 'Enter') press()
  if (e.key.toLowerCase() === 'r') reset()
})

function tick() {
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const tile = grid[y][x]
    tile.scale.setScalar(x === cursor.x && y === cursor.y ? 1.18 : 1)
    tile.position.y = x === cursor.x && y === cursor.y ? 0.18 : 0
  }
  hud.innerHTML = `Objective: make every tile the same color<br>Controls: WASD/Arrows move, Space/Enter flip, R restart<br>Moves: ${moves}${solved ? '<br><b>Solved! Press R for a new board.</b>' : ''}`
  renderer.render(scene, camera)
  requestAnimationFrame(tick)
}
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight) })
tick()
