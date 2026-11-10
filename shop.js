/* ShopKart - Customer shop (link se khulti hai) */
(function () {
  'use strict';

  const cfg = window.SHOPKART_CONFIG || {};
  const $ = (s, r = document) => r.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const inr = n => '₹' + Number(n || 0).toLocaleString('en-IN');
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const fmtDay = d => d.getDate() + ' ' + MONTHS[d.getMonth()];
  const STATUS = { new: 'Order mil gaya', processing: 'Taiyaar ho raha hai', shipped: 'Bhej diya gaya', delivered: 'Deliver ho gaya', cancelled: 'Cancel ho gaya' };

  let sb = null, shop = null, products = [];
  let cat = 'all', q = '';
  let cur = null, qty = 1, loc = null;

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => t.classList.remove('show'), 3200);
  }
  function state(msg) {
    const s = $('#state');
    s.innerHTML = msg;
    s.classList.remove('hidden');
    $('#shop').classList.add('hidden');
  }
  function getSlug() {
    const parts = location.pathname.split('/').filter(Boolean);
    if (parts[0] === 's' && parts[1]) return decodeURIComponent(parts[1]);
    return new URLSearchParams(location.search).get('s') || '';
  }
  function days(p) {
    const min = p && p.delivery_min != null ? p.delivery_min : shop.delivery_min;
    const max = p && p.delivery_max != null ? p.delivery_max : shop.delivery_max;
    return { min, max };
  }
  function delivText(p) {
    const d = days(p);
    return d.min === d.max ? d.max + ' din mein delivery' : d.min + ' se ' + d.max + ' din mein delivery';
  }
  function delivDate(p) {
    const d = days(p);
    const a = new Date(), b = new Date();
    a.setDate(a.getDate() + d.min); b.setDate(b.getDate() + d.max);
    return d.min === d.max ? fmtDay(b) : fmtDay(a) + ' se ' + fmtDay(b);
  }

  // ---------- start ----------
  async function init() {
    if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY || !window.supabase) {
      state('Setup baaki hai. config.js mein Supabase ki details daalo.');
      return;
    }
    const slug = getSlug();
    if (!slug) { state('Shop ka link sahi nahi hai.<br>Owner se poora link maango.'); return; }
    sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

    const s = await sb.from('shops').select('*').eq('slug', slug).maybeSingle();
    if (s.error) { state('Shop abhi khul nahi paa rahi. Thodi der baad try karo.'); return; }
    if (!s.data) { state('Ye shop nahi mili 😕<br>Link check karo.'); return; }
    shop = s.data;
    if (cfg.ENFORCE_PLAN && shop.plan_until && new Date(shop.plan_until) < new Date()) { state('Ye shop abhi band hai.<br>Thodi der baad dobara dekhna.'); return; }
    document.title = shop.name;
    $('#s-name').textContent = shop.name;
    $('#h-name').textContent = shop.name;
    $('#h-deliv').textContent = '🚚 ' + delivText(null);

    const p = await sb.from('products').select('*').eq('shop_id', shop.id).eq('active', true).order('created_at', { ascending: false });
    products = p.error ? [] : (p.data || []);

    $('#state').classList.add('hidden');
    $('#shop').classList.remove('hidden');
    bind();
    render();
  }

  // ---------- products ----------
  function render() {
    const cats = Array.from(new Set(products.map(p => p.category).filter(Boolean)));
    $('#cats').innerHTML = cats.length
      ? ['all'].concat(cats).map(c => '<button class="cat' + (cat === c ? ' active' : '') + '" data-cat="' + esc(c) + '" type="button">' + (c === 'all' ? 'Sab' : esc(c)) + '</button>').join('')
      : '';
    const list = products.filter(p => (cat === 'all' || p.category === cat) &&
      (!q || p.name.toLowerCase().includes(q)));
    $('#products').innerHTML = list.length ? list.map(p => {
      const out = p.stock <= 0;
      return '<div class="product"><div class="p-img">' +
        (p.image_url ? '<img src="' + esc(p.image_url) + '" alt="' + esc(p.name) + '" loading="lazy">' : '🛍️') + '</div>' +
        '<div class="p-name">' + esc(p.name) + '</div>' +
        '<b class="p-price">' + inr(p.price) + '</b>' +
        '<small class="p-del">🚚 ' + esc(delivText(p)) + '</small>' +
        (!out && p.stock <= 5 ? '<small class="p-low">Sirf ' + p.stock + ' bache hain</small>' : '') +
        '<button class="obtn" data-order="' + esc(p.id) + '" type="button"' + (out ? ' disabled' : '') + '>' + (out ? 'Stock khatam' : 'Order Now') + '</button></div>';
    }).join('') : '<p class="empty">' + (products.length ? 'Koi product nahi mila.' : 'Is shop mein abhi koi product nahi hai.') + '</p>';
  }

  // ---------- order popup ----------
  function openModal(html) {
    const m = $('#modal');
    m.innerHTML = '<div class="modal-box">' + html + '</div>';
    m.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
  }
  function closeModal() {
    $('#modal').classList.add('hidden');
    $('#modal').innerHTML = '';
    document.body.style.overflow = '';
  }

  function orderModal(p) {
    cur = p; qty = 1; loc = null;
    const online = !!(shop.upi_id && shop.upi_id.trim());
    openModal(
      '<div class="mh"><h3>Order karo</h3><button class="x" data-close type="button">✕</button></div>' +
      '<div class="sum"><div class="p-img">' + (p.image_url ? '<img src="' + esc(p.image_url) + '" alt="">' : '🛍️') + '</div>' +
      '<div><b>' + esc(p.name) + '</b><span>' + inr(p.price) + '</span></div></div>' +
      '<div class="qtyrow"><span>Quantity</span><div class="stepper"><button type="button" id="q-minus">−</button><b id="q">1</b><button type="button" id="q-plus">+</button></div></div>' +
      '<form id="oform">' +
      '<label>Aapka naam</label><input name="name" autocomplete="name" required maxlength="80">' +
      '<label>Phone number</label><input name="phone" type="tel" inputmode="numeric" autocomplete="tel" placeholder="10 digit" required maxlength="14">' +
      '<label>Poora address (ghar no., gali, area)</label><textarea name="address" rows="3" autocomplete="street-address" required maxlength="300"></textarea>' +
      '<div class="two"><div><label>Sheher</label><input name="city" autocomplete="address-level2" maxlength="50"></div>' +
      '<div><label>Pincode</label><input name="pincode" inputmode="numeric" autocomplete="postal-code" maxlength="6"></div></div>' +
      '<button type="button" class="locbtn" id="locbtn">📍 Meri location use karo (optional)</button>' +
      '<label>Payment kaise karoge</label>' +
      '<label class="pay sel" id="pay-cod"><input type="radio" name="pay" value="cod" checked><div>💵 Cash on Delivery<small>Saaman milne par paise do</small></div></label>' +
      '<label class="pay' + (online ? '' : ' dis') + '" id="pay-online"><input type="radio" name="pay" value="online"' + (online ? '' : ' disabled') + '><div>💳 Online Payment (UPI)' +
      '<small>' + (online ? 'Order ke baad UPI se pay karo' : 'Is shop par abhi available nahi') + '</small></div></label>' +
      '<div class="dinfo">🚚 ' + esc(delivText(p)) + ' (lagbhag ' + esc(delivDate(p)) + ')</div>' +
      '<div class="totalrow"><span>Total</span><span id="total">' + inr(p.price) + '</span></div>' +
      '<button class="submit" type="submit">Order Place Karo</button></form>');

    const max = Math.min(p.stock, 20);
    const upd = () => { $('#q').textContent = qty; $('#total').textContent = inr(p.price * qty); };
    $('#q-minus').onclick = () => { if (qty > 1) { qty--; upd(); } };
    $('#q-plus').onclick = () => { if (qty < max) { qty++; upd(); } else toast('Itna stock nahi hai'); };
    $('#locbtn').onclick = getLocation;
    document.querySelectorAll('#oform input[name=pay]').forEach(r => r.addEventListener('change', () => {
      $('#pay-cod').classList.toggle('sel', r.value === 'cod' && r.checked);
      $('#pay-online').classList.toggle('sel', r.value === 'online' && r.checked);
    }));
    $('#oform').addEventListener('submit', e => { e.preventDefault(); placeOrder(e.target); });
  }

  function getLocation() {
    const b = $('#locbtn');
    if (!navigator.geolocation) { toast('Is phone mein location nahi mil sakti, address likh do'); return; }
    b.textContent = 'Location dhoondh rahe hain...';
    navigator.geolocation.getCurrentPosition(pos => {
      loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      b.textContent = '✅ Location mil gayi';
      b.classList.add('ok');
    }, () => {
      b.textContent = '📍 Meri location use karo (optional)';
      toast('Location nahi mili. Address likh do, wahi kaafi hai.');
    }, { enableHighAccuracy: true, timeout: 12000 });
  }

  async function placeOrder(form) {
    const f = form.elements;
    const phone = f.phone.value.replace(/\D/g, '').slice(-10);
    if (phone.length !== 10) { toast('Sahi 10 digit phone number daalo'); return; }
    const btn = $('.submit', form);
    btn.disabled = true; btn.textContent = 'Order ho raha hai...';
    const pay = form.querySelector('input[name=pay]:checked').value;
    const r = await sb.rpc('place_order', {
      p_product_id: cur.id, p_qty: qty, p_name: f.name.value.trim(), p_phone: phone,
      p_address: f.address.value.trim(), p_city: f.city.value.trim(), p_pincode: f.pincode.value.trim(),
      p_lat: loc ? loc.lat : null, p_lng: loc ? loc.lng : null, p_payment: pay
    });
    if (r.error) {
      btn.disabled = false; btn.textContent = 'Order Place Karo';
      toast(r.error.message || 'Order nahi ho paya, dobara try karo');
      return;
    }
    const o = r.data;
    cur.stock = Math.max(0, cur.stock - qty);
    render();
    success(o, { name: f.name.value.trim(), phone, address: f.address.value.trim(), city: f.city.value.trim(), pincode: f.pincode.value.trim(), pay });
  }

  function success(o, c) {
    saveOrder(o, c.phone);
    const lines = [
      '🛒 Naya Order #' + o.order_no,
      'Product: ' + o.product_name + ' × ' + o.qty,
      'Total: ' + inr(o.total),
      'Payment: ' + (c.pay === 'cod' ? 'Cash on Delivery' : 'Online (UPI)'),
      'Naam: ' + c.name,
      'Phone: ' + c.phone,
      'Address: ' + c.address + (c.city ? ', ' + c.city : '') + (c.pincode ? ' - ' + c.pincode : '')
    ];
    if (loc) lines.push('Location: https://www.google.com/maps?q=' + loc.lat + ',' + loc.lng);
    const wa = 'https://wa.me/' + encodeURIComponent(shop.whatsapp) + '?text=' + encodeURIComponent(lines.join('\n'));
    const upi = 'upi://pay?pa=' + encodeURIComponent(shop.upi_id || '') + '&pn=' + encodeURIComponent(shop.name) +
      '&am=' + encodeURIComponent(o.total) + '&cu=INR&tn=' + encodeURIComponent(o.order_no);

    openModal('<div class="done"><div class="tick">✅</div><h3>Order ho gaya!</h3>' +
      '<div class="ono">' + esc(o.order_no) + '</div>' +
      '<p>' + esc(o.product_name) + ' × ' + o.qty + ' · <b>' + inr(o.total) + '</b><br>' +
      '🚚 Delivery: <b>' + esc(delivDate(cur)) + '</b> tak</p>' +
      '<p>Order ID sambhal ke rakho, isse order track kar sakte ho.</p>' +
      (c.pay === 'online'
        ? '<a class="abtn upi" href="' + esc(upi) + '">💳 UPI se ' + inr(o.total) + ' pay karo</a>' +
          '<p>Pay karne ke baad owner payment confirm karenge.</p>' : '<p>Paise saaman milne par dena hain.</p>') +
      '<a class="abtn wa" href="' + esc(wa) + '" target="_blank" rel="noopener">💬 Order shop owner ko WhatsApp par bhejo</a>' +
      '<p>Upar wala button dabake "Send" dabao taaki owner ko turant pata chal jaye.</p>' +
      '<button class="abtn plain" data-close type="button">Aur shopping karo</button></div>');
  }

  // ---------- mere orders (is phone se kiye hue orders) ----------
  const KEY = () => 'sk-orders-' + shop.slug;
  function loadSaved() { try { return JSON.parse(localStorage.getItem(KEY()) || '[]'); } catch (e) { return []; } }
  function storeSaved(list) { try { localStorage.setItem(KEY(), JSON.stringify(list.slice(0, 30))); } catch (e) {} }
  function saveOrder(o, phone) {
    storeSaved([{ no: o.order_no, phone, at: Date.now() }].concat(loadSaved().filter(x => x.no !== o.order_no)));
    updateBadge();
  }
  function updateBadge() {
    const n = loadSaved().length, b = $('#my-count');
    b.textContent = n; b.classList.toggle('hidden', !n);
  }
  function orderCard(o) {
    return '<div class="oc"><div class="oc-top"><b>#' + esc(o.order_no) + '</b><span class="st ' + esc(o.status) + '">' + esc(STATUS[o.status] || o.status) + '</span></div>' +
      '<div>' + esc(o.product_name) + ' × ' + o.qty + ' · <b>' + inr(o.total) + '</b></div>' +
      '<small>' + (o.payment_method === 'cod' ? 'Cash on Delivery' : 'Online: ' + (o.payment_status === 'paid' ? 'Payment mil gaya' : 'Payment baaki')) +
      ' · ' + esc(fmtDay(new Date(o.created_at))) + '</small></div>';
  }
  async function openOrders() {
    openModal('<div class="mh"><h3>📦 Mere Orders</h3><button class="x" data-close type="button">✕</button></div>' +
      '<div id="mo-list"><p class="mo-note">Dhoondh rahe hain...</p></div>' +
      '<details class="mo-find"><summary>Purana order nahi dikh raha?</summary>' +
      '<input id="f-no" placeholder="Order ID (jaise ORD1A2B3C4)"><input id="f-ph" type="tel" inputmode="numeric" placeholder="Order mein daala phone number">' +
      '<button class="obtn" data-find type="button" style="width:100%">Order dhoondo</button><p id="f-msg" class="mo-note"></p></details>');
    const saved = loadSaved();
    const box = $('#mo-list');
    if (!saved.length) { box.innerHTML = '<p class="mo-note">Abhi tak is phone se koi order nahi kiya.<br>Order karne ke baad wo yahan dikhega.</p>'; return; }
    const res = await Promise.all(saved.map(x => sb.rpc('track_order', { p_order_no: x.no, p_phone: x.phone }).then(r => r.data || null, () => null)));
    const html = res.map((o, i) => o ? orderCard(o) :
      '<div class="oc"><div class="oc-top"><b>#' + esc(saved[i].no) + '</b></div><small>Abhi status nahi mil paya</small></div>').join('');
    if ($('#mo-list')) $('#mo-list').innerHTML = html;
  }
  async function findOrder() {
    const no = $('#f-no').value.trim(), ph = $('#f-ph').value.replace(/\D/g, '').slice(-10), msg = $('#f-msg');
    if (!no || ph.length !== 10) { msg.textContent = 'Order ID aur 10 digit phone number dono daalo'; return; }
    msg.textContent = 'Dhoondh rahe hain...';
    const r = await sb.rpc('track_order', { p_order_no: no, p_phone: ph });
    if (r.error) { msg.textContent = 'Abhi check nahi ho paya, dobara try karo.'; return; }
    if (!r.data) { msg.textContent = 'Is ID aur number se koi order nahi mila.'; return; }
    storeSaved([{ no: r.data.order_no, phone: ph, at: Date.now() }].concat(loadSaved().filter(x => x.no !== r.data.order_no)));
    updateBadge();
    openOrders();
  }

  function bind() {
    $('#s-search').addEventListener('input', e => { q = e.target.value.trim().toLowerCase(); render(); });
    $('#cats').addEventListener('click', e => {
      const b = e.target.closest('[data-cat]');
      if (b) { cat = b.dataset.cat; render(); }
    });
    $('#products').addEventListener('click', e => {
      const b = e.target.closest('[data-order]');
      if (!b) return;
      const p = products.find(x => x.id === b.dataset.order);
      if (p && p.stock > 0) orderModal(p);
    });
    $('#modal').addEventListener('click', e => {
      if (e.target.id === 'modal' || e.target.closest('[data-close]')) closeModal();
      else if (e.target.closest('[data-find]')) findOrder();
    });
    $('#myorders').addEventListener('click', openOrders);
    updateBadge();
  }

  init();
})();
        
