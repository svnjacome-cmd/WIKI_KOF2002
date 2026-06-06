// ==================== INDEXED DB ====================
let db = null;
let characters = [];
let activeIndex = -1;
let currentAdminIndex = -1;
let timerValue = 30;
let timerInterval;

// TIMER
const TIMER = { start:30, countdown:true, ms:1000, onZero(){ setStatus('¡TIEMPO AGOTADO!'); } };

// Inicializar IndexedDB
function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('KOFWikiDB', 2);
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      db = request.result;
      resolve();
    };
    
    request.onupgradeneeded = (event) => {
      const dbEvent = event.target.result;
      if (!dbEvent.objectStoreNames.contains('characters')) {
        dbEvent.createObjectStore('characters', { keyPath: 'id' });
      }
      if (!dbEvent.objectStoreNames.contains('images')) {
        dbEvent.createObjectStore('images', { keyPath: 'id', autoIncrement: true });
      }
    };
  });
}

// Guardar imagen en IndexedDB
async function saveImageToDB(blob) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['images'], 'readwrite');
    const store = transaction.objectStore('images');
    const request = store.add({ data: blob, mimeType: blob.type, timestamp: Date.now() });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Obtener imagen desde IndexedDB
async function getImageFromDB(id) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['images'], 'readonly');
    const store = transaction.objectStore('images');
    const request = store.get(id);
    request.onsuccess = () => {
      if (request.result) {
        const url = URL.createObjectURL(request.result.data);
        resolve(url);
      } else resolve(null);
    };
    request.onerror = () => reject(request.error);
  });
}

// Cargar todos los personajes
async function loadCharacters() {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['characters'], 'readonly');
    const store = transaction.objectStore('characters');
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

// Guardar personaje
async function saveCharacterToDB(char) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['characters'], 'readwrite');
    const store = transaction.objectStore('characters');
    const request = store.put(char);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

// ==================== FUNCIONES DE IMAGEN ====================
function resizeImage(file, maxWidth, maxHeight, callback) {
  const reader = new FileReader();
  reader.onload = function(e) {
    const img = new Image();
    img.onload = function() {
      let width = img.width;
      let height = img.height;
      
      if (width > maxWidth || height > maxHeight) {
        const ratio = Math.min(maxWidth / width, maxHeight / height);
        width = Math.floor(width * ratio);
        height = Math.floor(height * ratio);
      }
      
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      
      canvas.toBlob((blob) => {
        callback(blob);
      }, 'image/jpeg', 0.75);
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

async function uploadImageFile(input, type) {
  const file = input.files[0];
  if (!file) return;
  
  if (currentAdminIndex < 0) {
    showAdminStatus('❌ Selecciona un personaje primero', true);
    input.value = '';
    return;
  }
  
  showAdminStatus('🔄 Procesando imagen...', false);
  input.disabled = true;
  
  const maxDim = type === 'thumb' ? { w: 150, h: 200 } : { w: 400, h: 500 };
  
  resizeImage(file, maxDim.w, maxDim.h, async (resizedBlob) => {
    const imageId = await saveImageToDB(resizedBlob);
    const imageUrl = URL.createObjectURL(resizedBlob);
    
    if (type === 'thumb') {
      document.getElementById('editThumb').value = `db://${imageId}`;
      document.getElementById('thumbPreview').innerHTML = `<img src="${imageUrl}" class="preview-img">`;
    } else {
      document.getElementById('editPortrait').value = `db://${imageId}`;
      document.getElementById('portraitPreview').innerHTML = `<img src="${imageUrl}" class="preview-img">`;
    }
    
    const sizeKB = Math.round(resizedBlob.size / 1024);
    showAdminStatus(`✅ Imagen guardada (${sizeKB} KB)`, false);
    input.disabled = false;
    input.value = '';
  });
}

function testImageUrl(type) {
  const inputId = type === 'thumb' ? 'editThumb' : 'editPortrait';
  const url = document.getElementById(inputId).value;
  
  if (!url || url.startsWith('db://')) {
    showAdminStatus('❌ Ingresa una URL válida', true);
    return;
  }
  
  showAdminStatus('🔍 Probando URL...', false);
  
  const img = new Image();
  img.onload = () => {
    const previewId = type === 'thumb' ? 'thumbPreview' : 'portraitPreview';
    document.getElementById(previewId).innerHTML = `<img src="${url}" class="preview-img">`;
    showAdminStatus('✅ URL válida', false);
  };
  img.onerror = () => {
    showAdminStatus('❌ URL inválida', true);
  };
  img.src = url;
}

function clearImage(type) {
  const inputId = type === 'thumb' ? 'editThumb' : 'editPortrait';
  const previewId = type === 'thumb' ? 'thumbPreview' : 'portraitPreview';
  
  document.getElementById(inputId).value = '';
  document.getElementById(previewId).innerHTML = '';
  showAdminStatus('🗑️ Imagen eliminada', false);
}

async function getImageUrl(value) {
  if (value && value.startsWith('db://')) {
    const imageId = parseInt(value.split('://')[1]);
    return await getImageFromDB(imageId);
  }
  return value;
}

function showAdminStatus(msg, isError) {
  const div = document.getElementById('adminStatus');
  div.innerHTML = msg;
  div.style.color = isError ? '#ff6666' : '#ffaa44';
  setTimeout(() => {
    if (document.getElementById('adminStatus').innerHTML === msg) {
      div.innerHTML = '';
    }
  }, 3000);
}

// ==================== RENDER GRID ====================
async function renderGrid() {
  const grid = document.getElementById('grid');
  grid.innerHTML = '';
  
  for (let idx = 0; idx < characters.length; idx++) {
    const char = characters[idx];
    const cell = document.createElement('div');
    cell.className = 'cell';
    if (activeIndex === idx) cell.classList.add('active');
    
    const imgContainer = document.createElement('div');
    imgContainer.className = 'cell-img';
    
    const imgUrl = await getImageUrl(char.miniaturaUrl);
    if (imgUrl) {
      const img = document.createElement('img');
      img.src = imgUrl;
      img.alt = char.nombre;
      img.loading = 'lazy';
      img.onerror = () => {
        img.remove();
        const placeholder = document.createElement('div');
        placeholder.className = 'cell-placeholder';
        placeholder.textContent = char.nombre.substring(0, 2).toUpperCase();
        imgContainer.appendChild(placeholder);
      };
      imgContainer.appendChild(img);
    } else {
      const placeholder = document.createElement('div');
      placeholder.className = 'cell-placeholder';
      placeholder.textContent = char.nombre.substring(0, 2).toUpperCase();
      imgContainer.appendChild(placeholder);
    }
    
    cell.appendChild(imgContainer);
    
    const nameDiv = document.createElement('div');
    nameDiv.className = 'cell-name';
    let displayName = char.nombre;
    if (displayName.length > 14) displayName = displayName.substring(0, 13) + '…';
    nameDiv.textContent = displayName;
    cell.appendChild(nameDiv);
    
    cell.onmouseenter = () => onHover(idx, cell);
    cell.onmouseleave = () => onLeave();
    cell.onclick = () => onClick(idx, cell);
    
    grid.appendChild(cell);
  }
}

// ==================== SONIDO HOVER ====================
let hoverSoundEnabled = false;

function playHoverSound() {
    if (!hoverSoundEnabled) return;
    
    const sound = new Audio('SONDIOJAJA.mp3');
    sound.volume = 0.4;
    sound.play().catch(e => {});
}

// Activar sonido después del primer clic
document.addEventListener('click', function activateHoverSound() {
    if (!hoverSoundEnabled) {
        hoverSoundEnabled = true;
        const testSound = new Audio('SONDIOJAJA.mp3');
        testSound.volume = 0.1;
        testSound.play().then(() => {
            testSound.pause();
            testSound.currentTime = 0;
        }).catch(() => {});
    }
}, { once: true });

// ==================== HOVER Y CLICK ====================
async function onHover(idx, cell) {
  playHoverSound();
  showCursor(cell);
  const char = characters[idx];
  await updateInfoPanel(char);
  document.getElementById('info1').classList.add('visible');
  setStatus('► ' + char.nombre.toUpperCase() + ' — CLICK PARA VER FICHA');
}

function onLeave() {
  hideCursor();
  if (activeIndex >= 0) {
    updateInfoPanel(characters[activeIndex]);
    document.getElementById('info1').classList.add('visible');
    setStatus('► ' + characters[activeIndex].nombre.toUpperCase() + ' — VUELVE A HACER CLICK');
  } else {
    document.getElementById('info1').classList.remove('visible');
    setStatus('SELECCIONA UN PERSONAJE');
  }
}

async function onClick(idx, cell) {
  const char = characters[idx];
  
  cell.classList.add('cell-flash');
  setTimeout(() => cell.classList.remove('cell-flash'), 150);
  
  if (char.pagina) {
    window.location.href = char.pagina;
  }
}

// ==================== INFO PANEL ====================
async function updateInfoPanel(char) {
  document.getElementById('infoName').textContent = char.nombre;
  document.getElementById('infoTeam').textContent = char.equipo || '—';
  document.getElementById('infoNation').textContent = char.nacion || '—';
  document.getElementById('infoFirst').textContent = char.primera || '—';
  document.getElementById('infoStyle').textContent = char.estilo || '—';
  document.getElementById('infoDesc').textContent = char.descripcion || '';
  
  const img = document.getElementById('img1');
  const ph = document.getElementById('ph1');
  const src = await getImageUrl(char.retratoUrl || char.miniaturaUrl);
  
  if (src) {
    img.src = src;
    img.style.display = 'block';
    ph.style.display = 'none';
    img.onerror = () => {
      img.style.display = 'none';
      ph.style.display = 'flex';
      ph.querySelector('.pph-sil').textContent = char.nombre.substring(0, 2).toUpperCase();
    };
  } else {
    img.style.display = 'none';
    ph.style.display = 'flex';
    ph.querySelector('.pph-sil').textContent = char.nombre.substring(0, 2).toUpperCase();
  }
  
  document.getElementById('nb1').style.display = 'none';
}

// ==================== CURSOR ====================
function showCursor(cell) {
  const cursor = document.getElementById('cursor');
  const right = document.getElementById('right');
  const rightRect = right.getBoundingClientRect();
  const cellRect = cell.getBoundingClientRect();
  
  cursor.style.display = 'block';
  cursor.style.left = (cellRect.left - rightRect.left - 2) + 'px';
  cursor.style.top = (cellRect.top - rightRect.top - 2) + 'px';
  cursor.style.width = (cellRect.width + 4) + 'px';
  cursor.style.height = (cellRect.height + 4) + 'px';
}

function hideCursor() {
  document.getElementById('cursor').style.display = 'none';
}

// ==================== UTILIDADES ====================
function setStatus(text) {
  document.getElementById('sbmid').textContent = text;
}

function updateCharCount() {
  document.getElementById('charCount').textContent = characters.length + ' PERSONAJES';
}

function startTimer() {
  timerValue = TIMER.start;
  updateTimerDisplay();
  clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    timerValue = Math.max(0, timerValue - 1);
    updateTimerDisplay();
    if (timerValue === 0) { TIMER.onZero(); timerValue = TIMER.start; }
  }, TIMER.ms);
}

function updateTimerDisplay() {
  const el = document.getElementById('tval');
  const container = document.getElementById('timer');
  el.textContent = timerValue.toString().padStart(2, '0');
  if (timerValue <= 10) {
    el.style.color = '#ff0000';
    container.classList.add('t-urgent');
  } else {
    el.style.color = '#ff1100';
    container.classList.remove('t-urgent');
  }
}

// ==================== MÚSICA DE FONDO ====================
let musicPlaying = false;
let musicEnabled = true;
let musicStarted = false;

function playBackgroundMusic() {
  const music = document.getElementById('bgMusic');
  if (music && !musicPlaying && musicEnabled && musicStarted) {
    music.volume = 0.3;
    music.play().then(() => {
      musicPlaying = true;
      document.getElementById('musicControl').textContent = '🔊';
    }).catch(e => console.log('Música no reproducida'));
  }
}

function stopBackgroundMusic() {
  const music = document.getElementById('bgMusic');
  if (music) {
    music.pause();
    music.currentTime = 0;
    musicPlaying = false;
    document.getElementById('musicControl').textContent = '🔇';
  }
}

function toggleMusic() {
  musicEnabled = !musicEnabled;
  if (musicEnabled && musicStarted) {
    playBackgroundMusic();
  } else {
    stopBackgroundMusic();
  }
}

// ==================== INTRO CON VIDEO ====================
const introScreen = document.getElementById('introScreen');
const introVideo = document.getElementById('introVideo');
const mainScreen = document.getElementById('screen');
const skipBtn = document.getElementById('skipBtn');

let introFinished = false;

function finishIntro() {
  if (introFinished) return;
  introFinished = true;
  
  introScreen.classList.add('hide');
  mainScreen.classList.add('visible');
  
  if (introVideo) {
    introVideo.pause();
  }
  
  musicStarted = true;
  if (musicEnabled) {
    playBackgroundMusic();
  }
  
  setTimeout(() => {
    if (introScreen && introScreen.parentNode) {
      introScreen.style.display = 'none';
    }
  }, 800);
  
  localStorage.removeItem('returnToSelector');
}

if (introVideo) {
  introVideo.addEventListener('ended', finishIntro);
}

if (skipBtn) {
  skipBtn.addEventListener('click', finishIntro);
}

if (introVideo) {
    introVideo.muted = true;
    introVideo.play().then(() => {
        document.addEventListener('click', function unmuteVideo() {
            introVideo.muted = false;
        }, { once: true });
    }).catch(e => console.log('Video requiere interacción'));
}

// ==================== BOTÓN REGRESAR ====================
function crearBotonRegresar() {
    if (document.getElementById('backToSelectorBtn')) return;
    
    const backBtn = document.createElement('button');
    backBtn.id = 'backToSelectorBtn';
    backBtn.innerHTML = '◀ REGRESAR';
    backBtn.style.position = 'fixed';
    backBtn.style.bottom = '20px';
    backBtn.style.left = '20px';
    backBtn.style.zIndex = '9999';
    backBtn.style.background = '#050520';
    backBtn.style.border = '2px solid #ff8800';
    backBtn.style.color = '#ffcc44';
    backBtn.style.fontFamily = 'Press Start 2P, monospace';
    backBtn.style.fontSize = '8px';
    backBtn.style.padding = '8px 12px';
    backBtn.style.cursor = 'pointer';
    backBtn.style.borderRadius = '4px';
    backBtn.style.transition = 'all 0.2s';
    
    backBtn.onmouseenter = () => {
        backBtn.style.background = '#221000';
        backBtn.style.color = '#ffaa00';
    };
    backBtn.onmouseleave = () => {
        backBtn.style.background = '#050520';
        backBtn.style.color = '#ffcc44';
    };
    
    backBtn.onclick = () => {
        localStorage.setItem('returnToSelector', 'true');
        window.location.href = 'index.html';
    };
    
    document.body.appendChild(backBtn);
}

function checkIfCharacterPage() {
    if (window.location.pathname.includes('personajes/') || 
        window.location.href.includes('personajes/')) {
        crearBotonRegresar();
    }
}

document.addEventListener('DOMContentLoaded', checkIfCharacterPage);

if (localStorage.getItem('returnToSelector') === 'true') {
    if (introScreen) {
        introScreen.style.display = 'none';
    }
    if (mainScreen) {
        mainScreen.classList.add('visible');
    }
    musicStarted = true;
    if (musicEnabled) {
        playBackgroundMusic();
    }
    localStorage.removeItem('returnToSelector');
}

// ==================== ADMIN ====================
function toggleAdmin() {
  const panel = document.getElementById('admPanel');
  const isOpen = panel.classList.toggle('open');
  document.getElementById('admbtn').textContent = isOpen ? '✕' : '⚙';
  if (isOpen) updateAdminList();
}

function updateAdminList() {
  const select = document.getElementById('charSelect');
  select.innerHTML = '';
  characters.forEach((c, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = `${i.toString().padStart(2, '0')} ${c.nombre}`;
    select.appendChild(opt);
  });
}

async function loadToAdmin() {
  const idx = parseInt(document.getElementById('charSelect').value);
  if (isNaN(idx)) return;
  currentAdminIndex = idx;
  const c = characters[idx];
  
  document.getElementById('editId').value = c.id || '';
  document.getElementById('editName').value = c.nombre || '';
  document.getElementById('editThumb').value = c.miniaturaUrl || '';
  document.getElementById('editPortrait').value = c.retratoUrl || '';
  document.getElementById('editDesc').value = c.descripcion || '';
  document.getElementById('editTeam').value = c.equipo || '';
  document.getElementById('editNation').value = c.nacion || '';
  document.getElementById('editFirst').value = c.primera || '';
  document.getElementById('editStyle').value = c.estilo || '';
  document.getElementById('editPage').value = c.pagina || '';
  
  const thumbUrl = await getImageUrl(c.miniaturaUrl);
  const portraitUrl = await getImageUrl(c.retratoUrl);
  
  document.getElementById('thumbPreview').innerHTML = thumbUrl ? `<img src="${thumbUrl}" class="preview-img">` : '';
  document.getElementById('portraitPreview').innerHTML = portraitUrl ? `<img src="${portraitUrl}" class="preview-img">` : '';
  
  document.getElementById('thumbFile').value = '';
  document.getElementById('portraitFile').value = '';
}

async function saveCharacter() {
  if (currentAdminIndex < 0) {
    alert('Selecciona un personaje primero');
    return;
  }
  
  const btn = document.getElementById('saveBtn');
  btn.innerHTML = '<span class="spinner"></span> GUARDANDO...';
  btn.disabled = true;
  
  const c = characters[currentAdminIndex];
  c.id = document.getElementById('editId').value || c.id;
  c.nombre = document.getElementById('editName').value || c.nombre;
  c.miniaturaUrl = document.getElementById('editThumb').value;
  c.retratoUrl = document.getElementById('editPortrait').value;
  c.descripcion = document.getElementById('editDesc').value;
  c.equipo = document.getElementById('editTeam').value;
  c.nacion = document.getElementById('editNation').value;
  c.primera = document.getElementById('editFirst').value;
  c.estilo = document.getElementById('editStyle').value;
  c.pagina = document.getElementById('editPage').value || `personajes/${c.id}.html`;
  
  await saveCharacterToDB(c);
  characters[currentAdminIndex] = c;
  await renderGrid();
  updateAdminList();
  
  if (activeIndex === currentAdminIndex) {
    await updateInfoPanel(c);
  }
  
  btn.innerHTML = '💾 GUARDAR CAMBIOS';
  btn.disabled = false;
  showAdminStatus('✅ Personaje guardado', false);
  updateStorageInfo();
}

function exportData() {
  const exportChars = characters.map(c => ({ ...c }));
  const blob = new Blob([JSON.stringify(exportChars, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `kof_backup_${new Date().toISOString().slice(0, 19)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  showAdminStatus('📁 Backup exportado', false);
}

function importData() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json';
  input.onchange = async (e) => {
    const file = e.target.files[0];
    const text = await file.text();
    try {
      const imported = JSON.parse(text);
      if (confirm(`¿Importar ${imported.length} personajes?`)) {
        for (const char of imported) {
          await saveCharacterToDB(char);
        }
        characters = await loadCharacters();
        await renderGrid();
        updateAdminList();
        updateCharCount();
        activeIndex = -1;
        document.getElementById('info1').classList.remove('visible');
        showAdminStatus('✅ Datos importados', false);
        updateStorageInfo();
      }
    } catch(err) {
      showAdminStatus('❌ Archivo inválido', true);
    }
  };
  input.click();
}

async function resetData() {
  if (confirm('⚠️ ¿Resetear a valores por defecto? Se perderán todos los cambios.')) {
    const transaction = db.transaction(['characters'], 'readwrite');
    transaction.objectStore('characters').clear();
    await new Promise((resolve) => { transaction.oncomplete = resolve; });
    
    for (const char of DEFAULT_CHARS) {
      await saveCharacterToDB(char);
    }
    
    characters = await loadCharacters();
    await renderGrid();
    updateAdminList();
    updateCharCount();
    activeIndex = -1;
    document.getElementById('info1').classList.remove('visible');
    showAdminStatus('🔄 Datos restaurados', false);
    updateStorageInfo();
  }
}

async function updateStorageInfo() {
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const estimate = await navigator.storage.estimate();
      const usedMB = (estimate.usage / (1024 * 1024)).toFixed(2);
      const quotaMB = (estimate.quota / (1024 * 1024)).toFixed(0);
      document.getElementById('storageInfo').innerHTML = `💾 IndexedDB: ${usedMB} MB / ${quotaMB} MB | ${characters.length} personajes`;
    } else {
      document.getElementById('storageInfo').innerHTML = `💾 IndexedDB activo | ${characters.length} personajes`;
    }
  } catch(e) {
    document.getElementById('storageInfo').innerHTML = `💾 IndexedDB: ${characters.length} personajes`;
  }
}

// ==================== INICIAR ====================
async function init() {
  if (mainScreen) mainScreen.classList.remove('visible');
  
  await initDB();
  characters = await loadCharacters();
  if (characters.length === 0) {
    for (const char of DEFAULT_CHARS) {
      await saveCharacterToDB(char);
    }
    characters = await loadCharacters();
  }
  await renderGrid();
  updateAdminList();
  updateCharCount();
  startTimer();
  updateStorageInfo();
  setInterval(updateStorageInfo, 10000);
  
  musicEnabled = true;
  musicStarted = false;
}

init();