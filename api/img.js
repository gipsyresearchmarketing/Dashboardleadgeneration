/**
 * Vercel Serverless Function — serve gambar statis untuk email blast.
 *
 * Kenapa perlu: Gmail (dan sebagian besar email client) MEMBLOKIR <img src="data:...">.
 * Jadi logo header & icon footer harus punya URL publik.
 *
 * Query:
 *   ?p=instagram   -> icon platform bawaan (instagram|whatsapp|web|email|linkedin|facebook|tiktok|youtube|x)
 *   ?asset=AS-xxx  -> gambar dari Image Library (tabel assets, kolom url berisi data URL)
 *
 * Tanpa auth: memang harus bisa diakses email client (mesin). Isinya cuma logo & gambar brand.
 * Cache lama supaya gak membebani server.
 */
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ugxrtiitmqrfrdpmcxka.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';

const ICONS = {
  instagram: [
    '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'
  ].join(''),
  whatsapp: [
    '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',
    'AahqYyCllOFHAAAAAElFTkSuQmCC'
  ].join(''),
  web: [
    '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'
  ].join(''),
  email: [
    'iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAACXBIWXMAAAsTAAALEwEAmpwYAAAFCElEQVR4nO1Za2hcVRC+qe8XKr5rzD3nJjYafNQXaikU',
    'URBBpYpVqYrinyq+f/gArQEFFR+t6e7MZktDUas/orVq/SlorVSrYBUVCxJtbbVGscmd2cT46pXZPrh37rmbzWbTtbAD98/e2TPfd2bOzJy5nteUpjSlKbsl',
    'KI62GeB7LNJLBulLi7TNIo0aoL8s8O8WeKMFftsCPxnkabbXHU3zGi5R1OIDzTXAH1mgHRY5qvoB+tkgLQyK249sCPa2XOlcg/TphEC7n+0GS7fsPeRR1GKQ',
    'HjZAfzp29R/xhkFaZAq0wADfYAt8k0G+1wI/YZDftcglFxGD9Mp5xeiAqQXfHU2zyEvTxjk0QI+3FkZOHm+Jjp7oIB9LV1ig9x3rvNPVHx04ZfgNcF961/nN',
    'APn4WtYLkOcbZE6uSUumCvx9GnyA9IiE1GTW9bF0jpyD5KaEV9UPuRjJl2YapL9T4OskBkuXJ7IY8MY53dH+dTy0vFbtfv94f2vD4aN94Ess8jwB2FEcbq/k',
    'LYu8PHkeSrfWBb/N03XqoP3qLx46qlJIGODVFulfR6b50SB1dy777Qj9vxlFOtYgjcXsrK0LAQO8PgGkwHdn6UpYSSodL/cbpC1Bni912HojlpJ3+IUhMynw',
    '7RDOShgGGpQ06NKVFmGCBaw/RQDDq+M6fj68bVIELNKLKnyecun5BbomtctAmw2GD0rOLxc05DXqfV6v09FDx6l1ltaOPopaLNKm5I6UZmq1rvzg4RbpJ2X4',
    'E93jGORlKowWusyKl2N6a2rGHxTCU1WbsNWVRXzk+1UhGpXONA1MDnaMQIEWuOxa5A9iegM1E9jl9nFTpwH6SoVGrppk4APNzdDbQ1SqdM0ELPIzygOPah0f',
    'w4t07Mtv7vWS4dgO4awMu6vi3qyZgAF6Nelyvj6lg/RYcveZvP5oPycwoD8SBPLDHU67yK/HzslY7QSQ3lOhMcdhbKXygPPQyYHWnup0FLNUCAEN1kzAIm2I',
    'GwxyfGZahweUB/qqSggVQsMkLkm0oW4ETKF0dkpHV13gZ50E8jRb6f2Q2XcBD8d0V9WNQNA7cn78fesL0SGp6ppFAOhaXSc8h/hAp6uwfah2AsDrEtmlN7w4',
    '/l7aXe2BzBSKtEiF2uoMvWRSyIcX1kwg0ViV0yPf6DC4RQFbr3X8fOlEyU7JKswrtd5Oj8YqOvA3Xj37IGnW0jrcr8NIev9Em+G4+7rAGWCsplJPgEB4uzL8',
    'loPAvBS48jCL+wzQ8xb5+/T7Pd56WtplC3yWBXpZheJnWfWkamkrUJdyO5/w3LbDUlMKoM+zQMZIbdLdqM0kRoN+kU6bFPgYuK3K9TdrNbkqGqBfKoGXzSjv',
    'drprjdQmfSce8eolkhYVgY9dM005qDITlfCJ76SEUfz6eUpuZHo5XFRbYYG/lV7rpGJ0qFdP2RlGybttgHRnlr6k1o6ekVa531Za118eHWww7AyQz5ieC4/x',
    'plIM0Arl5lBaA29fkbYlQ1bncWkFbC6c4e0rEiDPz5wqT3Iyt9dE5jnO7AH0hUW+qzy4qiC7eqfLLHCvXPa9RojN8wN6xKieAblHGKTXDDJY5KIMf+WLTXwc',
    'b4A/bAiBMgkYucAgfV1NUcrO9zQmHmkYCakFcsWUtniin5YkIch8qbWhBGIied8HuqP84QN4nQy0do/Ld3342Fy+ngItthheKTWg0Zib0pSmeP8P+Q+xZ8Dd',
    'JIynDQAAAABJRU5ErkJggg=='
  ].join(''),
  linkedin: [
    'iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAACXBIWXMAAAsTAAALEwEAmpwYAAABwklEQVR4nO2ZP0vDQByGkwsOruIkuGpXP4GLWyuufgk/',
    'g4OUXHFQEId2cFFwcHJUsC1mFPGutNpCLdY6VIp/2kT7N/1J0latbbGJklzgHninHMf75HdZLoLA4XA4TCPJdAXJJI5kqiFMwZHIVBMxjUkyWf5TeRET7Fhp',
    'PDwiJkH7b97l8qgbKUQClgXMY8NAeWRMQaZR6wKYqG4XR73IpGJDgIHi+Cv/JuCLpOG8oIHW0EEpaDAfTntLQClo8J34veYtAa2h9wmodd1bAorXJ+CLpE0J',
    'YxKxvApz4RtvCSCXInAB3Mkwxnk+u3sN2xclSJWqUG224bXWMo/i2ukDTG4m2BZY2MvA41sTRnFZfIeZnRS7AtmXOvxGLK+CxKrAuPiPcmwK6G0wz//S4S2s',
    'HucheqcOXbeffGZTYF0p9q2ZCCXgJFcZWJd5qrEpML2dHNhn8SA7sK5ca7En0P7xvJepreTYa12fgN29EBfAXMCEC2AuQLkA4gIWGbWRWxE8fbWIadmygHE/',
    'z0BxMCJiemZZwPi54HZx1I2Er/yWBTpTIEG3y4uYbNgq/zmJEAkY9/POfhNENY6N7TfP4XA4glN8AJJwntfiYf8PAAAAAElFTkSuQmCC'
  ].join(''),
  facebook: [
    'iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAACXBIWXMAAAsTAAALEwEAmpwYAAABR0lEQVR4nO3Zz0oDMRAG8DxZUsVbWzaD4gMpggf1Jj36',
    'EE5WEGq9eRG01PoA3jwsuNteKtiRVbT+oaVJ102C88Ecw36/3eSSFYLD4XCCTkNjIgEvJeBYgaE6RgKOJZieTNL2SuWVNvt1lVbzRuOe85v3Xh4+EKZlDSi3',
    'TUCAC3uAxpH34vA5hTUggNL0dRigKpj1rZQOOgO6vcsoLyY0ndK3BA1Y20zp6vqRFkWFDDjsDBaWDx7QH2YUNaAYPf8qvHN0QxvbZ0ut9w54+Xliid7OxbLr',
    'vQNst4xiAPxN6Xl5yidxA/rDLG7A6flD3IDjk/vwANEfYsUAwwBiADCAGKAYYBgg/h1AVny1uBoAc3sAmF7VX8F5NHbtAUna9l4c3qcB2BQuKX8u+C4vwew6',
    'lZ8hTKu8n6/zul2Wz9LYdX7zHA6HI+rKKwESa+xUAU4/AAAAAElFTkSuQmCC'
  ].join(''),
  tiktok: [
    'iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAACXBIWXMAAAsTAAALEwEAmpwYAAADgElEQVR4nO2Z2U8TURTG+U+YO4WiiLSAGEUjKIsKjRKF',
    'KGpcHjQUjQuRFhGkfQIhmkqI+4KaoMEIDVpwgRektEiMWFRqXEjEgFUTrdBWEPnMXKG1LIltpTNN+iXnZeZm5vude+42ExISVFBBBSVosSy7hRDSQQixE0Lg',
    'p7AzDKMPDQ3d7JN5hmFO+9E0ZgqGYap9yTyv5okLYpPHABNlIxSAdm8AbHwbJ64Y9gbgv7x8UYrMLViRyKvnhPABwLIs1M9HUdj6For7vTRkcYmIFIUHFsDj',
    'V32YlOGwBlnzlwQuQI+hC2pJRuACcGo+cQHRoojABeBUW3MdC2LjAxeA9kSnCfLzWqzOVQYmwKTqr95CZUxmYAB8HBjEVBm199CeIOcPgBWFYen6HGQWViLn',
    '+BUk79g3K0BfRgnuai5ioP+DMACStuWioLUPKtMPKJp6UNaoR6WmBipJ+owAA2nFkM1bBHnUSjRszEeHsgpdeRX8AGwo0VCDCt0zdPa+c5rsbHwAfYJ8VoCM',
    'iDjnM2LD5mNrZAINvwKk7Smg5kq0Roz+HHOraU8AyD/GfwWIiJKgyPCJZn7S/NjYGB7rWtCmuQp9YZWwAdbIC2nNG1++paZGRkbwJLcCX5KKcHvxdhRL1uLQ',
    'whThAuw8o4Wyqcdpqv1SHTXPDUy32UmoAHvrDChv1LumwQMnaeantuP2/lMBBoUAsLvmIU43G5ymOpSnaNlMbSdZvpICdE0AOOx22lPpfANsLr8Mja7DCdDd',
    'ZkBZzPpp7bJU1VCZHLAO22m7Ny/MFGC5eCG/AEtk2SjVunqAU+vNBkQuiKL3ReFirCsoQ6nJgWKt0dnm0dla9CcqIGZF/AKwLIu8ay3T5v87hm7sr9Pj2NNh',
    'mnnO/NchG7333Wql24gb8ds8Nk/mYiGLXroC53RtbgB0Pfj1C+b3AxiyOZzXxsfH6TixJB5BqjhGGACEK6VVaTC//rMWzCaHwwF9cTWtfZXU86MkmUsALuKl',
    'sag/ewWfLRY349ZvVhhuN8GcpaaZL5Wme22ezPV2OoywyI9OhW7dQXTvKkNvthqW5KN4n6hAbfxWpIilPpkn/jzQcIf1ZLEUy8KjEE5Yn40THwAC+9MiwzB6',
    'ARgHFwzDPPIYgPu5wLdx4opsjwEmeqFaAOarvDL/F8Qm7vu8n8eEbeKd3mU+qKCCCirEX/oNpOLqaJHqPIUAAAAASUVORK5CYII='
  ].join(''),
  youtube: [
    'iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAACXBIWXMAAAsTAAALEwEAmpwYAAAEPUlEQVR4nO2X7WscRRzHt+AbfeEfICK+VVTwjWhVUnI7',
    'l8SkDY3Wu5ltfbiZXBNbq8ldiZEkVbHSIAEjCtUWNLXFaNWQElOUomKwD0bxoVLtk3I+oPhUjbvZ5x2Zmb29DUlaa3fTO9gvDOzMb+Y3v8/OsyQlSpQoUU0q',
    'hUgrQITKiBwpl8kI7/bLeqRqV0s+f5kMsQYQthsV5XJWBiAucYAMvkaqBQFEJljAALU3NSrkSh48JCelWlEakbwf9GAaEkVMHzzEbPK6/FUA4a0A4heZTZKk',
    'ZawcrM1dx9rJKH8996HkcilI7rkoAHI2dwVAxGPrQEZku4Bpr+PlkPwuRkckGeIB3ga2PyTKcJfIE1VG5FfpYgkgMs3WAYD4RxZ0Xd2WS0IjM8qAfHupKgFk',
    'iAcqfxqP+EE9KqZTrsghITkDINGrEiCVzd1YBkjB9jtrDkCSpGViOyW0Xrn/2loEkGRIZhKA6gLAG/118eTNa7oulRE2AMK/hQFkiB9hJzaA2Ko6gPosvkFG',
    'xOGB+9cLgPAbzBbaYlUZkr9FvSoDYAIKvhcgcprZZET2scONlTdk1l8NEPkJIHxChvnbqmIKJVoqGc9s69e7O0sagaqWy2ia0mqq2ZUWT3c322prvRek9C1U',
    'Td0kEvsO21hdv52mtJrcF4Eq8208O9gXS/B6f3E6CCjmpPcXg0dSJDKHBx9bquBVP7HRjgxA7+74gTl1T3xDvZmZecn54tNFA7HG9/I61uu7z28Uujq+jwxA',
    'w1mVOfV++ZkuJPfbU4sGYh/Yz+vYb4+dF4CWy6jRAaxrM/hf6XmQGk/0Urf0nQj8+Nc8rxcfiB5g7WojMgA1u9IOO3e+/IwH5Rz8UAx3X4Far45Qvb9AtUwz',
    '/7Z27ZwLMPUeNV9+gVqju6i2GlTm+uDj1Jl6n9ofHOB+gn6yLXZ0AG1p92wA9uS4CHL/Pqp3rRfzynPnAITlfCTamTuen2fTixtEP21pNzqAlhXehQK4x44G',
    '9Tz1H27z/vxDtHtngrqnTwY+eD8tK7zoABqW0wsFYGtA733Yt3lUveP2yl8vdFLrzVHhc/qQ6KdhOY0OIHyqRgXQXBcAeJpGqWn6AIdjAIhgCp0NICzn0FQM',
    'UyiCRTwHgNI5AHp3B9s2qb55I50lMIZFfI5t9H8BhNdAcQO13vLXwMcHo99GywfZuQDcU8f5brMQgHP0c2rteUnYbEvsQn+d4Vm2gN1jXwnT5Hj0B1n5KrEY',
    'gPXKzsoktu0FAcJiwfJ2e/fMs+k9m6K/SpQvc+VkPjdE7Ykxagw9JTq7q5Ha707yi9vsJsJt1thr4qTdtoXnze3D/E+zPX/2vjX+TnMrtUZ2cCDnkyPU2NoX',
    'z2Wu5q/TTOyRsVTB6wObD0txiD339ELoSQlXWZUnZZPz35+UTU7wpISrrOBJWegsGcNP98YSfKJEiRJJcehf7jL5kkeXN6IAAAAASUVORK5CYII='
  ].join(''),
  x: [
    'iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAACXBIWXMAAAsTAAALEwEAmpwYAAACwElEQVR4nO2YT4hPURTHr3PmmYU/oSQWdiLlX5KFUogy',
    'Ivmz8Cf5t8SGrGQWiixFGqWI/Oac22gkZkWyU6SRKAsiJZphfr93zhsy+T2950emZqb3e/e9N5v3qbt7797zPefce889xpSUlJSUlJQkxNbmI+kFZH2NJAGy',
    '1oDlObKcMbd19ki/eBVZbFzATt1o2kNwmqQ9hMhIJBlC1nDEQSpAejj+/k7fFCR/O7A+QtKL6Re2XyYjaTXymov9SHJlVMN5+ACSZ8jy848o+WRsdYbDwtr2',
    'n4cuGxtis3OAld1JjcfhEen3rC41t6rTsVPWpRIAVo4M8w7L3aY8EoYTkORt88bLELB2AetjJP3qWVmUTgDLsREm/4hW1if5v4WCFam8z3+HfEcbbDFpQQo2',
    'j5qrLN2my18wpgNIDzgI6Gshf5VxIj4NVMYIdR1I7kVCTU/YmiiCSTczyy6TBY1zO8mitUbenkAra01XbR6w7E0dgU5/WyYCzI1wErK+ccvlNAJ0g7PtQLIH',
    'SPd5FV0GLL1FCvDSnjyj5jDJYGECSOpR5J0FRBdJ4anD8SX2ymQFsDwpXoR0ZCbAs8Hyf7VJcRFoM1mCJDsLE0Hab2w40WRNVBYAy9P8Bcg5kwdIwVa0uglJ',
    'riHJj5yMHzSVYE5OAvRSAZv3vMkN689E1s85ps4Hc7N/an4Con1QCVYi67ccPP8raYnuTlSkkT7MUgBYPW2KJrofgLQdWB84ps716OVWuIBoUWA9iKQDTsbb',
    '5t/ZbvSErWB1P7C+cDC8DqSncvW8R7okSpMW8lej9XcA6UlguY+kvmPKvEOSNSZ3ugemIcvZRgctg2NSq7HXsyiTm6Iis4DkOLC+THXCsPQCydHIIWbcsf5C',
    'sHoISa7GZXbU84k7d1KP7weS93E7kKUjbhPawbnjbXJJSUlJSUmJyZHfxnHsrRJKPnUAAAAASUVORK5CYII='
  ].join(''),
};

function b64ToBuffer(b64) {
  return Buffer.from(b64, 'base64');
}

module.exports = async (req, res) => {
  const p = String((req.query && req.query.p) || '').toLowerCase();
  const assetId = String((req.query && req.query.asset) || '');
  const cache = 'public, max-age=31536000, immutable';

  try {
    // 1) Icon platform bawaan
    if (p && ICONS[p]) {
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', cache);
      res.setHeader('Access-Control-Allow-Origin', '*');
      return res.status(200).end(b64ToBuffer(ICONS[p]));
    }

    // 2) Gambar dari Image Library
    if (assetId) {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/assets?select=url,name&limit=1&id=eq.${encodeURIComponent(assetId)}`, {
        headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY },
      });
      const rows = await r.json().catch(() => []);
      const row = Array.isArray(rows) ? rows[0] : null;
      if (!row || !row.url) {
        res.setHeader('Content-Type', 'text/plain');
        return res.status(404).send('Asset not found');
      }
      const url = String(row.url);
      // Kalau sudah URL absolut (http/https) -> redirect aja
      if (/^https?:\/\//i.test(url)) {
        res.setHeader('Cache-Control', cache);
        return res.status(302).redirect(url);
      }
      // Kalau data URL -> decode jadi binary
      const m = url.match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
      if (m) {
        const mime = m[1] || 'image/png';
        const buf = m[2] ? b64ToBuffer(m[3]) : Buffer.from(decodeURIComponent(m[3]), 'utf8');
        res.setHeader('Content-Type', mime);
        res.setHeader('Cache-Control', cache);
        res.setHeader('Access-Control-Allow-Origin', '*');
        return res.status(200).end(buf);
      }
      res.setHeader('Content-Type', 'text/plain');
      return res.status(404).send('Unsupported asset url');
    }

    res.setHeader('Content-Type', 'text/plain');
    return res.status(400).send('Parameter ?p= (icon) atau ?asset= (library) wajib diisi');
  } catch (e) {
    console.error('[img]', e);
    res.setHeader('Content-Type', 'text/plain');
    return res.status(500).send('Gagal ambil gambar: ' + String((e && e.message) || e).slice(0, 160));
  }
};
