// ========== 1. SIDEBAR MENU (active highlight) ==========
const menuLinks = document.querySelectorAll('#menu a');
menuLinks.forEach(link => {
  link.addEventListener('click', () => {
    menuLinks.forEach(l => l.classList.remove('active'));
    link.classList.add('active');
  });
});

// ========== 2. THEME TOGGLE (sun / moon) ==========
const themeBtn = document.getElementById('theme');
themeBtn.addEventListener('click', () => {
  document.body.classList.toggle('light');
  themeBtn.textContent = document.body.classList.contains('light') ? '🌙' : '☀️';
});

// ========== 3. SALES OVERVIEW CHART ==========
const canvas = document.getElementById('salesChart');
const ctx = canvas.getContext('2d');
const tooltip = document.querySelector('.tooltip');

// day of month, sales in thousands
const data = [
  { day: 1,  val: 30 },
  { day: 4,  val: 45 },
  { day: 8,  val: 29 },
  { day: 11, val: 38 },
  { day: 15, val: 46 },
  { day: 18, val: 56.23 },
  { day: 21, val: 44 },
  { day: 24, val: 52 },
  { day: 27, val: 58 },
  { day: 30, val: 70 }
];

const MAX = 80;           // y-axis max (80k)
const PAD = { l: 38, r: 12, t: 10, b: 8 };
let points = [];
let activeIndex = 5;      // 18 Nov by default

function setupCanvas() {
  const ratio = window.devicePixelRatio || 1;
  const w = canvas.parentElement.clientWidth;
  const h = canvas.parentElement.clientHeight;
  canvas.width = w * ratio;
  canvas.height = h * ratio;
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { w, h };
}

function drawChart() {
  const { w, h } = setupCanvas();
  const cw = w - PAD.l - PAD.r;
  const ch = h - PAD.t - PAD.b;
  ctx.clearRect(0, 0, w, h);

  // grid + y labels
  ctx.font = '12px system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let v = 0; v <= MAX; v += 20) {
    const y = PAD.t + ch - (v / MAX) * ch;
    ctx.strokeStyle = '#e6eaf5';
    ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(w - PAD.r, y); ctx.stroke();
    ctx.fillStyle = '#6b7a99';
    ctx.fillText(v === 0 ? '0' : v + 'k', PAD.l - 6, y);
  }

  // points
  points = data.map(d => ({
    x: PAD.l + ((d.day - 1) / 29) * cw,
    y: PAD.t + ch - (d.val / MAX) * ch,
    ...d
  }));

  // gradient fill
  const grad = ctx.createLinearGradient(0, PAD.t, 0, PAD.t + ch);
  grad.addColorStop(0, 'rgba(47,107,255,0.30)');
  grad.addColorStop(1, 'rgba(47,107,255,0)');
  ctx.beginPath();
  ctx.moveTo(points[0].x, PAD.t + ch);
  points.forEach(p => ctx.lineTo(p.x, p.y));
  ctx.lineTo(points[points.length - 1].x, PAD.t + ch);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // line
  ctx.beginPath();
  points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.strokeStyle = '#2f6bff';
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.stroke();

  // dots
  points.forEach((p, i) => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, i === activeIndex ? 7 : 5, 0, Math.PI * 2);
    ctx.fillStyle = '#2f6bff';
    ctx.fill();
    if (i === activeIndex) {
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#fff';
      ctx.stroke();
    }
  });

  showTooltip();
}

function showTooltip() {
  const p = points[activeIndex];
  const val = Math.round(p.val * 1000).toLocaleString('en-IN');
  tooltip.innerHTML = '₹' + val + '<br><small>' + p.day + ' Nov</small>';
  tooltip.style.left = p.x + 'px';
  tooltip.style.top = (p.y - 14) + 'px';
  tooltip.style.transform = 'translate(-50%, -100%)';
}

// hover / touch: nearest point
function moveToNearest(clientX) {
  const rect = canvas.getBoundingClientRect();
  const x = clientX - rect.left;
  let best = 0, bestDist = Infinity;
  points.forEach((p, i) => {
    const d = Math.abs(p.x - x);
    if (d < bestDist) { bestDist = d; best = i; }
  });
  if (best !== activeIndex) {
    activeIndex = best;
    drawChart();
  }
}
canvas.addEventListener('mousemove', e => moveToNearest(e.clientX));
canvas.addEventListener('touchmove', e => moveToNearest(e.touches[0].clientX), { passive: true });

// dropdown: Last 30 Days / Last 7 Days
document.querySelector('.sales select').addEventListener('change', e => {
  const last7 = e.target.value === 'Last 7 Days';
  const factor = last7 ? 0.6 : 1;
  const base = [30, 45, 29, 38, 46, 56.23, 44, 52, 58, 70];
  data.forEach((d, i) => (d.val = i === 5 ? 56.23 : base[i] * factor));
  drawChart();
});

window.addEventListener('resize', drawChart);
drawChart();

// ========== 4. STOREFRONT: CART ==========
const cartBadge = document.querySelector('.cart .badge');
let cartCount = parseInt(cartBadge.textContent, 10) || 0;

document.querySelectorAll('.product button').forEach(btn => {
  btn.addEventListener('click', () => {
    cartCount++;
    cartBadge.textContent = cartCount;
    btn.textContent = 'Added ✓';
    setTimeout(() => (btn.textContent = 'Add to Cart'), 1200);
  });
});

// ========== 5. STOREFRONT: HEART (wishlist) ==========
document.querySelectorAll('.heart').forEach(h => {
  h.style.cursor = 'pointer';
  h.addEventListener('click', () => {
    const on = h.textContent === '♥';
    h.textContent = on ? '♡' : '♥';
  });
});

// ========== 6. STOREFRONT: CATEGORIES (active) ==========
document.querySelectorAll('.categories div').forEach(cat => {
  cat.style.cursor = 'pointer';
  cat.addEventListener('click', () => {
    document.querySelectorAll('.categories span').forEach(s => (s.style.outline = 'none'));
    cat.querySelector('span').style.outline = '3px solid #2f6bff';
  });
});

// ========== 7. TRACK ORDER ==========
const trackInput = document.querySelector('.track-form input');
const trackBtn = document.querySelector('.track-form button');

trackBtn.addEventListener('click', () => {
  const id = trackInput.value.trim();
  if (!id) {
    alert('Please enter your Order ID');
    return;
  }
  alert('Tracking order ' + id + ' ...');
});
trackInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') trackBtn.click();
});

// ========== 8. WHATSAPP BUTTON ==========
document.querySelector('.whatsapp').addEventListener('click', () => {
  // apna number yahan daalo (country code ke saath, bina +)
  window.open('https://wa.me/91XXXXXXXXXX', '_blank');
});

// ========== 9. SHOP NOW / UPGRADE buttons ==========
document.querySelector('.premium button').addEventListener('click', () => {
  alert('Premium Plan: ₹99/month');
});
