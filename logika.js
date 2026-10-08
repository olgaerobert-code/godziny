// Rozkład godzin — logika (bez interfejsu). Działa w przeglądarce i w Node (testy).
// Czas liczony w półgodzinach: 1 jednostka = 30 min.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Rozklad = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var START = 8 * 2;          // 8:00
  var KONIEC = 22 * 2;        // 22:00
  var OKNO = KONIEC - START;  // 28 jednostek = 14 h
  var MIN_DZIEN = 4 * 2;      // 4 h
  var PROBY = 100;

  var DNI_TYG = ['niedziela', 'poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota'];
  var DNI_KROTKO = ['nd.', 'pon.', 'wt.', 'śr.', 'czw.', 'pt.', 'sob.'];
  var MIESIACE = ['styczeń', 'luty', 'marzec', 'kwiecień', 'maj', 'czerwiec', 'lipiec',
    'sierpień', 'wrzesień', 'październik', 'listopad', 'grudzień'];

  var pula = new Uint32Array(1024), wPuli = pula.length;
  function losowaKryptograficzna() {
    var c = typeof globalThis !== 'undefined' ? globalThis.crypto : null;
    if (!c || !c.getRandomValues) return Math.random();
    if (wPuli >= pula.length) { c.getRandomValues(pula); wPuli = 0; }
    return pula[wPuli++] / 4294967296;
  }

  function klucz(d) {
    return d.toISOString().slice(0, 10);
  }

  function dodajDni(d, n) {
    return new Date(d.getTime() + n * 86400000);
  }

  // Niedziela Wielkanocna — algorytm Meeusa/Jonesa/Butchera (kalendarz gregoriański).
  function wielkanoc(rok) {
    var a = rok % 19, b = Math.floor(rok / 100), c = rok % 100;
    var d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
    var g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
    var i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
    var m = Math.floor((a + 11 * h + 22 * l) / 451);
    var x = h + l - 7 * m + 114;
    return new Date(Date.UTC(rok, Math.floor(x / 31) - 1, (x % 31) + 1));
  }

  // Dni ustawowo wolne od pracy w Polsce: { 'RRRR-MM-DD': nazwa }.
  function swieta(rok) {
    var s = {};
    function stale(mc, dz, nazwa) { s[klucz(new Date(Date.UTC(rok, mc - 1, dz)))] = nazwa; }
    var wlk = wielkanoc(rok);
    stale(1, 1, 'Nowy Rok');
    stale(1, 6, 'Trzech Króli');
    s[klucz(wlk)] = 'Wielkanoc';
    s[klucz(dodajDni(wlk, 1))] = 'Poniedziałek Wielkanocny';
    stale(5, 1, 'Święto Pracy');
    stale(5, 3, 'Święto Konstytucji 3 Maja');
    s[klucz(dodajDni(wlk, 49))] = 'Zielone Świątki';
    s[klucz(dodajDni(wlk, 60))] = 'Boże Ciało';
    stale(8, 15, 'Wniebowzięcie NMP');
    stale(11, 1, 'Wszystkich Świętych');
    stale(11, 11, 'Święto Niepodległości');
    if (rok >= 2025) stale(12, 24, 'Wigilia');
    stale(12, 25, 'Boże Narodzenie');
    stale(12, 26, 'Drugi dzień Bożego Narodzenia');
    return s;
  }

  // Wszystkie dni miesiąca (miesiac: 1–12) z informacją, czy są wolne.
  function kalendarz(rok, miesiac) {
    var sw = swieta(rok), dni = [];
    var d = new Date(Date.UTC(rok, miesiac - 1, 1));
    while (d.getUTCMonth() === miesiac - 1) {
      var k = klucz(d), dt = d.getUTCDay();
      var powod = sw[k] || (dt === 0 ? 'niedziela' : null);
      dni.push({ klucz: k, dzien: d.getUTCDate(), dzienTyg: dt, wolne: !!powod, powod: powod });
      d = dodajDni(d, 1);
    }
    return dni;
  }

  function dniPracy(rok, miesiac) {
    return kalendarz(rok, miesiac).filter(function (d) { return !d.wolne; });
  }

  // "37,5" / "37.5" / "37,5 h" -> liczba półgodzin albo { blad }.
  function czytajGodziny(tekst) {
    var t = String(tekst == null ? '' : tekst).trim().replace(/\s*(h|godz\.?|godzin[ay]?)$/i, '').replace(',', '.');
    if (!/^\d+(\.\d+)?$/.test(t)) return { blad: 'Wpisz liczbę godzin, np. 87 albo 37,5.' };
    var j = Number(t) * 2;
    if (Math.abs(j - Math.round(j)) > 1e-9) return { blad: 'Godziny podaj w pełnych godzinach albo z połówką, np. 37,5.' };
    return { jednostki: Math.round(j) };
  }

  function wybierzWagowo(wagi, dozwolone, los) {
    var suma = 0, i;
    for (i = 0; i < wagi.length; i++) if (dozwolone[i]) suma += wagi[i];
    var r = los() * suma;
    for (i = 0; i < wagi.length; i++) {
      if (!dozwolone[i]) continue;
      r -= wagi[i];
      if (r < 0) return i;
    }
    for (i = wagi.length - 1; i >= 0; i--) if (dozwolone[i]) return i;
    return -1;
  }

  // Dzieli `jednostki` na `n` dni po 8–28 półgodzin. Losowe wagi (rozkład wykładniczy)
  // dają mocny rozrzut długości zamiast prawie równych dni.
  function podziel(jednostki, n, los) {
    var dl = [], wagi = [], wolne = [], i;
    for (i = 0; i < n; i++) {
      dl.push(MIN_DZIEN);
      wagi.push(-Math.log(1 - los()) + 0.35);
      wolne.push(true);
    }
    var reszta = jednostki - MIN_DZIEN * n;
    while (reszta > 0) {
      // Przydział proporcjonalny do wag, z limitem 14 h na dzień; nadwyżka idzie w kolejnej rundzie.
      var sumaW = 0, dane = 0;
      for (i = 0; i < n; i++) if (wolne[i]) sumaW += wagi[i];
      for (i = 0; i < n; i++) {
        if (!wolne[i]) continue;
        var ile = Math.min(OKNO - dl[i], Math.floor(reszta * wagi[i] / sumaW), reszta - dane);
        dl[i] += ile;
        dane += ile;
      }
      if (dane === 0) {
        i = wybierzWagowo(wagi, wolne, los);
        dl[i]++;
        dane = 1;
      }
      for (i = 0; i < n; i++) if (dl[i] >= OKNO) wolne[i] = false;
      reszta -= dane;
    }
    return dl;
  }

  function tasuj(tab, los) {
    var a = tab.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(los() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function najczestszyUdzial(wartosci) {
    var licz = {}, max = 0;
    wartosci.forEach(function (v) { licz[v] = (licz[v] || 0) + 1; if (licz[v] > max) max = licz[v]; });
    return max / wartosci.length;
  }

  // Czy rozkład wygląda na ułożony według wzorca (wtedy losujemy jeszcze raz).
  function wygladaRegularnie(wpisy) {
    var n = wpisy.length;
    if (n < 3) return false;
    var dl = wpisy.map(function (w) { return w.koniec - w.start; });
    var st = wpisy.map(function (w) { return w.start; });
    // Przy 3 dniach odrzucamy tylko identyczne wartości, od 4 dni — gdy jedna wartość ma ponad połowę.
    function zaCzesto(wartosci) {
      var u = najczestszyUdzial(wartosci);
      return n === 3 ? u === 1 : u > 0.5;
    }
    if (zaCzesto(dl) || zaCzesto(st)) return true;
    var odstepy = [];
    for (var i = 1; i < n; i++) odstepy.push(wpisy[i].dzien - wpisy[i - 1].dzien);
    if (najczestszyUdzial(odstepy) === 1) return true;
    if (najczestszyUdzial(wpisy.map(function (w) { return w.dzienTyg; })) === 1) return true;
    return false;
  }

  // Główna funkcja. miesiac: 1–12, godziny: liczba lub tekst ("37,5").
  function rozdziel(rok, miesiac, godziny, los) {
    los = los || losowaKryptograficzna;
    var g = typeof godziny === 'number' ? { jednostki: Math.round(godziny * 2) } : czytajGodziny(godziny);
    if (g.blad) return { blad: g.blad };
    var U = g.jednostki;
    var dni = dniPracy(rok, miesiac);
    var maks = dni.length * OKNO;

    if (U < MIN_DZIEN) return { blad: 'Wpisz co najmniej 4 h. Tyle trwa najkrótszy dzień pracy.' };
    if (U > maks) {
      return { blad: 'W tym miesiącu jest ' + dni.length + ' dni pracy, więc zmieści się najwyżej ' +
        formatGodzin(maks) + ' h (14 h dziennie).' };
    }

    var minN = Math.ceil(U / OKNO);
    var maxN = Math.min(Math.floor(U / MIN_DZIEN), dni.length);
    var wynik = null;

    for (var proba = 0; proba < PROBY; proba++) {
      var srednia = 10 + los() * 10; // 5–10 h na dzień, losowane za każdym razem
      var n = Math.max(minN, Math.min(maxN, Math.round(U / srednia)));
      var dl = podziel(U, n, los);
      var wybrane = tasuj(dni, los).slice(0, n);
      var wpisy = wybrane.map(function (d, i) {
        var start = START + Math.floor(los() * (OKNO - dl[i] + 1));
        return { klucz: d.klucz, dzien: d.dzien, dzienTyg: d.dzienTyg, start: start, koniec: start + dl[i] };
      }).sort(function (a, b) { return a.dzien - b.dzien; });
      // Strażnik: wynik, który łamie choć jedną zasadę, nigdy nie trafia do tabeli.
      if (sprawdzWynik(rok, miesiac, U, wpisy).length) continue;
      wynik = wpisy;
      if (!wygladaRegularnie(wpisy)) break;
    }

    if (!wynik) return { blad: 'Nie udało się rozdzielić godzin. Kliknij jeszcze raz.' };
    return { wpisy: wynik, suma: U, dniPracy: dni.length };
  }

  function sumaWpisow(wpisy) {
    return wpisy.reduce(function (s, w) { return s + (w.koniec - w.start); }, 0);
  }

  // Niezależna kontrola wyniku: zwraca listę złamanych zasad (pusta = wszystko w porządku).
  function sprawdzWynik(rok, miesiac, jednostki, wpisy) {
    var bledy = [], dozwolone = {}, widziane = {};
    dniPracy(rok, miesiac).forEach(function (d) { dozwolone[d.klucz] = true; });
    wpisy.forEach(function (w) {
      var dl = w.koniec - w.start;
      if (!dozwolone[w.klucz]) bledy.push(w.klucz + ': niedziela, święto albo inny miesiąc');
      if (widziane[w.klucz]) bledy.push(w.klucz + ': dzień powtórzony');
      widziane[w.klucz] = true;
      if (w.start < START || w.koniec > KONIEC) bledy.push(w.klucz + ': poza 8:00–22:00');
      if (dl < MIN_DZIEN) bledy.push(w.klucz + ': mniej niż 4 h');
      if (dl !== Math.round(dl)) bledy.push(w.klucz + ': czas nie jest wielokrotnością 30 min');
    });
    var suma = sumaWpisow(wpisy);
    if (suma !== jednostki) bledy.push('suma ' + formatGodzin(suma) + ' h zamiast ' + formatGodzin(jednostki) + ' h');
    return bledy;
  }

  function formatCzasu(j) {
    var h = Math.floor(j / 2), m = j % 2 ? '30' : '00';
    return (h < 10 ? '0' : '') + h + ':' + m;
  }

  function formatGodzin(j) {
    return j % 2 ? Math.floor(j / 2) + ',5' : String(j / 2);
  }

  return {
    START: START, KONIEC: KONIEC, OKNO: OKNO, MIN_DZIEN: MIN_DZIEN,
    DNI_TYG: DNI_TYG, DNI_KROTKO: DNI_KROTKO, MIESIACE: MIESIACE,
    wielkanoc: wielkanoc, swieta: swieta, kalendarz: kalendarz, dniPracy: dniPracy,
    czytajGodziny: czytajGodziny, podziel: podziel, wygladaRegularnie: wygladaRegularnie,
    rozdziel: rozdziel, sprawdzWynik: sprawdzWynik, sumaWpisow: sumaWpisow,
    formatCzasu: formatCzasu, formatGodzin: formatGodzin
  };
});
