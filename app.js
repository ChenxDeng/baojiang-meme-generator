// ===== State =====
const state = {
  originalImage: null,      // HTMLImageElement
  layout: 'top',            // 'top' | 'bottom'
  pixelateLevel: 8,         // 1-30
  text: '',
  cropRatio: 'free',        // 'free' | '1:1' | '4:3' | '16:9' | '3:4'
  cropRect: null,           // { x, y, w, h } in original image coords
};

// ===== DOM refs =====
const fileInput = document.getElementById('fileInput');
const emptyState = document.getElementById('emptyState');
const textInput = document.getElementById('textInput');
const pixelateSlider = document.getElementById('pixelateSlider');
const pixelateValue = document.getElementById('pixelateValue');
const previewCanvas = document.getElementById('previewCanvas');
const downloadBtn = document.getElementById('downloadBtn');
const resetBtn = document.getElementById('resetBtn');
const cropOverlay = document.getElementById('cropOverlay');
const cropCanvas = document.getElementById('cropCanvas');
const cropSelection = document.getElementById('cropSelection');
const cropConfirmBtn = document.getElementById('cropConfirmBtn');
const cropCancelBtn = document.getElementById('cropCancelBtn');

const previewCtx = previewCanvas.getContext('2d');
const cropCtx = cropCanvas.getContext('2d');

// ===== Upload =====
emptyState.addEventListener('click', () => fileInput.click());

const canvasWrapper = document.getElementById('canvasWrapper');
canvasWrapper.addEventListener('dragover', (e) => {
  e.preventDefault();
  canvasWrapper.classList.add('dragover');
});
canvasWrapper.addEventListener('dragleave', () => {
  canvasWrapper.classList.remove('dragover');
});
canvasWrapper.addEventListener('drop', (e) => {
  e.preventDefault();
  canvasWrapper.classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) loadImage(file);
});

fileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) loadImage(file);
});

function loadImage(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      state.originalImage = img;
      state.cropRect = null;
      render();
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

// ===== Layout toggle =====
document.querySelectorAll('.toggle-btn[data-layout]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.toggle-btn[data-layout]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.layout = btn.dataset.layout;
    render();
  });
});

// ===== Text input =====
textInput.addEventListener('input', () => {
  state.text = textInput.value;
  render();
});

// ===== Pixelate slider =====
pixelateSlider.addEventListener('input', () => {
  state.pixelateLevel = parseInt(pixelateSlider.value);
  pixelateValue.textContent = state.pixelateLevel;
  render();
});

// ===== Crop buttons =====
document.querySelectorAll('.crop-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.crop-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.cropRatio = btn.dataset.ratio;

    if (state.cropRatio === 'free') {
      state.cropRect = null;
      render();
    } else if (state.originalImage) {
      openCropOverlay();
    }
  });
});

// ===== Upload new image / Reset =====
resetBtn.addEventListener('click', () => {
  state.originalImage = null;
  state.cropRect = null;
  state.text = '';
  state.pixelateLevel = 8;
  state.layout = 'top';
  state.cropRatio = 'free';

  textInput.value = '';
  pixelateSlider.value = 8;
  pixelateValue.textContent = '8';
  document.querySelectorAll('.toggle-btn[data-layout]').forEach(b => b.classList.remove('active'));
  document.querySelector('.toggle-btn[data-layout="top"]').classList.add('active');
  document.querySelectorAll('.crop-btn').forEach(b => b.classList.remove('active'));
  document.querySelector('.crop-btn[data-ratio="free"]').classList.add('active');

  previewCanvas.style.display = 'none';
  emptyState.style.display = '';
  fileInput.value = '';
  fileInput.click();
});

// ===== Download =====
async function saveImage() {
  if (!state.originalImage) return;
  const result = buildFinalCanvas();

  // Try Web Share API (mobile: saves directly to photo album)
  if (navigator.share && navigator.canShare) {
    result.toBlob(async (blob) => {
      const file = new File([blob], 'baojiang-meme.jpg', { type: 'image/jpeg' });
      if (navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file] });
          return;
        } catch (e) {
          // user cancelled or share failed, fall through to download
        }
      }
      fallbackDownload(result);
    }, 'image/jpeg', 0.95);
  } else {
    fallbackDownload(result);
  }
}

function fallbackDownload(canvas) {
  const link = document.createElement('a');
  link.download = 'baojiang-meme.jpg';
  link.href = canvas.toDataURL('image/jpeg', 0.95);
  link.click();
}

downloadBtn.addEventListener('click', saveImage);

// ===== Render pipeline =====
function render() {
  if (!state.originalImage) return;

  emptyState.style.display = 'none';
  previewCanvas.style.display = '';

  const final = buildFinalCanvas();

  // Scale to fit preview area
  const wrapper = document.getElementById('canvasWrapper');
  const maxW = wrapper.clientWidth - 40;
  const maxH = wrapper.clientHeight - 40;
  const scale = Math.min(maxW / final.width, maxH / final.height, 1);

  previewCanvas.width = final.width * scale;
  previewCanvas.height = final.height * scale;
  previewCtx.drawImage(final, 0, 0, previewCanvas.width, previewCanvas.height);
}

function buildFinalCanvas() {
  const img = state.originalImage;

  // Determine source region (crop)
  let sx = 0, sy = 0, sw = img.width, sh = img.height;
  if (state.cropRect) {
    sx = state.cropRect.x;
    sy = state.cropRect.y;
    sw = state.cropRect.w;
    sh = state.cropRect.h;
  }

  // Text bar height: expand based on line count, max 3 lines
  const outputW = sw;
  const baseBarH = Math.max(60, Math.round(sw * 0.15));
  const baseFontSize = Math.round(baseBarH * 0.45);
  const lineH = baseFontSize * 1.3;
  const padX = Math.round(outputW * 0.04);
  const usableW = outputW - padX * 2;

  // Count wrapped lines for each user-entered line
  let totalLines = 0;
  if (state.text.trim()) {
    const userLines = state.text.split('\n');
    userLines.forEach(line => {
      if (!line) { totalLines += 1; return; }
      // Measure with a temp canvas
      const tmp = document.createElement('canvas').getContext('2d');
      tmp.font = `400 ${baseFontSize}px "Noto Sans SC", sans-serif`;
      const measured = tmp.measureText(line);
      const wrapCount = Math.max(1, Math.ceil(measured.width / usableW));
      totalLines += wrapCount;
    });
  }
  totalLines = Math.min(totalLines, 3);

  const textBarH = totalLines > 0
    ? Math.max(baseBarH, Math.round(totalLines * lineH + lineH * 0.4))
    : baseBarH;

  // Create final canvas
  const canvas = document.createElement('canvas');
  canvas.width = outputW;
  canvas.height = sh + textBarH;
  const ctx = canvas.getContext('2d');

  // Draw image (pixelated)
  ctx.imageSmoothingEnabled = false;
  pixelateAndDraw(ctx, img, sx, sy, sw, sh, 0, state.layout === 'top' ? textBarH : 0, outputW, sh);

  // Draw text bar
  const barY = state.layout === 'top' ? 0 : sh;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, barY, outputW, textBarH);

  // Draw text (pixelated effect via low-res rendering)
  if (state.text.trim()) {
    drawPixelatedText(ctx, state.text, outputW, barY, textBarH);
  }

  return canvas;
}

// ===== Pixelation =====
function pixelateAndDraw(ctx, img, sx, sy, sw, sh, dx, dy, dw, dh) {
  const level = state.pixelateLevel;
  if (level <= 1) {
    ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
    return;
  }

  // Draw to a small canvas first, then scale up
  const smallW = Math.max(1, Math.round(sw / level));
  const smallH = Math.max(1, Math.round(sh / level));

  const tmpCanvas = document.createElement('canvas');
  tmpCanvas.width = smallW;
  tmpCanvas.height = smallH;
  const tmpCtx = tmpCanvas.getContext('2d');
  tmpCtx.imageSmoothingEnabled = true;
  tmpCtx.drawImage(img, sx, sy, sw, sh, 0, 0, smallW, smallH);

  // Scale back up with no smoothing
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tmpCanvas, 0, 0, smallW, smallH, dx, dy, dw, dh);
  ctx.imageSmoothingEnabled = true;
}

// ===== Pixelated text =====
function drawPixelatedText(ctx, text, canvasW, barY, barH) {
  const level = Math.max(1, Math.round(state.pixelateLevel / 2));

  // Calculate font size relative to bar height
  const baseBarH = Math.max(60, Math.round(canvasW * 0.15));
  const fontSize = Math.round(baseBarH * 0.45);

  // Create a temporary canvas at low resolution
  const tmpW = Math.max(1, Math.round(canvasW / level));
  const tmpH = Math.max(1, Math.round(barH / level));
  const tmpCanvas = document.createElement('canvas');
  tmpCanvas.width = tmpW;
  tmpCanvas.height = tmpH;
  const tmpCtx = tmpCanvas.getContext('2d');

  // Draw text at low res
  tmpCtx.fillStyle = '#1a1a2e';
  tmpCtx.textAlign = 'left';
  tmpCtx.textBaseline = 'middle';

  const smallFont = Math.max(1, Math.round(fontSize / level));
  tmpCtx.font = `400 ${smallFont}px "Noto Sans SC", sans-serif`;

  // Left padding
  const padX = Math.round(canvasW * 0.04);
  const smallPadX = Math.round(padX / level);
  const usableW = tmpW - smallPadX * 2;

  // Wrap lines and cap at 3
  const wrappedLines = [];
  const userLines = text.split('\n');
  for (const line of userLines) {
    if (!line) { wrappedLines.push(''); continue; }
    let remaining = line;
    while (remaining.length > 0) {
      // Find how many chars fit
      let fitLen = remaining.length;
      for (let i = 1; i <= remaining.length; i++) {
        if (tmpCtx.measureText(remaining.slice(0, i)).width > usableW) {
          fitLen = i - 1;
          break;
        }
      }
      if (fitLen <= 0) fitLen = 1;
      wrappedLines.push(remaining.slice(0, fitLen));
      remaining = remaining.slice(fitLen);
      if (wrappedLines.length >= 3) break;
    }
    if (wrappedLines.length >= 3) break;
  }

  const lineH = smallFont * 1.3;
  const totalH = wrappedLines.length * lineH;
  const startY = (tmpH - totalH) / 2 + lineH / 2;

  wrappedLines.forEach((line, i) => {
    tmpCtx.fillText(line, smallPadX, startY + i * lineH);
  });

  // Scale up to final canvas with no smoothing
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tmpCanvas, 0, 0, tmpW, tmpH, 0, barY, canvasW, barH);
  ctx.imageSmoothingEnabled = true;
}

// ===== Crop overlay =====
let cropState = {
  imgW: 0, imgH: 0,      // displayed image size on crop canvas
  offsetX: 0, offsetY: 0,  // image offset in viewport
  selX: 0, selY: 0, selW: 0, selH: 0, // selection in display coords
  dragging: false,
  resizing: null,          // handle name or null
  startX: 0, startY: 0,
  startSel: null,
};

function openCropOverlay() {
  if (!state.originalImage) return;

  cropOverlay.style.display = 'flex';

  const img = state.originalImage;
  const maxW = window.innerWidth * 0.9;
  const maxH = window.innerHeight * 0.8;
  const scale = Math.min(maxW / img.width, maxH / img.height, 1);

  const dw = Math.round(img.width * scale);
  const dh = Math.round(img.height * scale);

  cropCanvas.width = dw;
  cropCanvas.height = dh;
  cropCtx.imageSmoothingEnabled = true;
  cropCtx.drawImage(img, 0, 0, dw, dh);

  cropState.imgW = dw;
  cropState.imgH = dh;
  cropState.offsetX = 0;
  cropState.offsetY = 0;

  // Parse ratio
  let ratio = null;
  if (state.cropRatio !== 'free') {
    const parts = state.cropRatio.split(':');
    ratio = parseInt(parts[0]) / parseInt(parts[1]);
  }

  // Initial selection: centered, 80% of smaller dimension
  if (ratio) {
    if (ratio > dw / dh) {
      cropState.selW = dw * 0.8;
      cropState.selH = cropState.selW / ratio;
    } else {
      cropState.selH = dh * 0.8;
      cropState.selW = cropState.selH * ratio;
    }
  } else {
    cropState.selW = dw * 0.8;
    cropState.selH = dh * 0.8;
  }
  cropState.selX = (dw - cropState.selW) / 2;
  cropState.selY = (dh - cropState.selH) / 2;

  updateCropSelection();
}

function updateCropSelection() {
  const s = cropState;
  cropSelection.style.left = s.selX + 'px';
  cropSelection.style.top = s.selY + 'px';
  cropSelection.style.width = s.selW + 'px';
  cropSelection.style.height = s.selH + 'px';
}

// Crop selection dragging
cropSelection.addEventListener('mousedown', (e) => {
  if (e.target.classList.contains('crop-handle')) return;
  e.preventDefault();
  cropState.dragging = true;
  cropState.startX = e.clientX;
  cropState.startY = e.clientY;
  cropState.startSel = { x: cropState.selX, y: cropState.selY };
});

// Crop handle resizing
document.querySelectorAll('.crop-handle').forEach(handle => {
  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    cropState.resizing = handle.dataset.handle;
    cropState.startX = e.clientX;
    cropState.startY = e.clientY;
    cropState.startSel = {
      x: cropState.selX, y: cropState.selY,
      w: cropState.selW, h: cropState.selH
    };
  });
});

window.addEventListener('mousemove', (e) => {
  if (cropState.dragging) {
    const dx = e.clientX - cropState.startX;
    const dy = e.clientY - cropState.startY;
    cropState.selX = Math.max(0, Math.min(cropState.imgW - cropState.selW, cropState.startSel.x + dx));
    cropState.selY = Math.max(0, Math.min(cropState.imgH - cropState.selH, cropState.startSel.y + dy));
    updateCropSelection();
  } else if (cropState.resizing) {
    const dx = e.clientX - cropState.startX;
    const dy = e.clientY - cropState.startY;
    const s = cropState.startSel;
    const ratio = state.cropRatio !== 'free'
      ? parseInt(state.cropRatio.split(':')[0]) / parseInt(state.cropRatio.split(':')[1])
      : null;

    let newX = s.x, newY = s.y, newW = s.w, newH = s.h;

    if (cropState.resizing === 'br') {
      newW = Math.max(20, s.w + dx);
      newH = ratio ? newW / ratio : Math.max(20, s.h + dy);
    } else if (cropState.resizing === 'bl') {
      newW = Math.max(20, s.w - dx);
      newH = ratio ? newW / ratio : Math.max(20, s.h + dy);
      newX = s.x + s.w - newW;
    } else if (cropState.resizing === 'tr') {
      newW = Math.max(20, s.w + dx);
      newH = ratio ? newW / ratio : Math.max(20, s.h - dy);
      newY = s.y + s.h - newH;
    } else if (cropState.resizing === 'tl') {
      newW = Math.max(20, s.w - dx);
      newH = ratio ? newW / ratio : Math.max(20, s.h - dy);
      newX = s.x + s.w - newW;
      newY = s.y + s.h - newH;
    }

    // Clamp
    newX = Math.max(0, newX);
    newY = Math.max(0, newY);
    newW = Math.min(newW, cropState.imgW - newX);
    newH = Math.min(newH, cropState.imgH - newY);

    cropState.selX = newX;
    cropState.selY = newY;
    cropState.selW = newW;
    cropState.selH = newH;
    updateCropSelection();
  }
});

window.addEventListener('mouseup', () => {
  cropState.dragging = false;
  cropState.resizing = null;
});

// Crop confirm
cropConfirmBtn.addEventListener('click', () => {
  if (!state.originalImage) return;

  const img = state.originalImage;
  const scale = cropState.imgW / img.width;

  state.cropRect = {
    x: Math.round(cropState.selX / scale),
    y: Math.round(cropState.selY / scale),
    w: Math.round(cropState.selW / scale),
    h: Math.round(cropState.selH / scale),
  };

  cropOverlay.style.display = 'none';
  render();
});

// Crop cancel
cropCancelBtn.addEventListener('click', () => {
  cropOverlay.style.display = 'none';
  state.cropRatio = 'free';
  document.querySelectorAll('.crop-btn').forEach(b => b.classList.remove('active'));
  document.querySelector('.crop-btn[data-ratio="free"]').classList.add('active');
});

// ===== Window resize =====
window.addEventListener('resize', () => {
  if (state.originalImage) render();
});

// ===== Load test image =====
function loadTestImage() {
  const img = new Image();
  img.onload = () => {
    state.originalImage = img;
    state.text = '我思故我在';
    textInput.value = state.text;
    render();
  };
  img.src = 'meme1.png';
}

// Auto-load test image on start
loadTestImage();
