/* ShopKart - Shop Owner Dashboard */
(function () {
  'use strict';

  const cfg = window.SHOPKART_CONFIG || {};
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const inr = n => '₹' + Number(n || 0).toLocaleString('en-IN');
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const fmtDay = d => d.getDate() + ' ' + MONTHS[d.getMonth()];
  const STATUS = { new: 'New', processing: 'Processing', shipped: 'Shipped', delivered: 'Delivered', cancelled: 'Cancelled' };

  let sb = null, user = null, shop = null;
  let products = [], orders = [];
  let range = 30, orderFilter = 'all', current = 'dashboard';
  let chan = null, poll = null;

  // ---------- chhote helpers ----------
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => t.classList.remove('show'), 3200);
  }
  function ago(iso) {
    const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (m < 1) return 'abhi';
    if (m < 60) return m + ' min pehle';
    const h = Math.floor(m / 60);
    if (h < 24) return h + ' ghante pehle';
    return fmtDay(new Date(iso));
  }
  function phoneNorm(v) {
    const d = String(v || '').replace(/\D/g, '');
    if (d.length === 10) return '91' + d;
    if (d.length === 12 && d.startsWith('91')) return d;
    return null;
  }
  function slugify(s) {
    return String(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '').slice(0, 30) || 'shop';
  }
  const shopUrl = () => location.origin + '/s/' + shop.slug;
  const prodById = id => products.find(p => p.id === id);
  const validOrders = () => orders.filter(o => o.status !== 'cancelled');
  function setBusy(form, on) {
    const b = $('button[type=submit]', form);
    if (!b) return;
    if (on) { b.dataset.t = b.textContent; b.textContent = 'Ruko...'; b.disabled = true; }
    else { b.textContent = b.dataset.t || b.textContent; b.disabled = false; }
  }
  function authMsg(text, ok) {
    const m = $('#auth-msg');
    if (!text) { m.classList.add('hidden'); return; }
    m.textContent = text;
    m.classList.toggle('ok', !!ok);
    m.classList.remove('hidden');
  }
  function niceError(e) {
    const m = (e && e.message) || 'Kuch galat ho gaya';
    if (/invalid login/i.test(m)) return 'Email ya password galat hai';
    if (/already registered|already been registered/i.test(m)) return 'Ye email pehle se registered hai, Login karo';
    if (/password/i.test(m) && /6/.test(m)) return 'Password kam se kam 6 akshar ka rakho';
    if (/failed to fetch|network/i.test(m)) return 'Internet check karo aur dobara try karo';
    return m;
  }
  function showScreen(name) {
    ['setup', 'auth', 'app'].forEach(id => $('#' + id).classList.toggle('hidden', id !== name));
  }
  function thumb(p) {
    return p && p.image_url ? '<img src="' + esc(p.image_url) + '" alt="" loading="lazy">' : '🛍️';
  }

  // ---------- start ----------
  async function init() {
    if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY || !window.supabase) { showScreen('setup'); return; }
    sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
    bind();
    try { if (localStorage.getItem('sk-light') === '1') { document.body.classList.add('light'); $('#theme').textContent = '🌙'; } } catch (e) {}
    const { data } = await sb.auth.getSession();
    if (data && data.session) { user = data.session.user; await boot(); }
    else showScreen('auth');
  }

  async function ensureShop() {
    const got = await sb.from('shops').select('*').eq('owner_id', user.id).maybeSingle();
    if (got.error) { console.error(got.error); return null; }
    if (got.data) return got.data;
    const m = user.user_metadata || {};
    const name = String(m.shop_name || '').trim();
    const wa = phoneNorm(m.whatsapp);
    if (!name || !wa) return null;
    for (let i = 0; i < 6; i++) {
      const slug = slugify(name) + (i ? '-' + Math.random().toString(36).slice(2, 6) : '');
      const r = await sb.from('shops').insert({ owner_id: user.id, name, whatsapp: wa, slug }).select().single();
      if (!r.error) return r.data;
      if (r.error.code !== '23505') { console.error(r.error); return null; }
    }
    return null;
  }

  async function boot() {
    showScreen('app');
    shop = await ensureShop();
    if (!shop) {
      await sb.auth.signOut();
      user = null;
      showScreen('auth');
      authMsg('Shop nahi ban payi. Setup check karo (schema.sql chala hai?) aur dobara try karo.');
      return;
    }
    $('#shopname').textContent = shop.name;
    await Promise.all([loadProducts(), loadOrders()]);
    renderAll();
    show('dashboard');
    subscribe();
  }

  async function loadProducts() {
    const r = await sb.from('products').select('*').eq('shop_id', shop.id).order('created_at', { ascending: false });
    if (!r.error) products = r.data || [];
  }
  async function loadOrders() {
    const r = await sb.from('orders').select('*').eq('shop_id', shop.id).order('created_at', { ascending: false }).limit(500);
    if (!r.error) orders = r.data || [];
  }

  function subscribe() {
    if (chan) sb.removeChannel(chan);
    chan = sb.channel('orders-' + shop.id)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders', filter: 'shop_id=eq.' + shop.id }, async payload => {
        if (!orders.some(o => o.id === payload.new.id)) orders.unshift(payload.new);
        await loadProducts();
        renderAll();
        if (navigator.vibrate) navigator.vibrate(200);
        toast('🛒 Naya order aaya: ' + payload.new.order_no);
      })
      .subscribe();
    clearInterval(poll);
    poll = setInterval(async () => {
      if (!shop || document.hidden) return;
      const before = orders.length;
      await Promise.all([loadOrders(), loadProducts()]);
      renderAll();
      if (orders.length > before) toast('🛒 Naya order aaya');
    }, 60000);
  }

  // ---------- views ----------
  function show(v) {
    current = v;
    $$('.view').forEach(x => x.classList.toggle('hidden', x.id !== 'view-' + v));
    $$('[data-view]').forEach(a => { if (a.classList.contains('more')) return; a.classList.toggle('active', a.dataset.view === v); });
    if (v === 'orders') markSeen();
    if (v === 'dashboard') requestAnimationFrame(drawChart);
    window.scrollTo(0, 0);
  }

  function renderAll() {
    renderBell(); renderLinks(); renderStats(); renderRecent(); renderTop(); renderLow();
    renderProducts(); renderOrders(); renderSettings();
    $('#hello').textContent = 'Namaste, ' + shop.name + ' 👋';
    if (current === 'dashboard') drawChart();
  }

  function renderLinks() {
    const html = '<div class="lb-text"><b>🔗 Aapki shop ka link</b><small>Ye link Instagram bio mein laga do</small></div>' +
      '<input readonly value="' + esc(shopUrl()) + '">' +
      '<button class="btn gold sm" data-act="copy-link" type="button">Copy</button>' +
      '<button class="btn ghost sm" data-act="open-shop" type="button">Shop dekho</button>';
    $('#linkbar-dash').innerHTML = html;
    $('#linkbar-prod').innerHTML = html;
  }

  function renderStats() {
    const v = validOrders();
    const sales = v.reduce((s, o) => s + Number(o.total || 0), 0);
    const customers = new Set(v.map(o => o.customer_phone)).size;
    $('#stats').innerHTML =
      '<div class="stat blue"><div class="ic">🛒</div><p>Total Sales</p><h3>' + inr(sales) + '</h3></div>' +
      '<div class="stat green"><div class="ic">🛍️</div><p>Total Orders</p><h3>' + v.length + '</h3></div>' +
      '<div class="stat purple"><div class="ic">👥</div><p>Customers</p><h3>' + customers + '</h3></div>' +
      '<div class="stat orange"><div class="ic">📦</div><p>Products</p><h3>' + products.length + '</h3></div>';
  }

  function renderRecent() {
    const list = orders.slice(0, 5);
    $('#recent-orders').innerHTML = list.length ? list.map(o =>
      '<div class="order"><span class="thumb">' + thumb(prodById(o.product_id)) + '</span>' +
      '<div><b>#' + esc(o.order_no) + '</b><small>' + esc(ago(o.created_at)) + '</small></div>' +
      '<span class="status ' + esc(o.status) + '">' + esc(STATUS[o.status] || o.status) + '</span></div>'
    ).join('') : '<p class="empty">Abhi koi order nahi aaya.<br>Shop ka link share karo.</p>';
  }

  function renderTop() {
    const agg = {};
    validOrders().forEach(o => {
      const k = o.product_id || o.product_name;
      agg[k] = agg[k] || { id: o.product_id, name: o.product_name, qty: 0, price: o.unit_price };
      agg[k].qty += o.qty;
    });
    const top = Object.values(agg).sort((a, b) => b.qty - a.qty).slice(0, 4);
    $('#top-products').innerHTML = top.length ? top.map(t =>
      '<div class="item"><span class="thumb">' + thumb(prodById(t.id)) + '</span>' +
      '<div><b>' + esc(t.name) + '</b><small>' + inr(t.price) + ' · ' + t.qty + ' sold</small></div></div>'
    ).join('') : '<p class="empty">Bikri shuru hone par yahan dikhega.</p>';
  }

  function renderLow() {
    const low = products.filter(p => p.active && p.stock <= 10).sort((a, b) => a.stock - b.stock).slice(0, 5);
    $('#low-stock').innerHTML = low.length ? low.map(p =>
      '<div class="item"><span class="thumb">' + thumb(p) + '</span>' +
      '<div><b>' + esc(p.name) + '</b><small class="red">' + (p.stock === 0 ? 'Stock khatam' : 'Only ' + p.stock + ' left') + '</small></div></div>'
    ).join('') : '<p class="empty">Sab products ka stock theek hai.</p>';
  }

  function renderProducts() {
    $('#products-grid').innerHTML = products.length ? products.map(p =>
      '<div class="pcard' + (p.active ? '' : ' off') + '">' +
      '<div class="pimg">' + thumb(p) + '</div>' +
      '<b>' + esc(p.name) + '</b>' +
      '<span class="price">' + inr(p.price) + '</span>' +
      '<small class="' + (p.stock <= 5 ? 'red' : '') + '">Stock: ' + p.stock + '</small>' +
      (p.active ? '' : '<span class="tag">Chhupa hua</span>') +
      '<div class="acts"><button class="btn ghost" data-act="edit-product" data-id="' + esc(p.id) + '" type="button">Edit</button>' +
      '<button class="btn danger" data-act="del-product" data-id="' + esc(p.id) + '" type="button">Delete</button></div></div>'
    ).join('') : '<div class="card" style="grid-column:1/-1"><p class="empty">Abhi koi product nahi hai.<br>Upar "＋ Product Add" dabao aur pehla product daalo.</p></div>';
  }

  function renderOrders() {
    const counts = { all: orders.length };
    Object.keys(STATUS).forEach(k => counts[k] = orders.filter(o => o.status === k).length);
    $('#order-chips').innerHTML = ['all'].concat(Object.keys(STATUS)).map(k =>
      '<button class="chip' + (orderFilter === k ? ' active' : '') + '" data-act="filter" data-filter="' + k + '" type="button">' +
      (k === 'all' ? 'All' : STATUS[k]) + ' (' + counts[k] + ')</button>').join('');

    const list = orders.filter(o => orderFilter === 'all' || o.status === orderFilter);
    $('#orders-list').innerHTML = list.length ? list.map(o => {
      const pay = o.payment_method === 'cod' ? '💵 Cash on Delivery'
        : '💳 Online (UPI) - ' + (o.payment_status === 'paid' ? '<b class="green">Paid ✓</b>' : '<b class="red">Payment baaki</b>');
      const map = o.lat != null && o.lng != null
        ? ' · <a href="https://www.google.com/maps?q=' + encodeURIComponent(o.lat + ',' + o.lng) + '" target="_blank" rel="noopener">Map dekho</a>' : '';
      return '<div class="ocard' + (o.seen ? '' : ' fresh') + '">' +
        '<div class="ohead"><b>#' + esc(o.order_no) + '</b><span class="status ' + esc(o.status) + '">' + esc(STATUS[o.status] || o.status) + '</span><small>' + esc(ago(o.created_at)) + '</small></div>' +
        '<div class="obody"><b>' + esc(o.product_name || 'Product') + ' × ' + o.qty + '</b> · ' + inr(o.total) + '<br>' + pay + '<br>' +
        '👤 ' + esc(o.customer_name) + ' · <a href="tel:' + esc(o.customer_phone) + '">' + esc(o.customer_phone) + '</a> · ' +
        '<a href="https://wa.me/91' + esc(o.customer_phone) + '" target="_blank" rel="noopener">WhatsApp</a><br>' +
        '📍 ' + esc(o.address) + (o.city ? ', ' + esc(o.city) : '') + (o.pincode ? ' - ' + esc(o.pincode) : '') + map + '</div>' +
        '<div class="oact"><select data-status-for="' + esc(o.id) + '">' +
        Object.keys(STATUS).map(k => '<option value="' + k + '"' + (o.status === k ? ' selected' : '') + '>' + STATUS[k] + '</option>').join('') + '</select>' +
        (o.payment_method === 'online' && o.payment_status !== 'paid'
          ? '<button class="btn gold sm" data-act="mark-paid" data-id="' + esc(o.id) + '" type="button">Payment mil gaya</button>' : '') +
        '</div></div>';
    }).join('') : '<div class="card"><p class="empty">Is section mein abhi koi order nahi.</p></div>';
  }

  function renderSettings() {
    const f = $('#form-settings');
    if (f.dataset.ready === shop.id + shop.name + shop.upi_id) return;
    f.name.value = shop.name;
    f.whatsapp.value = String(shop.whatsapp || '').replace(/^91/, '');
    f.upi_id.value = shop.upi_id || '';
    f.delivery_min.value = shop.delivery_min;
    f.delivery_max.value = shop.delivery_max;
    f.dataset.ready = shop.id + shop.name + shop.upi_id;
  }

  // ---------- bell / messages ----------
  function renderBell() {
    const n = orders.filter(o => !o.seen).length;
    const b = $('#bell-badge'), p = $('#orders-pill');
    b.textContent = n; b.classList.toggle('hidden', !n);
    p.textContent = n; p.classList.toggle('hidden', !n);
  }
  async function markSeen() {
    const ids = orders.filter(o => !o.seen).map(o => o.id);
    if (!ids.length) return;
    const r = await sb.from('orders').update({ seen: true }).in('id', ids);
    if (!r.error) { orders.forEach(o => { if (ids.includes(o.id)) o.seen = true; }); renderBell(); }
  }
  function openBell() {
    const list = orders.slice(0, 20);
    openModal('<div class="card-head"><h3>🔔 Messages</h3><button class="x" data-act="close" type="button">✕</button></div>' +
      (list.length ? list.map(o =>
        '<div class="bell-item' + (o.seen ? '' : ' fresh') + '" data-act="goto-orders">' +
        '<span>🛒</span><div><b>Naya order #' + esc(o.order_no) + '</b><br>' + esc(o.customer_name) + ' ne ' +
        esc(o.product_name || 'product') + ' × ' + o.qty + ' mangaya (' + inr(o.total) + ')<small>' + esc(ago(o.created_at)) + '</small></div></div>'
      ).join('') : '<p class="empty">Abhi koi message nahi.</p>'));
  }

  // ---------- modal ----------
  function openModal(html) {
    const m = $('#modal');
    m.innerHTML = '<div class="modal-box">' + html + '</div>';
    m.classList.remove('hidden');
  }
  function closeModal() { $('#modal').classList.add('hidden'); $('#modal').innerHTML = ''; }

  // ---------- products add / edit ----------
  function resizeImage(file, max) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const r = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * r); c.height = Math.round(img.height * r);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        c.toBlob(b => b ? resolve(b) : reject(new Error('Photo process nahi hui')), 'image/jpeg', 0.82);
      };
      img.onerror = () => reject(new Error('Ye photo khul nahi payi'));
      img.src = url;
    });
  }

  function productModal(p) {
    const cats = Array.from(new Set(products.map(x => x.category).filter(Boolean)));
    openModal(
      '<div class="card-head"><h3>' + (p ? 'Product edit karo' : 'Naya product') + '</h3><button class="x" data-act="close" type="button">✕</button></div>' +
      '<form id="form-product" data-id="' + esc(p ? p.id : '') + '">' +
      '<label>Photo</label><div class="imgpick"><div class="pv" id="pv">' + thumb(p) + '</div>' +
      '<input type="file" name="image" accept="image/*"></div>' +
      '<label>Product ka naam</label><input name="name" required maxlength="80" value="' + esc(p ? p.name : '') + '">' +
      '<div class="two-col"><div><label>Price (₹)</label><input name="price" type="number" inputmode="decimal" min="0" step="0.01" required value="' + esc(p ? p.price : '') + '"></div>' +
      '<div><label>Stock (kitne hain)</label><input name="stock" type="number" inputmode="numeric" min="0" step="1" required value="' + esc(p ? p.stock : '') + '"></div></div>' +
      '<label>Category (jaise Men, Shoes)</label><input name="category" list="cats" maxlength="30" value="' + esc(p ? p.category : '') + '">' +
      '<datalist id="cats">' + cats.map(c => '<option value="' + esc(c) + '">').join('') + '</datalist>' +
      '<label>Description (optional)</label><textarea name="description" rows="2" maxlength="300">' + esc(p ? p.description : '') + '</textarea>' +
      '<label>Is product ki delivery ke din (optional)</label>' +
      '<div class="two-col"><input name="delivery_min" type="number" min="0" max="60" placeholder="Min" value="' + esc(p && p.delivery_min != null ? p.delivery_min : '') + '">' +
      '<input name="delivery_max" type="number" min="0" max="60" placeholder="Max" value="' + esc(p && p.delivery_max != null ? p.delivery_max : '') + '"></div>' +
      '<small>Khali chhodo to shop ke din (' + shop.delivery_min + '-' + shop.delivery_max + ') lagenge.</small>' +
      '<label class="check"><input type="checkbox" name="active"' + (!p || p.active ? ' checked' : '') + '> Customer ko dikhao</label>' +
      '<button class="btn gold block" type="submit">Save karo</button></form>');
    const fi = $('#form-product input[type=file]');
    fi.addEventListener('change', () => {
      const f = fi.files[0];
      if (f) $('#pv').innerHTML = '<img src="' + URL.createObjectURL(f) + '" alt="">';
    });
  }

  async function saveProduct(form) {
    const f = form.elements;
    const id = form.dataset.id;
    const price = parseFloat(f.price.value), stock = parseInt(f.stock.value, 10);
    const dmin = f.delivery_min.value === '' ? null : parseInt(f.delivery_min.value, 10);
    const dmax = f.delivery_max.value === '' ? null : parseInt(f.delivery_max.value, 10);
    if (!(price >= 0) || !(stock >= 0)) { toast('Price aur stock sahi daalo'); return; }
    if ((dmin == null) !== (dmax == null)) { toast('Delivery ke Min aur Max dono daalo ya dono khali chhodo'); return; }
    if (dmin != null && dmin > dmax) { toast('Delivery ka Min, Max se zyada nahi ho sakta'); return; }
    setBusy(form, true);
    try {
      const payload = {
        name: f.name.value.trim(), price, stock,
        category: f.category.value.trim() || null,
        description: f.description.value.trim() || null,
        delivery_min: dmin, delivery_max: dmax,
        active: f.active.checked
      };
      const file = f.image.files[0];
      if (file) {
        const blob = await resizeImage(file, 900);
        const path = user.id + '/' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.jpg';
        const up = await sb.storage.from('product-images').upload(path, blob, { contentType: 'image/jpeg' });
        if (up.error) throw up.error;
        payload.image_url = sb.storage.from('product-images').getPublicUrl(path).data.publicUrl;
      }
      const r = id
        ? await sb.from('products').update(payload).eq('id', id)
        : await sb.from('products').insert(Object.assign({ shop_id: shop.id }, payload));
      if (r.error) throw r.error;
      await loadProducts();
      renderAll();
      closeModal();
      toast(id ? 'Product update ho gaya ✓' : 'Product add ho gaya ✓');
    } catch (e) {
      console.error(e);
      toast(niceError(e));
      setBusy(form, false);
    }
  }

  async function deleteProduct(id) {
    const p = prodById(id);
    if (!p || !confirm('"' + p.name + '" delete karna hai?')) return;
    const r = await sb.from('products').delete().eq('id', id);
    if (r.error) { toast(niceError(r.error)); return; }
    await loadProducts();
    renderAll();
    toast('Product delete ho gaya');
  }

  // ---------- orders actions ----------
  async function setStatus(id, status) {
    const r = await sb.from('orders').update({ status }).eq('id', id);
    if (r.error) { toast(niceError(r.error)); return; }
    await Promise.all([loadOrders(), loadProducts()]);
    renderAll();
    toast('Order status: ' + STATUS[status]);
  }
  async function markPaid(id) {
    const r = await sb.from('orders').update({ payment_status: 'paid' }).eq('id', id);
    if (r.error) { toast(niceError(r.error)); return; }
    const o = orders.find(x => x.id === id);
    if (o) o.payment_status = 'paid';
    renderOrders();
    toast('Payment paid mark ho gaya ✓');
  }

  // ---------- settings ----------
  async function saveSettings(form) {
    const f = form.elements;
    const wa = phoneNorm(f.whatsapp.value);
    const dmin = parseInt(f.delivery_min.value, 10), dmax = parseInt(f.delivery_max.value, 10);
    if (!wa) { toast('10 digit ka sahi WhatsApp number daalo'); return; }
    if (!(dmin >= 0) || !(dmax >= dmin)) { toast('Delivery ke din sahi daalo (Min <= Max)'); return; }
    setBusy(form, true);
    const payload = {
      name: f.name.value.trim(), whatsapp: wa, upi_id: f.upi_id.value.trim() || null,
      delivery_min: dmin, delivery_max: dmax
    };
    const r = await sb.from('shops').update(payload).eq('id', shop.id).select().single();
    setBusy(form, false);
    if (r.error) { toast(niceError(r.error)); return; }
    shop = r.data;
    $('#shopname').textContent = shop.name;
    renderAll();
    toast('Settings save ho gayi ✓');
  }

  // ---------- chart ----------
  let chartPts = [], activeIdx = -1, chartDays = [];
  function chartData() {
    const days = [];
    const today = new Date(); today.setHours(0, 0, 0, 0);
    for (let i = range - 1; i >= 0; i--) {
      const d = new Date(today); d.setDate(d.getDate() - i);
      days.push({ date: d, val: 0 });
    }
    validOrders().forEach(o => {
      const d = new Date(o.created_at); d.setHours(0, 0, 0, 0);
      const x = days.find(y => y.date.getTime() === d.getTime());
      if (x) x.val += Number(o.total || 0);
    });
    return days;
  }
  function axisLabel(v) { return v >= 1000 ? (Math.round(v / 100) / 10) + 'k' : String(Math.round(v)); }

  function drawChart() {
    const canvas = $('#salesChart');
    if (!canvas || $('#view-dashboard').classList.contains('hidden')) return;
    const box = canvas.parentElement;
    const w = box.clientWidth, h = box.clientHeight;
    if (w < 10) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = w * ratio; canvas.height = h * ratio;
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

    chartDays = chartData();
    const max = Math.max.apply(null, chartDays.map(d => d.val).concat([0]));
    const none = max === 0;
    $('#chart-empty').classList.toggle('hidden', !none);
    let top = 100;
    if (!none) {
      const mag = Math.pow(10, Math.floor(Math.log10(max)));
      top = [1, 2, 2.5, 5, 10].find(s => max / mag <= s) * mag;
    }
    const PAD = { l: 38, r: 12, t: 12, b: 8 };
    const cw = w - PAD.l - PAD.r, ch = h - PAD.t - PAD.b;
    ctx.clearRect(0, 0, w, h);
    ctx.font = '12px system-ui, sans-serif';
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let i = 0; i <= 4; i++) {
      const v = top * i / 4;
      const y = PAD.t + ch - (v / top) * ch;
      ctx.strokeStyle = '#e6eaf5';
      ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(w - PAD.r, y); ctx.stroke();
      ctx.fillStyle = '#6b7a99';
      ctx.fillText(axisLabel(v), PAD.l - 6, y);
    }
    const n = chartDays.length;
    chartPts = chartDays.map((d, i) => ({
      x: PAD.l + (n === 1 ? 0 : (i / (n - 1)) * cw),
      y: PAD.t + ch - (d.val / top) * ch, d
    }));
    if (activeIdx < 0 || activeIdx >= n) activeIdx = n - 1;

    const grad = ctx.createLinearGradient(0, PAD.t, 0, PAD.t + ch);
    grad.addColorStop(0, 'rgba(47,107,255,0.30)'); grad.addColorStop(1, 'rgba(47,107,255,0)');
    ctx.beginPath(); ctx.moveTo(chartPts[0].x, PAD.t + ch);
    chartPts.forEach(p => ctx.lineTo(p.x, p.y));
    ctx.lineTo(chartPts[n - 1].x, PAD.t + ch); ctx.closePath();
    ctx.fillStyle = grad; ctx.fill();

    ctx.beginPath();
    chartPts.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
    ctx.strokeStyle = '#2f6bff'; ctx.lineWidth = 3; ctx.lineJoin = 'round'; ctx.stroke();

    const a = chartPts[activeIdx];
    ctx.beginPath(); ctx.arc(a.x, a.y, 7, 0, Math.PI * 2);
    ctx.fillStyle = '#2f6bff'; ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = '#fff'; ctx.stroke();

    const tip = $('#tooltip');
    tip.innerHTML = inr(Math.round(a.d.val)) + '<br><small>' + fmtDay(a.d.date) + '</small>';
    tip.classList.toggle('hidden', none);
    const tw = tip.offsetWidth;
    tip.style.left = Math.min(Math.max(a.x - tw / 2, 0), w - tw) + 'px';
    tip.style.top = Math.max(a.y - 14 - tip.offsetHeight, 0) + 'px';

    const idxs = [0, 1, 2, 3, 4].map(i => Math.round(i * (n - 1) / 4));
    $('#x-axis').innerHTML = idxs.map(i => '<span>' + fmtDay(chartDays[i].date) + '</span>').join('');
  }
  function nearest(clientX) {
    const canvas = $('#salesChart');
    if (!chartPts.length) return;
    const x = clientX - canvas.getBoundingClientRect().left;
    let best = 0, dist = Infinity;
    chartPts.forEach((p, i) => { const d = Math.abs(p.x - x); if (d < dist) { dist = d; best = i; } });
    if (best !== activeIdx) { activeIdx = best; drawChart(); }
  }

  // ---------- events ----------
  function copyLink() {
    const url = shopUrl();
    const done = () => toast('Link copy ho gaya ✓ Ab Instagram bio mein paste karo');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done, () => fallbackCopy(url, done));
    } else fallbackCopy(url, done);
  }
  function fallbackCopy(text, done) {
    const t = document.createElement('textarea');
    t.value = text; t.style.position = 'fixed'; t.style.opacity = '0';
    document.body.appendChild(t); t.select();
    try { document.execCommand('copy'); done(); } catch (e) { toast('Link ko dabake pakdo aur copy karo'); }
    document.body.removeChild(t);
  }

  async function logout() {
    if (chan) { sb.removeChannel(chan); chan = null; }
    clearInterval(poll);
    await sb.auth.signOut();
    user = null; shop = null; products = []; orders = [];
    closeModal();
    showScreen('auth');
    authMsg('');
  }

  function bind() {
    // login / signup tabs
    $$('.tab').forEach(t => t.addEventListener('click', () => {
      $$('.tab').forEach(x => x.classList.toggle('active', x === t));
      $('#form-login').classList.toggle('hidden', t.dataset.tab !== 'login');
      $('#form-signup').classList.toggle('hidden', t.dataset.tab !== 'signup');
      authMsg('');
    }));

    $('#form-login').addEventListener('submit', async e => {
      e.preventDefault();
      const f = e.target; authMsg(''); setBusy(f, true);
      const r = await sb.auth.signInWithPassword({ email: f.email.value.trim(), password: f.password.value });
      setBusy(f, false);
      if (r.error) { authMsg(niceError(r.error)); return; }
      user = r.data.user;
      await boot();
    });

    $('#form-signup').addEventListener('submit', async e => {
      e.preventDefault();
      const f = e.target; authMsg('');
      const name = f.shop_name.value.trim();
      const wa = phoneNorm(f.whatsapp.value);
      if (name.length < 2) { authMsg('Shop ka naam daalo'); return; }
      if (!wa) { authMsg('10 digit ka sahi business number daalo'); return; }
      setBusy(f, true);
      const r = await sb.auth.signUp({
        email: f.email.value.trim(), password: f.password.value,
        options: { data: { shop_name: name, whatsapp: wa } }
      });
      setBusy(f, false);
      if (r.error) { authMsg(niceError(r.error)); return; }
      if (r.data.session) { user = r.data.user; await boot(); }
      else {
        $$('.tab')[0].click();
        authMsg('Account ban gaya! Email par confirmation link gaya hai. Use kholkar phir Login karo.', true);
      }
    });

    $('#form-settings').addEventListener('submit', e => { e.preventDefault(); saveSettings(e.target); });

    $('#theme').addEventListener('click', () => {
      const light = document.body.classList.toggle('light');
      $('#theme').textContent = light ? '🌙' : '☀️';
      try { localStorage.setItem('sk-light', light ? '1' : '0'); } catch (e) {}
    });

    $('#range').addEventListener('change', e => { range = parseInt(e.target.value, 10); activeIdx = -1; drawChart(); });
    const cv = $('#salesChart');
    cv.addEventListener('mousemove', e => nearest(e.clientX));
    cv.addEventListener('touchstart', e => nearest(e.touches[0].clientX), { passive: true });
    cv.addEventListener('touchmove', e => nearest(e.touches[0].clientX), { passive: true });
    window.addEventListener('resize', drawChart);

    document.addEventListener('submit', e => {
      if (e.target.id === 'form-product') { e.preventDefault(); saveProduct(e.target); }
    });

    document.addEventListener('change', e => {
      const id = e.target.dataset && e.target.dataset.statusFor;
      if (id) setStatus(id, e.target.value);
    });

    document.addEventListener('click', e => {
      if (e.target.id === 'modal') { closeModal(); return; }
      const v = e.target.closest('[data-view]');
      if (v) { show(v.dataset.view); return; }
      const a = e.target.closest('[data-act]');
      if (!a) return;
      const id = a.dataset.id;
      switch (a.dataset.act) {
        case 'copy-link': copyLink(); break;
        case 'open-shop': window.open(shopUrl(), '_blank'); break;
        case 'logout': logout(); break;
        case 'bell': openBell(); break;
        case 'goto-orders': closeModal(); show('orders'); break;
        case 'close': closeModal(); break;
        case 'add-product': productModal(null); break;
        case 'edit-product': productModal(prodById(id)); break;
        case 'del-product': deleteProduct(id); break;
        case 'mark-paid': markPaid(id); break;
        case 'filter': orderFilter = a.dataset.filter; renderOrders(); break;
      }
    });
  }

  init();
})();
