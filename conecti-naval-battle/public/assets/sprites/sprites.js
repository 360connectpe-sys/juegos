/*
 * Sprites en pixel art (mapas de caracteres). Son recursos REEMPLAZABLES:
 * cambia estos mapas o la paleta y todo el juego se actualiza.
 *
 *   B = color del Conecti elegido   D = sombra de ese color   W = pantalla   K = azul marino
 *   P = mejillas   Q = blanco del QR   H = manos/pies blancos   L = piernas   R = rojo   Y = amarillo
 *
 * Conecti está basado en la mascota oficial de 360 Connect (cuerpo de placa NFC, cara en
 * pantalla, código QR en el pecho y ondas NFC). Si la marca entrega un sprite oficial,
 * basta con reemplazar los mapas de CONECTI respetando el tamaño de 12 × 16.
 *
 * Íconos de TikTok e Instagram: versiones pixeladas solo de referencia. Su uso público o
 * comercial debe respetar las normas de marca de cada empresa; se pueden cambiar aquí.
 */
(function (root) {
  const cara = ['..BBBBBBBB..', '.BBBBBBBBBB.', '.BWWWWWWWWB.'];
  const ojos = ['.BWKWWWWKWB.', '.BWKKWWKKWB.', '.BPWWWWWWPB.'];
  const sonrisa = ['.BWWKWWKWWB.', '.BWWWKKWWWB.', '.BDDDDDDDDB.'];
  const qr = ['.BBBQKQKBBB.', '.BBBKQKQBBB.', '..DDDDDDDD..'];
  const pies = ['...L....L...', '...L....L...', '..HH....HH..'];

  const CONECTI = {
    idle:    [...cara, ...ojos, ...sonrisa, 'HBBBQQQQBBBH', ...qr, ...pies],
    idle2:   [...cara, ...ojos, ...sonrisa, '.BBBQQQQBBB.', 'HBBBQKQKBBBH', '.BBBKQKQBBB.', '..DDDDDDDD..', ...pies],
    // Señala hacia adelante (hacia el cañón)
    point:   [...cara, ...ojos, ...sonrisa, '.BBBQQQQBBBBBH', ...qr, ...pies],
    // Brazos arriba: celebra el disparo
    cheer:   ['H.BBBBBBBB.H', 'HBBBBBBBBBBH', '.BWWWWWWWWB.', ...ojos, '.BWKWWWWKWB.', '.BWWKKKKWWB.', '.BDDDDDDDDB.', '.BBBQQQQBBB.', ...qr, '..L......L..', '.HH......HH.', '............'],
    // Recibe daño: ojos en X
    hit:     [...cara, '.BKWKWWKWKB.', '.BWKWWWWKWB.', '.BKWKWWKWKB.', '.BWWWKKWWWB.', '.BWWWKKWWWB.', '.BDDDDDDDDB.', 'HBBBQQQQBBBH', ...qr, ...pies],
    // Tristeza
    sad:     [...cara, '.BWKWWWWKWB.', '.BWWKWWKWWB.', '.BPWWWWWWPB.', '.BWWWKKWWWB.', '.BWWKWWKWWB.', '.BDDDDDDDDB.', 'HBBBQQQQBBBH', ...qr, ...pies],
  };

  const ICONOS = {
    tiktok: {
      mapa: ['.KKKKKKKKKK.', 'KKKKKKKKKKKK', 'KKKKKWKKKKKK', 'KKKKKWWKKKKK', 'KKKKKWKWWKKK', 'KKKKKWKKKKKK',
             'KKKKKWKKKKKK', 'KKKCWWKKKKKK', 'KKCWWWRKKKKK', 'KKKCWWRKKKKK', 'KKKKKKKKKKKK', '.KKKKKKKKKK.'],
      paleta: { K: '#111111', W: '#FFFFFF', C: '#25F4EE', R: '#FE2C55' },
      estela: ['#25F4EE', '#FE2C55', '#FFFFFF'],
    },
    instagram: {
      mapa: ['.XXXXXXXXXX.', 'XXXXXXXXXXXX', 'XXWWWWWWWWXX', 'XXWXXXXXWWXX', 'XXWXXWWXXWXX', 'XXWXWXXWXWXX',
             'XXWXWXXWXWXX', 'XXWXXWWXXWXX', 'XXWXXXXXXWXX', 'XXWWWWWWWWXX', 'XXXXXXXXXXXX', '.XXXXXXXXXX.'],
      // Degradado diagonal amarillo → naranja → rosa → morado
      paleta: (c, x, y) => {
        if (c === 'W') return '#FFFFFF';
        const t = (x + (11 - y)) / 22;
        return t < 0.25 ? '#FEC053' : t < 0.45 ? '#FA7E1E' : t < 0.7 ? '#D62976' : '#962FBF';
      },
      estela: ['#FEC053', '#FA7E1E', '#D62976', '#962FBF'],
    },
  };

  // Bandera de 360 Connect para el mástil y la celebración
  const BANDERA = ['WWWWWWWWW', 'WCCCWWBBW', 'WWWCWWBWW', 'WCCCWWBBW', 'WWWCWWBWB', 'WCCCWWBBW', 'WWWWWWWWW'];

  root.SPRITES = { CONECTI, ICONOS, BANDERA };
})(window);
