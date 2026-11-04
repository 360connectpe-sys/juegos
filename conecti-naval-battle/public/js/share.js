/* Imagen del resultado (1080 × 1350) para compartir en historias o por WhatsApp. */
(function (root) {
  const C = root.CNB, R = root.RENDERER;
  function texto(c, t, x, y, tam, color, alin = 'center', fuente = '"Press Start 2P"') {
    c.font = `${tam}px ${/[ÁÉÍÓÚÑ]/.test(t) && fuente.includes('Press') ? '"VT323"' : fuente}, monospace`;
    c.textAlign = alin; c.textBaseline = 'top';
    c.fillStyle = '#000'; c.fillText(t, x + tam / 8, y + tam / 8);
    c.fillStyle = color; c.fillText(t, x, y);
  }
  /** Devuelve un Blob PNG con el resultado. d = { titulo, ganador, perdedor, rondas, hp:[a,b], nombres:[a,b], colores:[a,b], ganadorSlot, negocio, premio, enlace } */
  function imagen(d) {
    const cv = document.createElement('canvas'); cv.width = 1080; cv.height = 1350;
    const c = cv.getContext('2d'); c.imageSmoothingEnabled = false;
    const g = c.createLinearGradient(0, 0, 0, 1350); g.addColorStop(0, '#0C2E66'); g.addColorStop(1, '#07173A');
    c.fillStyle = g; c.fillRect(0, 0, 1080, 1350);
    for (let y = 0; y < 1350; y += 16) { c.fillStyle = 'rgba(255,255,255,.03)'; c.fillRect(0, y, 1080, 2); }
    texto(c, 'CONECTI', 540, 70, 64, '#FFFFFF');
    texto(c, 'NAVAL BATTLE', 540, 160, 36, '#1FA4F5');
    texto(c, d.titulo, 540, 270, d.titulo.length > 14 ? 40 : 52, '#FFD84A');
    // Los dos capitanes
    d.nombres.forEach((n, i) => {
      const x = i ? 780 : 300, gana = d.ganadorSlot === i, empate = d.ganadorSlot === null;
      const spr = R.conectiSprite(gana ? 'cheer' : empate ? 'idle' : 'sad', d.colores[i], i === 1);
      c.fillStyle = '#9CC9FF'; c.fillRect(x - 130, 400, 260, 300);
      c.strokeStyle = gana ? '#FFD84A' : '#0F1B3D'; c.lineWidth = 12; c.strokeRect(x - 130, 400, 260, 300);
      c.drawImage(spr, x - spr.width * 7, 430, spr.width * 14, spr.height * 14);
      texto(c, n, x, 730, 30, gana ? '#FFD84A' : '#FFFFFF');
      texto(c, `${d.hp[i]} HP`, x, 780, 40, '#E9F6FF', 'center', '"VT323"');
      if (gana) texto(c, '★ GANADOR ★', x, 830, 24, '#FFD84A');
    });
    texto(c, 'VS', 540, 520, 56, '#FFD84A');
    texto(c, `Batalla de ${d.rondas} ronda${d.rondas === 1 ? '' : 's'}`, 540, 900, 46, '#E9F6FF', 'center', '"VT323"');
    if (d.negocio) texto(c, d.negocio, 540, 960, 40, '#FFFFFF', 'center', '"VT323"');
    if (d.premio && d.ganadorSlot !== null) texto(c, `Premio: ${d.premio}`, 540, 1010, 40, '#FFD84A', 'center', '"VT323"');
    // Pie de marca
    c.fillStyle = '#0F1B3D'; c.fillRect(0, 1110, 1080, 240);
    c.fillStyle = '#1FA4F5'; c.fillRect(0, 1110, 1080, 8);
    texto(c, '¿Me ganas? Juega aquí:', 540, 1140, 42, '#E9F6FF', 'center', '"VT323"');
    texto(c, d.enlace.replace(/^https?:\/\//, ''), 540, 1192, d.enlace.length > 48 ? 18 : 22, '#FFD84A');
    c.fillStyle = '#25D366'; c.fillRect(250, 1250, 580, 64);
    texto(c, 'WHATSAPP 974 337 299', 540, 1270, 24, '#05341A');
    return new Promise(res => cv.toBlob(b => res(b), 'image/png'));
  }
  async function compartir(d) {
    const blob = await imagen(d);
    const archivo = new File([blob], 'conecti-naval-battle.png', { type: 'image/png' });
    const texto = `${d.titulo} en CONECTI NAVAL BATTLE ⚓ ¿Me ganas? ${d.enlace}`;
    try {
      if (navigator.canShare && navigator.canShare({ files: [archivo] })) { await navigator.share({ files: [archivo], text: texto }); return 'compartido'; }
    } catch (e) { if (e && e.name === 'AbortError') return 'cancelado'; }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'conecti-naval-battle.png';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    return 'descargado';
  }
  root.SHARE = { imagen, compartir };
})(window);
