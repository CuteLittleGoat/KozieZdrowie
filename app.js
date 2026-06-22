"use strict";

const state = { data: null, range: "30" };
const COLORS = { systolic: "#5a9cf0", diastolic: "#eb625d", pulse: "#95c95a" };
const SERIES = [
  { key: "systolic", label: "Skurczowe (mmHg)", color: COLORS.systolic },
  { key: "diastolic", label: "Rozkurczowe (mmHg)", color: COLORS.diastolic },
  { key: "pulse", label: "Tętno (uderzenia/min)", color: COLORS.pulse },
];

const $ = (selector) => document.querySelector(selector);
const formatNumber = (value) => value == null ? "—" : new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 1 }).format(value);
const formatDate = (value) => value ? new Intl.DateTimeFormat("pl-PL").format(new Date(`${value}T12:00:00`)) : "—";
const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));

function rangeBounds() {
  const slots = state.data?.slots || [];
  if (!slots.length) return { from: null, to: null };
  const to = slots[slots.length - 1].date;
  if (state.range === "all") return { from: slots[0].date, to };
  const fromDate = new Date(`${to}T12:00:00`);
  fromDate.setDate(fromDate.getDate() - Number(state.range) + 1);
  return { from: fromDate.toISOString().slice(0, 10), to };
}

function filteredSlots() {
  const { from, to } = rangeBounds();
  return (state.data?.slots || []).filter(slot => (!from || slot.date >= from) && (!to || slot.date <= to));
}

function filteredMeasurements() {
  const { from, to } = rangeBounds();
  return (state.data?.measurements || []).filter(item => (!from || item.date >= from) && (!to || item.date <= to));
}

function renderSummary(slots) {
  const populated = slots.filter(slot => slot.hasData);
  $("#date-range").textContent = slots.length
    ? `${formatDate(slots[0].date)} – ${formatDate(slots[slots.length - 1].date)}`
    : "—";
  $("#measurement-count").textContent = `${populated.length} ${populated.length === 1 ? "punkt" : "punktów"} rano/wieczorem`;
}

function pressureFlag(item) {
  if (item.status === "conflict" || item.systolic == null || item.diastolic == null) {
    return { label: "NIEKOMPLETNE DANE", className: "flag-incomplete" };
  }

  const systolic = Number(item.systolic);
  const diastolic = Number(item.diastolic);

  if (systolic >= 180 || diastolic >= 120) {
    return { label: "BARDZO WYSOKIE", className: "flag-critical" };
  }
  if (systolic >= 150 || diastolic >= 95) {
    return { label: "WYSOKIE", className: "flag-high" };
  }
  if (systolic >= 135 || diastolic >= 85) {
    return { label: "PODWYŻSZONE", className: "flag-elevated" };
  }
  if (systolic < 90 || diastolic < 60) {
    return { label: "NISKIE", className: "flag-low" };
  }
  return { label: "BRAK", className: "flag-none" };
}

function pulseFlag(item) {
  if (item.status === "conflict") {
    return { label: "NIEKOMPLETNE DANE", className: "flag-incomplete" };
  }
  if (item.pulse == null) {
    return { label: "BRAK DANYCH", className: "flag-incomplete" };
  }

  const pulse = Number(item.pulse);
  if (pulse < 40 || pulse > 120) {
    return { label: "MOCNE OSTRZEŻENIE", className: "flag-strong-warning" };
  }
  if (pulse < 60 || pulse > 100) {
    return { label: "WYMAGA UWAGI", className: "flag-attention" };
  }
  return { label: "BRAK", className: "flag-none" };
}

function flagBadge(flag) {
  return `<span class="flag-badge ${flag.className}">${escapeHtml(flag.label)}</span>`;
}

function chartValues(slots) {
  return SERIES.flatMap(series => slots.map(slot => slot[series.key])).filter(value => value != null).map(Number);
}

function makeChartSvg(slots, options = {}) {
  const light = Boolean(options.light);
  const print = Boolean(options.print);
  const slotWidth = print ? 19 : 66;
  const width = options.width || Math.max(print ? 1080 : 760, slots.length * slotWidth + 110);
  const height = options.height || (print ? 560 : 450);
  const margin = { top: 52, right: 30, bottom: print ? 112 : 100, left: 62 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const values = chartValues(slots);
  let min = values.length ? Math.floor((Math.min(...values) - 10) / 10) * 10 : 40;
  let max = values.length ? Math.ceil((Math.max(...values) + 10) / 10) * 10 : 160;
  if (max - min < 60) { min -= 10; max += 10; }
  min = Math.max(0, min);
  const x = index => margin.left + (slots.length <= 1 ? plotWidth / 2 : index * plotWidth / (slots.length - 1));
  const y = value => margin.top + (max - Number(value)) * plotHeight / (max - min);
  const bg = light ? "#ffffff" : "#0e151f";
  const text = light ? "#333333" : "#aebaca";
  const grid = light ? "#d7d7d7" : "#2a3748";
  const axis = light ? "#777777" : "#607086";
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img">`, `<rect width="100%" height="100%" fill="${bg}"/>`];

  for (let i = 0; i <= 6; i++) {
    const value = min + (max - min) * i / 6;
    const yy = y(value);
    parts.push(`<line x1="${margin.left}" y1="${yy}" x2="${width - margin.right}" y2="${yy}" stroke="${grid}" stroke-width="1"/>`);
    parts.push(`<text x="${margin.left - 10}" y="${yy + 4}" text-anchor="end" fill="${text}" font-size="11">${Math.round(value)}</text>`);
  }
  parts.push(`<line x1="${margin.left}" y1="${margin.top + plotHeight}" x2="${width - margin.right}" y2="${margin.top + plotHeight}" stroke="${axis}"/>`);

  const labelStep = print ? Math.max(1, Math.ceil(slots.length / 32)) : 1;
  slots.forEach((slot, index) => {
    if (index % labelStep !== 0 && index !== slots.length - 1) return;
    const xx = x(index);
    const labelY = margin.top + plotHeight + 18;
    const dateLabel = formatDate(slot.date);
    parts.push(`<line x1="${xx}" y1="${margin.top + plotHeight}" x2="${xx}" y2="${margin.top + plotHeight + 5}" stroke="${axis}"/>`);
    parts.push(`<text transform="translate(${xx - 2},${labelY}) rotate(-55)" text-anchor="end" fill="${text}" font-size="${print ? 8 : 10}"><tspan>${escapeHtml(dateLabel)}</tspan><tspan x="0" dy="11">${escapeHtml(slot.period)}</tspan></text>`);
  });

  SERIES.forEach(series => {
    let path = "";
    slots.forEach((slot, index) => {
      const value = slot[series.key];
      if (value == null) return;
      const previousExists = index > 0 && slots[index - 1][series.key] != null;
      path += `${previousExists ? "L" : "M"}${x(index).toFixed(2)},${y(value).toFixed(2)} `;
    });
    parts.push(`<path d="${path}" fill="none" stroke="${series.color}" stroke-width="${print ? 2.3 : 3}" stroke-linejoin="round" stroke-linecap="round"/>`);
    slots.forEach((slot, index) => {
      const value = slot[series.key];
      if (value == null) return;
      const details = `${slot.label}\n${series.label}: ${formatNumber(value)}\nPomiary źródłowe: ${slot.measurementCount}\nSerie: ${slot.seriesCount}${slot.conflictCount ? `\nKonflikty pominięte: ${slot.conflictCount}` : ""}`;
      parts.push(`<circle cx="${x(index)}" cy="${y(value)}" r="${print ? 2.4 : 4}" fill="${series.color}" stroke="${bg}" stroke-width="1.5"><title>${escapeHtml(details)}</title></circle>`);
    });
  });

  let legendX = margin.left;
  SERIES.forEach(series => {
    parts.push(`<line x1="${legendX}" y1="24" x2="${legendX + 26}" y2="24" stroke="${series.color}" stroke-width="3"/>`);
    parts.push(`<text x="${legendX + 33}" y="28" fill="${text}" font-size="11">${escapeHtml(series.label)}</text>`);
    legendX += print ? 285 : 250;
  });
  parts.push("</svg>");
  return parts.join("");
}

function renderChart(slots) {
  const chart = $("#chart");
  if (!slots.length || !slots.some(slot => slot.hasData)) {
    chart.innerHTML = '<div class="empty">Brak prawidłowych pomiarów w wybranym zakresie.</div>';
    return;
  }
  chart.innerHTML = makeChartSvg(slots);
  requestAnimationFrame(() => { $("#chart-scroll").scrollLeft = $("#chart-scroll").scrollWidth; });
}

function renderTable(measurements) {
  const body = $("#measurements-body");
  if (!measurements.length) {
    body.innerHTML = '<tr><td colspan="8" class="empty">Brak pomiarów w wybranym zakresie.</td></tr>';
    return;
  }

  body.innerHTML = [...measurements].reverse().map(item => {
    const pressure = pressureFlag(item);
    const pulse = pulseFlag(item);
    return `<tr>
      <td>${formatDate(item.date)}</td><td>${escapeHtml(item.period)}</td><td>${escapeHtml(item.time)}</td>
      <td>${formatNumber(item.systolic)}</td><td>${formatNumber(item.diastolic)}</td><td>${formatNumber(item.pulse)}</td>
      <td>${flagBadge(pressure)}</td><td>${flagBadge(pulse)}</td>
    </tr>`;
  }).join("");
}

function renderAudit() {
  const audit = state.data.audit;
  const errors = audit.fileErrors?.length ? `<p class="status-danger">Błędy plików:</p><ul class="audit-list">${audit.fileErrors.map(error => `<li>${escapeHtml(error)}</li>`).join("")}</ul>` : "";
  $("#audit").innerHTML = `
    <p>Pliki CSV: <strong>${audit.csvFileCount}</strong><br>
    Wczytane wiersze przed deduplikacją: <strong>${audit.parsedRowsBeforeDeduplication}</strong><br>
    Usunięte duplikaty: <strong>${audit.duplicatesRemoved}</strong><br>
    Konflikty daty i godziny: <strong>${audit.conflictTimestamps}</strong><br>
    Pominięte wpisy bez ciśnienia: <strong>${audit.missingPressureRows}</strong><br>
    Pominięte wpisy z nieprawidłową datą lub godziną: <strong>${audit.invalidRows}</strong></p>${errors}`;
}

function render() {
  const slots = filteredSlots();
  renderSummary(slots);
  renderChart(slots);
  renderTable(filteredMeasurements());
}

function monthGroups(slots) {
  const groups = new Map();
  slots.forEach(slot => {
    const key = slot.date.slice(0, 7);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(slot);
  });
  return groups;
}

function printRow(item) {
  const pressure = pressureFlag(item);
  const pulse = pulseFlag(item);
  const conflictClass = item.status === "conflict" ? "print-conflict" : "";
  return `<tr class="${conflictClass}">
    <td>${formatDate(item.date)}</td><td>${escapeHtml(item.period)}</td><td>${escapeHtml(item.time)}</td>
    <td>${formatNumber(item.systolic)}</td><td>${formatNumber(item.diastolic)}</td><td>${formatNumber(item.pulse)}</td>
    <td>${flagBadge(pressure)}</td><td>${flagBadge(pulse)}</td>
  </tr>`;
}

function preparePrintReport() {
  const data = state.data;
  const summary = data.summary;
  const generated = new Intl.DateTimeFormat("pl-PL", { dateStyle: "long", timeStyle: "short" }).format(new Date());
  const charts = [...monthGroups(data.slots).entries()].map(([month, slots]) => {
    const title = new Intl.DateTimeFormat("pl-PL", { month: "long", year: "numeric" }).format(new Date(`${month}-15T12:00:00`));
    return `<section class="print-chart-page"><h2>${escapeHtml(title)}</h2>${makeChartSvg(slots, { light: true, print: true })}</section>`;
  }).join("");
  $("#print-report").innerHTML = `
    <section class="print-cover">
      <header class="print-header"><h1>Pomiary ciśnienia i tętna</h1><p>Okres: ${formatDate(summary.oldestDate)} – ${formatDate(summary.newestDate)} · raport utworzony ${escapeHtml(generated)}</p></header>
      <div class="print-summary">
        <div class="print-metric"><span>Średnie skurczowe</span><strong>${formatNumber(summary.systolic.average)} mmHg</strong></div>
        <div class="print-metric"><span>Średnie rozkurczowe</span><strong>${formatNumber(summary.diastolic.average)} mmHg</strong></div>
        <div class="print-metric"><span>Średnie tętno</span><strong>${formatNumber(summary.pulse.average)} /min</strong></div>
        <div class="print-metric"><span>Prawidłowe pomiary</span><strong>${summary.validMeasurementCount}</strong></div>
      </div>
      <p class="print-note">Wykres przedstawia osobne punkty dla poranka (00:00–11:59) i wieczoru (12:00–23:59). Kilka pomiarów wykonanych podczas tej samej pory dnia jest przedstawianych jako jeden punkt średni. Konflikty dla identycznej daty i godziny są oznaczane jako „Niekompletne dane” i wyłączane ze średnich.</p>
    </section>
    ${charts}
    <section class="print-table-section"><h2>Komplet pomiarów źródłowych</h2>
      <table class="print-table"><thead><tr><th>Data</th><th>Pora</th><th>Godzina</th><th>Skurczowe</th><th>Rozkurczowe</th><th>Tętno</th><th>Flaga ciśnienia</th><th>Flaga tętna</th></tr></thead>
      <tbody>${data.measurements.map(printRow).join("")}</tbody></table>
    </section>`;
}

async function loadData() {
  try {
    const response = await fetch("data.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state.data = await response.json();
    const audit = state.data.audit;
    $("#status").textContent = `Dane zbudowane: ${new Intl.DateTimeFormat("pl-PL", { dateStyle: "medium", timeStyle: "short" }).format(new Date(state.data.generatedAt))}. Wczytano ${audit.csvFileCount} plików CSV.`;
    $("#range-select").disabled = false;
    $("#print-button").disabled = false;
    renderAudit();
    render();
  } catch (error) {
    $("#status").classList.add("error");
    $("#status").textContent = `Nie udało się wczytać danych: ${error.message}`;
  }
}

$("#range-select").addEventListener("change", event => { state.range = event.target.value; render(); });
$("#print-button").addEventListener("click", () => {
  preparePrintReport();
  $("#print-report").setAttribute("aria-hidden", "false");
  requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
});
window.addEventListener("afterprint", () => $("#print-report").setAttribute("aria-hidden", "true"));
loadData();
